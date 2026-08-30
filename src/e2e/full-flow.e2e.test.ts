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
import { inArray } from "drizzle-orm";
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
import { cliente, users, vehiculo } from "@/shared/db/schema";
import { getBoss } from "@/shared/jobs/boss";

import { POST as loginPOST } from "../app/api/login/route";
import { POST as templateConfigPOST } from "../app/api/template-config/route";
import { POST as productsPOST } from "../app/api/catalog-builder/products/route";
import { POST as generatePOST } from "../app/api/catalog-builder/generate/route";
import { GET as filePOST } from "../app/api/catalogs/[id]/file/route";
import { GET as customersGET, POST as customersPOST } from "../app/api/customers/route";

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

/**
 * AGENTS.md's "Known coverage limit" — every unit test for `listClientes`/
 * `countClientes` injects `queryFn`, so a fully green `npm test` proves ZERO
 * coverage of the real `ilike`/`or()` SQL `buildClienteSearchWhere` builds.
 * Specifically: `NULL ILIKE x` is NULL, not false, so a customer with a null
 * `phone` or `vehicle_plate` could in principle be silently dropped from the
 * `or()`. This describe calls the real `GET /api/customers` handler (no
 * injected deps) against a real Postgres to prove: mid-string case-
 * insensitive matching on name/plate, that a NULL column does not drop a row
 * matched through a different column, mid-string digit matching on phone,
 * and that the `relaxSearchTerm` near-match pass finds a row the raw
 * (unrelaxed) term cannot. Runs before the catalog-generation describe below
 * so `db.$client.end()` in that describe's `afterAll` — its own connection
 * teardown — still lands after this one, not before.
 */
describe("customer search (E2E)", () => {
  let mixedCaseName: { id: string };
  let nullPlate: { id: string };
  let nullPhone: { id: string };
  let formattedPhone: { id: string };

  beforeAll(async () => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });

    const [row1, row2, row3, row4] = await db
      .insert(cliente)
      .values([
        { name: "María GONZÁLEZ", phone: "50761111111", vehiclePlate: "ABC111" },
        { name: "Carlos Ruiz", phone: "50762222222", vehiclePlate: null },
        { name: "Ana Torres", phone: null, vehiclePlate: "XYZ999" },
        // Stored with a leading "+" — `normalizePhone`'s real output shape
        // for an international number (validation.ts:47-51), i.e. what a
        // production row genuinely looks like, not a hand-formatted stub.
        { name: "Pedro Díaz", phone: "+5076444444", vehiclePlate: "DEF444" },
      ])
      .returning({ id: cliente.id });
    mixedCaseName = row1;
    nullPlate = row2;
    nullPhone = row3;
    formattedPhone = row4;

    // R19's plate match now runs against `vehiculo`, not `cliente.vehicle_plate`
    // (design.md D4) — the row above still carries the legacy column (it's
    // still physically present, just unread by search) so a `vehiculo` row is
    // what the "matches a partial plate" case below actually needs. Cascades
    // with `mixedCaseName`'s deletion in `afterAll`, no separate cleanup.
    await db.insert(vehiculo).values({ clienteId: mixedCaseName.id, plate: "ABC111" });
  }, 60_000);

  // Seeded rows are removed by id. Without this the describe is a one-way
  // write: `vitest.e2e.config.ts` deliberately does NOT override
  // `DATABASE_URL`, so this suite runs against whatever the environment
  // points at — a throwaway container if you were careful, the dev database
  // if you were not. Four customers per run, accumulating forever, is not a
  // cost a test is allowed to charge silently. Deleting by captured id (not
  // by name) leaves any real row that happens to share a name untouched.
  afterAll(async () => {
    // Optional chaining because a throwing `beforeAll` leaves these undefined,
    // and a TypeError in here would mask the real seed error underneath it.
    const seeded = [mixedCaseName?.id, nullPlate?.id, nullPhone?.id, formattedPhone?.id].filter(
      (id): id is string => Boolean(id),
    );
    if (seeded.length > 0) await db.delete(cliente).where(inArray(cliente.id, seeded));
  });

  const headers = { "x-user-id": "e2e-customer-search", "x-user-role": "tecnico" };

  async function search(term: string) {
    const response = await customersGET(
      new NextRequest(`http://localhost/api/customers?search=${encodeURIComponent(term)}`, { headers }),
    );
    expect(response.status).toBe(200);
    return response.json() as Promise<{ customers: { id: string }[]; total: number; relaxedFrom?: string }>;
  }

  it("matches partial, lowercase, mixed-case names (mid-string ilike, case-insensitive)", async () => {
    const body = await search("maría gonzá");
    expect(body.customers.map((c) => c.id)).toContain(mixedCaseName.id);
  });

  it("matches an accented name from an UNACCENTED term (unaccent() on both sides)", async () => {
    // The accented sibling above passes precisely by avoiding the failing
    // input: `ilike` folds case but not accents, so before migration 0012
    // 'María GONZÁLEZ' ilike '%maria gonza%' was false and staff typing the
    // name the ordinary way got zero matches plus a "create customer" button.
    // This is the only check that proves the real `unaccent()` SQL.
    const body = await search("maria gonza");
    expect(body.customers.map((c) => c.id)).toContain(mixedCaseName.id);
  });

  it("matches a partial plate (mid-string ilike on vehicle_plate)", async () => {
    const body = await search("bc11");
    expect(body.customers.map((c) => c.id)).toContain(mixedCaseName.id);
  });

  it("matches partial digits-only phone (mid-string ilike on phone)", async () => {
    const body = await search("622222");
    expect(body.customers.map((c) => c.id)).toContain(nullPlate.id);
  });

  it("does not silently drop a row with a NULL vehicle_plate from the or() when matched by name", async () => {
    const body = await search("Carlos");
    expect(body.customers.map((c) => c.id)).toContain(nullPlate.id);
  });

  it("does not silently drop a row with a NULL phone from the or() when matched by name", async () => {
    const body = await search("Torres");
    expect(body.customers.map((c) => c.id)).toContain(nullPhone.id);
  });

  it("finds a customer only through the relaxed near-match pass, not the raw term", async () => {
    // "644-4444" is dashed and has no country code; the stored phone
    // ("+5076444444") has neither dash nor a bare "644-4444" substring, so
    // the primary pass must return zero rows before relaxSearchTerm's
    // digits-only relaxation ("6444444") finds it as a substring.
    // NOTE: this is the one case in this describe that depends on the whole
    // table, not just the seeded rows — `relaxedFrom` is only set when the
    // primary pass finds ZERO rows anywhere. Run against a database that
    // already holds a customer whose phone contains "644-4444" and it goes red
    // for a reason unrelated to the code. Every other case uses `toContain`
    // and is immune. Recreate the database per run, as the header says.
    const raw = await search("644-4444");
    expect(raw.relaxedFrom).toBe("6444444");
    expect(raw.customers.map((c) => c.id)).toContain(formattedPhone.id);
  });
});

