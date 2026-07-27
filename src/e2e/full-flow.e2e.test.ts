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
import { buildIndexSections } from "@/modules/catalog-builder/selection";
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

  it("proxy: 401 with no session cookie, redirect on an invalid one (NFR-5, R9.3)", async () => {
    const noCookie = await proxy(new NextRequest("http://localhost/inventory"));
    expect(noCookie.status).toBe(401);

    const badCookie = await proxy(
      new NextRequest("http://localhost/inventory", { headers: { cookie: `${SESSION_COOKIE}=not-a-real-token` } }),
    );
    expect(badCookie.status).toBeGreaterThanOrEqual(300);
    expect(badCookie.status).toBeLessThan(400);
    expect(badCookie.headers.get("location")).toContain("/login");
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
    async function* fakeInterfuerzaPage() {
      yield [
        { id: "p1", name: "Filtro de aceite", category_l1: "Motor", category_l2: "Filtros", price: 10, stock: 5 },
        { id: "p2", name: "Bujía", category_l1: "Motor", category_l2: "Encendido", price: 5, stock: 20 },
        { id: "p3", name: "Amortiguador", category_l1: "Suspensión", category_l2: null, price: 80, stock: 3 },
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
    const templateBody = JSON.stringify({
      logoUrl: "https://example.com/logo.png",
      primaryColors: { primary: "#112233", secondary: "#ffffff" },
      font: "Arial",
      coverText: "Catálogo Dforce",
    });

    const forbidden = await templateConfigPOST(
      new NextRequest("http://localhost/api/template-config", { method: "POST", headers: headersFor(regularUser), body: templateBody }),
    );
    expect(forbidden.status).toBe(403);

    const saved = await templateConfigPOST(
      new NextRequest("http://localhost/api/template-config", { method: "POST", headers: headersFor(adminUser), body: templateBody }),
    );
    expect(saved.status).toBe(200);
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

    const sections = buildIndexSections(products);
    const generateRes = await generatePOST(
      new NextRequest("http://localhost/api/catalog-builder/generate", {
        method: "POST",
        headers: headersFor(regularUser),
        body: JSON.stringify({ title: "Catalog: Motor", sections, products, productsPerPage: 10, includedCategoryCount: 1 }),
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
      [catalog] = await listCatalogsForUser(regularUser.id);
      if (catalog?.uploadStatus === "uploaded" || catalog?.uploadStatus === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(catalog?.uploadStatus).toBe("uploaded");

    const fileRes = await filePOST(new NextRequest(`http://localhost/api/catalogs/${catalog!.id}/file`, { headers: headersFor(regularUser) }), {
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
