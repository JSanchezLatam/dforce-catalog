/**
 * /users is a Server Component: it authorizes, reads, and hands serialised rows
 * to `UsersTable`. Queries are mocked at the module boundary with their real
 * row shape; `userAccessFacts`' SQL is pinned in `src/e2e/two-factor-reset.e2e.test.ts`.
 */
import { formatDateTime } from "@/shared/datetime";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => vi.fn());
vi.mock("@/modules/auth/session", () => ({ requireSessionFromHeaders: session }));

const q = vi.hoisted(() => ({ listUsers: vi.fn(), userAccessFacts: vi.fn() }));
vi.mock("@/modules/account/queries", () => q);

const userLocks = vi.hoisted(() => vi.fn());
vi.mock("@/modules/auth/login-attempts", () => ({ userLocks }));

const table = vi.hoisted(() => vi.fn());
vi.mock("@/modules/account/UsersTable", () => ({
  UsersTable: (props: unknown) => {
    table(props);
    return <div data-testid="users-table" />;
  },
}));
vi.mock("@/modules/account/UserFormTrigger", () => ({ UserFormTrigger: () => null }));

import UsersPage from "./page";

const lastAccess = new Date("2026-11-18T22:55:00.000Z");
const user = (id: string, username: string, role: string) => ({
  id,
  username,
  name: null,
  email: null,
  role,
  deactivatedAt: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  session.mockResolvedValue({ id: "a-1", role: "administrador" });
  q.listUsers.mockResolvedValue([
    user("a-1", "jsanchez", "administrador"),
    user("j-1", "mrodriguez", "jefe_taller"),
    user("t-1", "lperez", "tecnico"),
    user("p-1", "tv", "pantalla"),
  ]);
  q.userAccessFacts.mockResolvedValue(
    new Map([
      ["a-1", { twoFactor: "enabled", lastAccessAt: lastAccess }],
      ["j-1", { twoFactor: "enrolling", lastAccessAt: null }],
      ["t-1", { twoFactor: null, lastAccessAt: null }],
      ["p-1", { twoFactor: null, lastAccessAt: null }],
    ]),
  );
  userLocks.mockResolvedValue(new Map());
});

describe("Gestión de usuarios", () => {
  it("refuses anyone who cannot manage users, and reads nothing", async () => {
    session.mockResolvedValue({ id: "t", role: "jefe_taller" });

    render(await UsersPage());

    expect(screen.getByText("No tenés permiso para ver esta página")).toBeInTheDocument();
    expect(q.userAccessFacts).not.toHaveBeenCalled();
  });

  it("reads every user's 2FA and last access in one batched call", async () => {
    render(await UsersPage());

    expect(q.userAccessFacts).toHaveBeenCalledTimes(1);
    expect(q.userAccessFacts).toHaveBeenCalledWith(["a-1", "j-1", "t-1", "p-1"]);
  });

  it("passes the viewer's id and serialised 2FA facts, with the mandatory roles marked", async () => {
    render(await UsersPage());

    const props = table.mock.calls[0][0] as { currentUserId: string; users: Record<string, unknown>[] };
    expect(props.currentUserId).toBe("a-1");
    expect(props.users.map(({ id, twoFactor, twoFactorRequired, lastAccess }) => ({ id, twoFactor, twoFactorRequired, lastAccess }))).toEqual([
      { id: "a-1", twoFactor: "enabled", twoFactorRequired: true, lastAccess: formatDateTime(lastAccess) },
      { id: "j-1", twoFactor: "enrolling", twoFactorRequired: true, lastAccess: "—" },
      { id: "t-1", twoFactor: null, twoFactorRequired: false, lastAccess: "—" },
      { id: "p-1", twoFactor: null, twoFactorRequired: false, lastAccess: "—" },
    ]);
  });
});
