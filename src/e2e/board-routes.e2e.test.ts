/**
 * Real-SQL, real-session proof for workshop-status-board WU3 (the customer view) and
 * WU4 (the full board): pages and poll routes behind the real `proxy.ts`. The unit tests inject the session and
 * the query; here the session rows, the revocation and the board query are the real
 * ones. Run against the THROWAWAY `dforce_e2e` database only.
 */
import { execSync } from "node:child_process";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const forged = vi.hoisted(() => ({ headers: {} as Record<string, string> }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(forged.headers) }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

import { NextRequest, type NextResponse } from "next/server";
import { authenticateUser } from "@/modules/auth/authenticate";
import { SESSION_COOKIE } from "@/modules/auth/session";
import { CustomerBoard } from "@/modules/board/CustomerBoard";
import { WorkshopBoard } from "@/modules/board/WorkshopBoard";
import { db } from "@/shared/db/client";
import { cliente, ordenServicio, sessions, tecnico, users, vehiculo } from "@/shared/db/schema";
import { PermissionDenied } from "@/shared/ui/PermissionDenied";
import { GET as fullBoardGET } from "../app/api/board/route";
import { GET as boardGET } from "../app/api/board/clientes/route";
import BoardPage from "../app/tablero/page";
import CustomerBoardPage from "../app/tablero/clientes/page";
import { changePassword, createUser, updateUser } from "../modules/account/service";
import { handleProxy } from "../proxy";
import { purgeHistory } from "./purge-history";

const PASSWORD = "temporal-123";
const SENTINEL_NAME = "SENTINEL_ROUTE_CUSTOMER_NAME";
const SENTINEL_PHONE = "50769990002";

describe("board routes (E2E)", () => {
  const stamp = Date.now();
  const made: string[] = [];
  let actorId: string;
  let clienteId: string;
  const plate = `RT${stamp}`;

  const mk = async (suffix: string, role: "administrador" | "tecnico" | "jefe_taller" | "pantalla") => {
    const username = `e2e-brd-${suffix}-${stamp}`;
    const { id } = await createUser({ username, password: PASSWORD, role });
    made.push(id);
    return { id, username, role };
  };
  /** A session that already passed the forced password change, as a screen in service has. */
  const loggedIn = async (suffix: string, role: "tecnico" | "jefe_taller" | "pantalla") => {
    const user = await mk(suffix, role);
    const r = await authenticateUser(user.username, PASSWORD);
    if (!r.ok) throw new Error("login refused");
    await changePassword(user.id, PASSWORD, "otra-clave-456", r.token);
    return { ...user, token: r.token };
  };
  const request = (pathname: string, token?: string) =>
    new NextRequest(`http://localhost${pathname}`, { headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : {} });
  /** What the platform does: proxy first, then the route with the identity headers the proxy forwarded. */
  const poll = async (token?: string, full = false): Promise<NextResponse | Response> => {
    const path = full ? "/api/board" : "/api/board/clientes";
    const res = await handleProxy(request(path, token));
    if (res.headers.get("x-middleware-next") !== "1") return res;
    const headers: Record<string, string> = {};
    for (const [k, v] of res.headers) if (k.startsWith("x-middleware-request-")) headers[k.replace("x-middleware-request-", "")] = v;
    return (full ? fullBoardGET : boardGET)(new NextRequest(`http://localhost${path}`, { headers }));
  };
  const asUser = (u: { id: string; role: string }) => {
    forged.headers = { "x-user-id": u.id, "x-user-role": u.role };
  };

  beforeAll(async () => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
    actorId = (await mk("actor", "administrador")).id;
    const [c] = await db.insert(cliente).values({ name: SENTINEL_NAME, phone: SENTINEL_PHONE }).returning({ id: cliente.id });
    clienteId = c.id;
    const [v] = await db.insert(vehiculo).values({ clienteId, plate, make: "Toyota", model: "Hilux", motor: "combustion" }).returning({ id: vehiculo.id });
    await db.insert(ordenServicio).values({ clienteId, vehiculoId: v.id, categoria: "revisado", status: "open" });
  }, 60_000);

  afterAll(async () => {
    await purgeHistory([clienteId]);
    await db.delete(ordenServicio).where(eq(ordenServicio.clienteId, clienteId));
    await db.delete(vehiculo).where(eq(vehiculo.clienteId, clienteId));
    await db.delete(cliente).where(eq(cliente.id, clienteId));
    await db.delete(tecnico).where(inArray(tecnico.userId, made));
    await db.delete(sessions).where(inArray(sessions.userId, made));
    await db.delete(users).where(inArray(users.id, made));
    await db.$client.end();
  });

  it("pantalla reads the poll route (whitelist rows, no customer data) and its page renders the board, not PermissionDenied", async () => {
    const tv = await loggedIn("tv", "pantalla");

    const res = await poll(tv.token);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(SENTINEL_NAME);
    expect(text).not.toContain(SENTINEL_PHONE);
    const body = JSON.parse(text);
    expect(body.rows.find((r: { plate: string }) => r.plate === plate)).toEqual({ plate, make: "Toyota", model: "Hilux", status: "Recibida" });

    asUser(tv);
    const element = await CustomerBoardPage();
    expect(element.type).toBe(CustomerBoard);
  });

  it("tecnico is refused by the route (403 JSON) and by the page", async () => {
    const tech = await loggedIn("tech", "tecnico");

    const res = await poll(tech.token);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });

    asUser(tech);
    expect((await CustomerBoardPage()).type).toBe(PermissionDenied);
  });

  it("jefe_taller reads the poll route", async () => {
    const jefe = await loggedIn("jefe", "jefe_taller");
    expect((await poll(jefe.token)).status).toBe(200);
  });

  it("no cookie, an unknown token, an expired session and a revoked session: page redirects to /login, route answers 401 JSON", async () => {
    const expired = await loggedIn("expired", "pantalla");
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.id, expired.token));
    const revoked = await loggedIn("revoked", "pantalla");
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, revoked.token));

    for (const token of [undefined, "no-such-token", expired.token, revoked.token]) {
      const page = await handleProxy(request("/tablero/clientes", token));
      expect(page.status).toBe(307);
      expect(page.headers.get("location")).toBe("http://localhost/login");
      const api = await poll(token);
      expect(api.status).toBe(401);
      expect(api.headers.get("content-type")).toContain("application/json");
      expect(await api.json()).toEqual({ error: "Unauthorized" });
    }
  });

  it("an administrador password reset revokes the screen's session: its next poll is 401", async () => {
    const tv = await loggedIn("reset", "pantalla");
    expect((await poll(tv.token)).status).toBe(200);

    await updateUser(actorId, tv.id, { password: "reseteada-789" });

    expect((await poll(tv.token)).status).toBe(401);
  });

  it("a database failure on the real path is a JSON 5xx, not an HTML page", async () => {
    const tv = await loggedIn("dbfail", "pantalla");
    const spy = vi.spyOn(db, "select").mockImplementation(() => {
      throw new Error("connection terminated");
    });
    try {
      const headers = { "x-user-id": tv.id, "x-user-role": "pantalla" };
      const res = await boardGET(new NextRequest("http://localhost/api/board/clientes", { headers }));
      expect(res.status).toBe(500);
      expect(res.headers.get("content-type")).toContain("application/json");
    } finally {
      spy.mockRestore();
    }
  });

  // ---- WU4: the full board ----

  it("Técnico reads the full board: /tablero and GET /api/board show an order nobody assigned to them", async () => {
    const tech = await loggedIn("fulltech", "tecnico");

    const res = await poll(tech.token, true);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows.map((r: { plate: string }) => r.plate)).toContain(plate);

    asUser(tech);
    const element = await BoardPage();
    expect(element.type).toBe(WorkshopBoard);
    expect(element.props.initial.rows.map((r: { plate: string }) => r.plate)).toContain(plate);
  });

  it("Pantalla is denied the full board: the page renders PermissionDenied and the route answers 403 JSON", async () => {
    const tv = await loggedIn("fulltv", "pantalla");

    const res = await poll(tv.token, true);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });

    asUser(tv);
    expect((await BoardPage()).type).toBe(PermissionDenied);
  });

  it("Customer data seeded, board payload clean: the administrador's /api/board body has neither the name nor the phone", async () => {
    const admin = await loggedIn("fulladmin", "jefe_taller");

    const text = await (await poll(admin.token, true)).text();

    expect(text).toContain(plate); // the seeded order is in the body, so the absences below mean something
    expect(text).not.toContain(SENTINEL_NAME);
    expect(text).not.toContain(SENTINEL_PHONE);
  });

  it("Unauthenticated: /tablero redirects to /login and /api/board answers 401 JSON", async () => {
    const page = await handleProxy(request("/tablero"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe("http://localhost/login");

    const api = await poll(undefined, true);
    expect(api.status).toBe(401);
    expect(api.headers.get("content-type")).toContain("application/json");
    expect(await api.json()).toEqual({ error: "Unauthorized" });
  });
});
