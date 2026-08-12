/**
 * Full-flow E2E (Phase 8.1): login -> sync inventory -> filter/view ->
 * configure template -> build a selection -> enqueue -> real pg-boss +
 * real Playwright Chromium render -> uploaded -> preview/download, plus
 * 401/403 gating. See README's "Running the E2E test" for prerequisites.
 *
 * Ladder choice (coding-style ruleset): this is a Vitest request-level
 * integration test, NOT a `@playwright/test`-driven browser test — adding
 * `@playwright/test` would be a second E2E framework next to Vitest (the
 * project's only test runner so far); `playwright` (already a dependency,
 * used by pdf-generation/worker.ts) still runs a REAL Chromium render here,
 * just invoked through the app's own worker code, not from this test file
 * directly. Route Handlers are called directly with hand-built `NextRequest`
 * objects — the SAME pattern `api/template-config/route.test.ts` already
 * uses for 403 gating, just extended end-to-end. Only two boundaries are
 * mocked, both genuinely external network services this sandbox can't (and
 * production code already treats as swappable): the Interfuerza API (via
 * `runSync`'s existing `fetchProducts` injection seam) and Cloudflare R2
 * (via `vi.mock` below — R2 credentials aren't available here, and R2 is
 * the same class of external dependency the task explicitly sanctions
 * mocking "at the boundary", same as Interfuerza).
 *
 * Everything else is real: Postgres (via `DATABASE_URL`, see README),
 * Drizzle queries, pg-boss job processing (real queue engine, real advisory
 * locks), bcrypt, DB-backed sessions, and the actual Chromium `page.pdf()`
 * render.
 */
import { execSync } from "node:child_process";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/catalog-storage/r2", () => {
  const store = new Map<string, Buffer>();
  return {
    putObject: vi.fn(async (key: string, body: Buffer) => {
      store.set(key, body);
      return `https://fake-r2.test/${key}`;
    }),
    getObject: vi.fn(async (key: string) => store.get(key) ?? null),
    deleteObject: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };
});

import { hashPassword } from "@/modules/auth/password";
import { SESSION_COOKIE, validateSession } from "@/modules/auth/session";
import { resolveAllPrices } from "@/modules/catalog-builder/price-lists";
import { buildIndexSections } from "@/modules/catalog-builder/selection";
import { DEFAULT_TEMPLATE_ID } from "@/shared/template/registry";
import { listCatalogsForUser } from "@/modules/catalog-storage/queries";
import { registerPdfUploadWorker } from "@/modules/catalog-storage/upload-status";
import { countAllProducts, listCategoryL1Options, listInventory } from "@/modules/inventory-view/queries";
import { runSync } from "@/modules/inventory-sync/job";
import { registerPdfGenerateWorker } from "@/modules/pdf-generation/worker";
import { proxy } from "@/proxy";
import { db } from "@/shared/db/client";
import { users } from "@/shared/db/schema";
import { getBoss } from "@/shared/jobs/boss";

import { POST as loginPOST } from "../app/api/login/route";
import { POST as templateConfigPOST } from "../app/api/template-config/route";
import { POST as productsPOST } from "../app/api/catalog-builder/products/route";
import { POST as generatePOST } from "../app/api/catalog-builder/generate/route";
import { GET as filePOST } from "../app/api/catalogs/[id]/file/route";

const PASSWORD = "Sup3rSecret!1";

function headersFor(user: { id: string; role: "tecnico" | "administrador" }) {
  return { "x-user-id": user.id, "x-user-role": user.role };
}

async function loginAs(username: string): Promise<{ id: string; role: "tecnico" | "administrador" }> {
  const response = await loginPOST(
    new NextRequest("http://localhost/api/login", { method: "POST", body: JSON.stringify({ username, password: PASSWORD }) }),
  );
  expect(response.status).toBe(200);
  const token = response.cookies.get(SESSION_COOKIE)?.value;
  expect(token).toBeTruthy();
  const user = await validateSession(token!);
  expect(user).not.toBeNull();
  return user!;
}