/**
 * vehicles-one-to-many (C3, design.md Testing Strategy) — the ONE thing every
 * unit test cannot prove: `service.test.ts`/`queries.test.ts` inject the
 * query seam, so a green `npm test` proves zero coverage of the real
 * `EXISTS`/`array_agg` SQL `buildClienteSearchWhere`/`listClientes` build.
 * Mirrors `customer search (E2E)` exactly: real migrate, seed via captured
 * ids, `afterAll` deletes those `cliente` ids (`vehiculo` cascades, no
 * separate cleanup needed).
 */
describe("vehicle search (E2E)", () => {
  let threeVehicles: { id: string };
  let zeroVehicles: { id: string };
  let withDeactivated: { id: string };
  /** Created by the test below through the REAL write path, not seeded here. */
  let flatPlateOnly: { id: string } | undefined;

  beforeAll(async () => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });

    const [row1, row2, row3] = await db
      .insert(cliente)
      .values([
        { name: "Lucía Fernández", phone: "50763333333" },
        { name: "Roberto Silva", phone: "50764444444" },
        { name: "Marta Núñez", phone: "50765555555" },
      ])
      .returning({ id: cliente.id });
    threeVehicles = row1;
    zeroVehicles = row2;
    withDeactivated = row3;

    await db.insert(vehiculo).values([
      { clienteId: threeVehicles.id, plate: "AAA111" },
      { clienteId: threeVehicles.id, plate: "BBB222" },
      { clienteId: threeVehicles.id, plate: "CCC333" },
      { clienteId: withDeactivated.id, plate: "ZZZ999", deactivatedAt: new Date() },
    ]);
  }, 60_000);

  afterAll(async () => {
    const seeded = [threeVehicles?.id, zeroVehicles?.id, withDeactivated?.id, flatPlateOnly?.id].filter(
      (id): id is string => Boolean(id),
    );
    if (seeded.length > 0) await db.delete(cliente).where(inArray(cliente.id, seeded));
  });

  const headers = { "x-user-id": "e2e-vehicle-search", "x-user-role": "tecnico" };

  async function search(term: string) {
    const response = await customersGET(
      new NextRequest(`http://localhost/api/customers?search=${encodeURIComponent(term)}`, { headers }),
    );
    expect(response.status).toBe(200);
    return response.json() as Promise<{ customers: { id: string; plates: string[] }[]; total: number }>;
  }

  it("matches a 3-vehicle customer by the SECOND plate, not only the first", async () => {
    const body = await search("bbb2");
    expect(body.customers.map((c) => c.id)).toContain(threeVehicles.id);
  });

  it("matches a 3-vehicle customer by the THIRD plate", async () => {
    const body = await search("ccc3");
    expect(body.customers.map((c) => c.id)).toContain(threeVehicles.id);
  });

  it("still matches a zero-vehicle customer on name and phone", async () => {
    const body = await search("Roberto Silva");
    expect(body.customers.map((c) => c.id)).toContain(zeroVehicles.id);
  });

  it("excludes a soft-deleted vehicle's plate from search while its customer stays findable by name", async () => {
    const byPlate = await search("zzz9");
    expect(byPlate.customers.map((c) => c.id)).not.toContain(withDeactivated.id);

    const byName = await search("Marta Núñez");
    expect(byName.customers.map((c) => c.id)).toContain(withDeactivated.id);
  });

  it("finds a customer created through the REAL flat write path, which writes no vehiculo row", async () => {
    // Every other case in this describe seeds `vehiculo` directly, so none of
    // them exercises what production actually does today: `CustomerForm` sends
    // no `vehicles` key, `createCliente` takes its scalar-only branch, the
    // plate lands in `cliente.vehicle_plate` and NO `vehiculo` row is written.
    // Search must find that customer until `0014` (slice 3) moves the write.
    const response = await customersPOST(
      new NextRequest("http://localhost/api/customers", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Sofía Ledesma", phone: "50766666666", vehiclePlate: "FLT777" }),
      }),
    );
    expect(response.status).toBe(201);
    flatPlateOnly = ((await response.json()) as { cliente: { id: string } }).cliente;

    const body = await search("flt7");
    expect(body.customers.map((c) => c.id)).toContain(flatPlateOnly.id);
  });

  it("returns `plates` as a real multi-element array (array_agg), active vehicles only", async () => {
    const body = await search("Lucía Fernández");
    const row = body.customers.find((c) => c.id === threeVehicles.id);
    expect(row?.plates.slice().sort()).toEqual(["AAA111", "BBB222", "CCC333"]);
  });
});

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
    // a828759) — a flat {id, name, price} object throws "missing a usable
    // Producto.id" in parseProduct. `Matrix` is omitted below: `parseProduct`
    // and `warnMalformedWrapper` never read it (Producto/InStock/PriceLists
    // are the only keys the mapper depends on — mapper.ts's own docstring),
    // so it is pure round-trip passthrough this fixture has no use for.
    // `priceLists` below also carries a real "0.00" tier (p2's socio price)
    // — the production-verified case R6's em-dash rule exists for (spec: "A
    // zero tier renders an em-dash").
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

    // The mock seeds "Motor" because that is the mixed case Interfuerza really
    // sends; `normalizeCategory` (mapper.ts, and migration 0011 for rows written
    // before it) folds the typed projection to upper case, so the stored value
    // is "MOTOR" and an exact `eq()` filter must use that. Asserting the folded
    // value here is what makes this the only end-to-end proof that the fold
    // actually reaches the database — every unit test injects its query seam.
    const motorOnly = await listInventory({ categoryL1: "MOTOR" }, { offset: 0, limit: 25 });
    expect(motorOnly.items.map((i) => i.id).sort()).toEqual(["p1", "p2"]);

    // PR10 — grand total stays 3 regardless of the active filter, unlike
    // `listInventory().total` above which is filter-scoped (motorOnly = 2).
    expect(await countAllProducts()).toBe(3);

    // Folded, and still alphabetical: the fold is what collapses the real
    // ERP's "Accesorios"/"ACCESORIOS" into one option instead of two.
    expect(await listCategoryL1Options()).toEqual(["MOTOR", "SUSPENSIÓN"]);
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
        // "MOTOR", not "Motor" — same folded projection as the filter above.
        body: JSON.stringify({ categories: [{ categoryL1: "MOTOR" }] }),
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
