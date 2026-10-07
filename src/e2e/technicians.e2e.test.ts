/**
 * Real-SQL proof for technicians-and-work-lines WU2. The unit tests inject the
 * transaction and every query, so they prove nothing about `ON CONFLICT`, the
 * UNIQUE link, or that a roster failure really rolls the user insert back. Run
 * against a THROWAWAY database (`dforce_e2e`) — never the dev one.
 */
import { execSync } from "node:child_process";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/shared/db/client";
import { tecnico, users } from "@/shared/db/schema";
import { createUser, updateUser } from "../modules/account/service";
import { listRoster, listTecnicoLogins } from "../modules/technicians/queries";
import { createTecnico, TechnicianLinkError, updateTecnico } from "../modules/technicians/service";

describe("technician roster (E2E)", () => {
  const stamp = Date.now();
  const made: string[] = [];
  let actorId: string;

  const insertUser = async (suffix: string, role: "tecnico" | "administrador", name: string | null = null) => {
    const [u] = await db
      .insert(users)
      .values({ username: `e2e-tech-${suffix}-${stamp}`, passwordHash: "x", role, name })
      .returning({ id: users.id });
    made.push(u.id);
    return u.id;
  };
  const rosterOf = (userId: string) => db.select().from(tecnico).where(eq(tecnico.userId, userId));

  beforeAll(async () => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
    actorId = await insertUser("actor", "administrador");
    await insertUser("floor", "administrador"); // keeps the target from being the last active admin
  }, 60_000);

  afterAll(async () => {
    await db.delete(tecnico).where(inArray(tecnico.userId, made));
    await db.delete(users).where(inArray(users.id, made));
    await db.$client.end();
  });

  it("a second link to the same login is refused, even when the pre-check is bypassed (DB UNIQUE)", async () => {
    const userId = await insertUser("dup", "tecnico");
    await createTecnico({ role: "administrador" }, { nombre: "Uno", userId });

    await expect(createTecnico({ role: "administrador" }, { nombre: "Dos", userId })).rejects.toThrow(
      "Ese usuario ya está vinculado a otro técnico.",
    );
    await expect(
      createTecnico({ role: "administrador" }, { nombre: "Tres", userId }, { findByUserId: async () => null }),
    ).rejects.toBeInstanceOf(TechnicianLinkError);
    expect(await rosterOf(userId)).toHaveLength(1);
  });

  it("rename, deactivate and reactivate persist on the real row; an unknown id is not found", async () => {
    const row = await createTecnico({ role: "jefe_taller" }, { nombre: "Luis" });
    await updateTecnico({ role: "jefe_taller" }, row.id, { nombre: "Luis R.", active: false });
    const [off] = await db.select().from(tecnico).where(eq(tecnico.id, row.id));
    expect(off.nombre).toBe("Luis R.");
    expect(off.deactivatedAt).toBeInstanceOf(Date);

    await updateTecnico({ role: "jefe_taller" }, row.id, { active: true });
    const [on] = await db.select().from(tecnico).where(eq(tecnico.id, row.id));
    expect(on.deactivatedAt).toBeNull();

    await expect(updateTecnico({ role: "jefe_taller" }, "no-such-id", { nombre: "X" })).rejects.toThrow("Technician not found");
    await db.delete(tecnico).where(eq(tecnico.id, row.id));
  });

  it("createUser as técnico creates the login and one linked row named from name, then username", async () => {
    const named = await createUser({ username: `e2e-tech-named-${stamp}`, password: "temporal1", role: "tecnico", name: "Ana Ruiz" });
    const blank = await createUser({ username: `e2e-tech-blank-${stamp}`, password: "temporal1", role: "tecnico", name: "  " });
    const admin = await createUser({ username: `e2e-tech-adm-${stamp}`, password: "temporal1", role: "administrador" });
    made.push(named.id, blank.id, admin.id);

    expect((await rosterOf(named.id)).map((r) => r.nombre)).toEqual(["Ana Ruiz"]);
    expect((await rosterOf(blank.id)).map((r) => r.nombre)).toEqual([`e2e-tech-blank-${stamp}`]);
    expect(await rosterOf(admin.id)).toHaveLength(0);
  });

  it("a roster failure rolls the user insert back: no login, no row", async () => {
    const username = `e2e-tech-rollback-${stamp}`;

    await expect(
      createUser(
        { username, password: "temporal1", role: "tecnico" },
        {
          ensureRosterRow: async () => {
            throw new Error("forced roster failure");
          },
        },
      ),
    ).rejects.toThrow("forced roster failure");

    expect(await db.select().from(users).where(eq(users.username, username))).toHaveLength(0);
  });

  it("promoting a deactivated login creates its roster row deactivated too, like the 0029 backfill", async () => {
    const off = await insertUser("off", "administrador", "Inactivo");
    await db.update(users).set({ deactivatedAt: new Date() }).where(eq(users.id, off));
    await updateUser(actorId, off, { role: "tecnico" });
    const [row] = await rosterOf(off);
    expect(row.deactivatedAt).toBeInstanceOf(Date);
  });

  it("promotion to técnico creates the row once, reuses an existing link, and demotion keeps it", async () => {
    const fresh = await insertUser("promo", "administrador", "Pedro");
    await updateUser(actorId, fresh, { role: "tecnico" });
    const [created] = await rosterOf(fresh);
    expect(created.nombre).toBe("Pedro");

    await updateUser(actorId, fresh, { role: "administrador" });
    expect(await rosterOf(fresh)).toHaveLength(1);

    await updateUser(actorId, fresh, { role: "tecnico" });
    const after = await rosterOf(fresh);
    expect(after.map((r) => r.id)).toEqual([created.id]);

    const linked = await insertUser("linked", "administrador");
    const [manual] = await db.insert(tecnico).values({ nombre: "Manual", userId: linked }).returning();
    await updateUser(actorId, linked, { role: "tecnico" });
    expect((await rosterOf(linked)).map((r) => r.id)).toEqual([manual.id]);
  });
  // WU3 reads: the roster page's two server queries. Their value is a JOIN and a
  // WHERE, which no injected-seam test executes.
  it("listRoster joins the linked username and keeps deactivated rows; listTecnicoLogins offers only active técnico logins", async () => {
    const linked = await insertUser("roster-linked", "tecnico");
    const off = await insertUser("roster-off", "tecnico");
    await db.update(users).set({ deactivatedAt: new Date() }).where(eq(users.id, off));
    const admin = await insertUser("roster-admin", "administrador");
    const [withLogin] = await db.insert(tecnico).values({ nombre: "Con login", userId: linked }).returning();
    const [noLogin] = await db.insert(tecnico).values({ nombre: "Sin login", deactivatedAt: new Date() }).returning();

    const roster = await listRoster();
    const a = roster.find((r) => r.id === withLogin.id)!;
    const b = roster.find((r) => r.id === noLogin.id)!;
    expect(a).toMatchObject({ nombre: "Con login", userId: linked, username: `e2e-tech-roster-linked-${stamp}`, deactivatedAt: null });
    expect(b).toMatchObject({ nombre: "Sin login", userId: null, username: null });
    expect(b.deactivatedAt).toBeInstanceOf(Date);

    const logins = (await listTecnicoLogins()).map((l) => l.id);
    expect(logins).toContain(linked);
    expect(logins).not.toContain(off);
    expect(logins).not.toContain(admin);
    await db.delete(tecnico).where(inArray(tecnico.id, [withLogin.id, noLogin.id]));
  });
});