describe("full catalog-generation flow (E2E)", () => {
  let regularUser: { id: string; role: "tecnico" | "administrador" };
  let adminUser: { id: string; role: "tecnico" | "administrador" };
  let otherUser: { id: string; role: "tecnico" | "administrador" };

  beforeAll(async () => {
    // Real migrations against whatever DATABASE_URL points at (README:
    // point this at a disposable Postgres, never the dev DB).
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });

    const passwordHash = await hashPassword(PASSWORD);
    await db.insert(users).values([
      { username: "e2e-user", passwordHash, role: "tecnico" },
      { username: "e2e-admin", passwordHash, role: "administrador" },
      { username: "e2e-other", passwordHash, role: "tecnico" },
    ]);

    // Real pg-boss workers — the same functions instrumentation.ts registers
    // at real server startup (see that file's header for why this is new
    // this phase: nothing called them before PR9).
    await registerPdfGenerateWorker();
    await registerPdfUploadWorker();
  }, 60_000);

  afterAll(async () => {
    const boss = await getBoss();
    await boss.stop({ close: true, graceful: false });
    await db.$client.end();
  });

  // Stale before this fix: written against a proxy.ts behavior superseded by
  // 9b789e2 ("fix: redirect unauthenticated page visits to /login instead of
  // raw 401 JSON") — a page route with no cookie now redirects (307), the
  // same as an invalid one; 401 JSON is API-routes-only (proxy.ts's
  // `isApiRoute` split). Not a WU4 defect, but blocking for the WU4 live
  // smoke this test is required to run.
  it("proxy: redirects an unauthenticated page visit; 401s an unauthenticated API call (NFR-5, R9.3)", async () => {
    const noCookiePage = await proxy(new NextRequest("http://localhost/inventory"));
    expect(noCookiePage.status).toBeGreaterThanOrEqual(300);
    expect(noCookiePage.status).toBeLessThan(400);
    expect(noCookiePage.headers.get("location")).toContain("/login");

    const badCookie = await proxy(
      new NextRequest("http://localhost/inventory", { headers: { cookie: `${SESSION_COOKIE}=not-a-real-token` } }),
    );
    expect(badCookie.status).toBeGreaterThanOrEqual(300);
    expect(badCookie.status).toBeLessThan(400);
    expect(badCookie.headers.get("location")).toContain("/login");

    const noCookieApi = await proxy(new NextRequest("http://localhost/api/catalog-builder/generate"));
    expect(noCookieApi.status).toBe(401);
  });

  it("logs in as each seeded user; wrong password is a generic 401 (R9.1/9.2)", async () => {
    regularUser = await loginAs("e2e-user");
    adminUser = await loginAs("e2e-admin");
    otherUser = await loginAs("e2e-other");

    const badLogin = await loginPOST(
      new NextRequest("http://localhost/api/login", {
        method: "POST",
        body: JSON.stringify({ username: "e2e-user", password: "wrong-password" }),
      }),
    );
    expect(badLogin.status).toBe(401);
    expect(await badLogin.json()).toEqual({ error: "invalid_credentials" });
  });

  it("syncs inventory from a mocked Interfuerza boundary, then filters it (R1, R3, R10)", async () => {
    // catalog-templates-and-workshop-info WU4: the real Interfuerza wrapper is
    // {Producto, InStock, PriceLists, Images, Matrix} (mapper.ts, fixed in
    // a828759) — a flat {id, name, price} object throws
    // "missing a usable Producto.id" in parseProduct. `priceLists` below also
    // carries a real "0.00" tier (p2's socio price) — the production-verified
    // case R6's em-dash rule exists for (spec: "A zero tier renders an
    // em-dash").
    function wrapper(
      id: string,
      nombre: string,
      categoryL1: string,
      categoryL2: string | null,
      venta: string,
      taller: string,
      socio: string,
    ) {
      return {
        Producto: { id, Nombre: nombre, Category_L1: categoryL1, Category_L2: categoryL2, Precio_Venta: venta },
        InStock: [{ Available: "5" }],
        PriceLists: [
          { Name: "Precio de venta", Precio: venta, Precio_Real: venta },
          { Name: "PRECIO TALLER ", Precio: taller, Precio_Real: taller },
          { Name: "Precio Socio", Precio: socio, Precio_Real: socio },
        ],
        Images: [],
      };
    }

    async function* fakeInterfuerzaPage() {
      yield [
        wrapper("p1", "Filtro de aceite", "Motor", "Filtros", "10.00", "8.00", "6.00"),
        wrapper("p2", "Bujía", "Motor", "Encendido", "5.00", "4.00", "0.00"),
        wrapper("p3", "Amortiguador", "Suspensión", null, "80.00", "70.00", "60.00"),
      ];
    }

    await runSync({ mode: "manual", triggeredBy: adminUser.id }, { fetchProducts: fakeInterfuerzaPage });

    const all = await listInventory({}, { offset: 0, limit: 25 });
    expect(all.total).toBe(3);

    const motorOnly = await listInventory({ categoryL1: "Motor" }, { offset: 0, limit: 25 });
    expect(motorOnly.items.map((i) => i.id).sort()).toEqual(["p1", "p2"]);

    // PR10 — grand total stays 3 regardless of the active filter, unlike
    // `listInventory().total` above which is filter-scoped (motorOnly = 2).
    expect(await countAllProducts()).toBe(3);

    expect(await listCategoryL1Options()).toEqual(["Motor", "Suspensión"]);
  });

  it("configures branding as admin; a non-admin gets 403 (R8, R9.6/NFR-8)", async () => {
    // Pre-existing, unrelated to WU4: this body carried the four legacy
    // branding fields WU3's migration 0009 dropped and validateTemplateConfigInput
    // no longer accepts (service.ts's TemplateConfigInput is `{defaultImageHandling,
    // selectedTemplateId}`). It parsed to `{}` and still returned 200 — a false
    // green that configured nothing, caught by GGA while running this WU's
    // required live smoke. Fixed to the real current shape.
    const templateBody = JSON.stringify({
      selectedTemplateId: DEFAULT_TEMPLATE_ID,
      defaultImageHandling: "strict",
    });

    const forbidden = await templateConfigPOST(
      new NextRequest("http://localhost/api/template-config", { method: "POST", headers: headersFor(regularUser), body: templateBody }),
    );
    expect(forbidden.status).toBe(403);

    const saved = await templateConfigPOST(
      new NextRequest("http://localhost/api/template-config", { method: "POST", headers: headersFor(adminUser), body: templateBody }),
    );
    expect(saved.status).toBe(200);
    expect((await saved.json()).config.selectedTemplateId).toBe(DEFAULT_TEMPLATE_ID);
  });

  it("builds a selection, enqueues it, and it reaches uploaded via the real queue+render+upload pipeline (R5, R6, R11, R12)", async () => {
    const candidatesRes = await productsPOST(
      new NextRequest("http://localhost/api/catalog-builder/products", {
        method: "POST",
        headers: headersFor(regularUser),
        body: JSON.stringify({ categories: [{ categoryL1: "Motor" }] }),
      }),
    );
    const { products } = await candidatesRes.json();
    expect(products).toHaveLength(2);

    // The only real exercise of queries.ts's hand-built jsonb extraction
    // (AGENTS.md: the injected-dep seam means a fully green `npm test` run
    // proves ZERO coverage of it) — same resolution `CatalogBuilderForm`'s
    // `reviewedProducts` does, against the real Postgres row this query just
    // read. p2's real "0.00" socio tier (design D4/R6) must collapse to null.
    const reviewedProducts = products.map((p: (typeof products)[number]) => ({
      ...p,
      prices: resolveAllPrices(p.priceLists),
    }));
    const bujia = reviewedProducts.find((p: { id: string }) => p.id === "p2");
    expect(bujia.prices).toEqual({ venta: 5, taller: 4, socio: null });

    const sections = buildIndexSections(products);
    // `catalogs.generate` is admin-only in the real MATRIX (policy.ts) — this
    // step used `regularUser` (tecnico) before this fix, which the matrix has
    // always rejected with 403 (verified: `catalogs.generate: false` for
    // tecnico since the very first commit that introduced it, edd86d7). Not a
    // WU4 defect, but blocking for this required live smoke.
    const generateRes = await generatePOST(
      new NextRequest("http://localhost/api/catalog-builder/generate", {
        method: "POST",
        headers: headersFor(adminUser),
        body: JSON.stringify({
          title: "Catalog: Motor",
          sections,
          products: reviewedProducts,
          productsPerPage: 10,
          includedCategoryCount: 1,
        }),
      }),
    );
    expect(generateRes.status).toBe(200);
    const { jobId } = await generateRes.json();
    expect(jobId).toBeTruthy();

    // Real pg-boss processing (render worker + upload worker) — poll instead
    // of a fixed sleep since job pickup timing isn't deterministic.
    let catalog;
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      [catalog] = await listCatalogsForUser(adminUser.id);
      if (catalog?.uploadStatus === "uploaded" || catalog?.uploadStatus === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(catalog?.uploadStatus).toBe("uploaded");

    const fileRes = await filePOST(new NextRequest(`http://localhost/api/catalogs/${catalog!.id}/file`, { headers: headersFor(adminUser) }), {
      params: Promise.resolve({ id: catalog!.id }),
    });
    expect(fileRes.status).toBe(200);
    expect(fileRes.headers.get("content-type")).toBe("application/pdf");
    const bytes = Buffer.from(await fileRes.arrayBuffer());
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF"); // real Chromium-rendered PDF, not a stub buffer

    // R7 ownership check — a different, non-admin user must not see it (404, not 403 — no existence signal).
    const denied = await filePOST(new NextRequest(`http://localhost/api/catalogs/${catalog!.id}/file`, { headers: headersFor(otherUser) }), {
      params: Promise.resolve({ id: catalog!.id }),
    });
    expect(denied.status).toBe(404);
  });
});
