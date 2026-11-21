/**
 * /account is a Server Component: authorize, read the profile, and (only for a role that may send
 * feedback) read the user's own comments. The data modules are mocked with the real row shape.
 */
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => vi.fn());
const getUserProfile = vi.hoisted(() => vi.fn());
const listOwnFeedback = vi.hoisted(() => vi.fn());
const canMock = vi.hoisted(() => vi.fn());
const twoFactorStatus = vi.hoisted(() => vi.fn());
vi.mock("@/modules/auth/session", () => ({ requireSessionFromHeaders: session }));
vi.mock("@/modules/account/queries", () => ({ getUserProfile }));
vi.mock("@/modules/feedback/service", () => ({ listOwnFeedback }));
vi.mock("@/modules/auth/enrolment", async (original) => ({
  ...(await original<typeof import("@/modules/auth/enrolment")>()),
  twoFactorStatus,
}));
vi.mock("@/modules/auth/policy", async (original) => {
  const real = await original<typeof import("@/modules/auth/policy")>();
  canMock.mockImplementation(real.can);
  return { ...real, can: canMock };
});
vi.mock("next/navigation", () => ({ usePathname: () => "/account", useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/shared/ui/ToastProvider", () => ({ useToast: () => ({ addToast: vi.fn() }) }));

import AccountPage from "./page";

const USER = { id: "u1", role: "tecnico", username: "jperez" };

// The wire shape of a `feedback` row; a test overrides only what it is about.
const fbRow = (over: Record<string, unknown> = {}) => ({
  id: "f1",
  userId: "u1",
  username: "jperez",
  role: "tecnico",
  category: "bug",
  text: "No guarda la orden",
  route: "/service-orders/abc",
  screenLabel: "Orden — Detalle",
  createdAt: new Date("2026-11-09T14:12:00Z"),
  deliveredAt: null,
  attempts: 0,
  nextAttemptAt: new Date("2026-11-09T14:12:00Z"),
  lastError: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  session.mockResolvedValue(USER);
  getUserProfile.mockResolvedValue({ username: "jperez", name: "Juan", email: "j@x.com" });
  listOwnFeedback.mockResolvedValue([]);
  twoFactorStatus.mockResolvedValue({ enabled: false, enabledAt: null, codesLeft: 0 });
});

describe("/account", () => {
  it("reads only the signed-in user's comments and renders them after the password form", async () => {
    listOwnFeedback.mockResolvedValue([
      fbRow({ id: "a", text: "Más nuevo", deliveredAt: new Date("2026-11-09T14:13:00Z") }),
      fbRow({ id: "b", text: "Más viejo" }),
    ]);
    render(await AccountPage());

    expect(listOwnFeedback).toHaveBeenCalledWith("u1");
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByText("Más nuevo")).toBeInTheDocument();
    expect(within(items[0]).getByText("Enviado")).toBeInTheDocument();
    expect(within(items[1]).getByText("Pendiente de envío")).toBeInTheDocument();
    // Formatted in the workshop's zone (UTC-5), never the server's.
    expect(within(items[0]).getByText(/9:12:00/)).toBeInTheDocument();
    expect(screen.getByText("Contraseña actual").compareDocumentPosition(screen.getByText("Mis comentarios"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("shows the empty state for a user with no comments", async () => {
    render(await AccountPage());
    expect(screen.getByText("Todavía no enviaste comentarios")).toBeInTheDocument();
  });

  it("neither reads nor renders the card when the role cannot send feedback", async () => {
    canMock.mockImplementation((_u: unknown, action: string) => action !== "feedback.send");
    render(await AccountPage());
    expect(listOwnFeedback).not.toHaveBeenCalled();
    expect(screen.queryByText("Mis comentarios")).not.toBeInTheDocument();
    expect(screen.getByText("Mi cuenta")).toBeInTheDocument();
  });

  it("renders the 2FA section between the profile and the password form, for the session user", async () => {
    render(await AccountPage());

    expect(twoFactorStatus).toHaveBeenCalledWith("u1");
    const heading = screen.getByRole("heading", { name: "Verificación en dos pasos" });
    expect(screen.getByText("Usuario").compareDocumentPosition(heading)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(heading.compareDocumentPosition(screen.getByText("Contraseña actual"))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByText(/Es opcional para tu rol\./)).toBeInTheDocument();
  });

  // 23 is above 12, so a month-first date cannot pass; 03:00 UTC is still the 22nd in the workshop (UTC-5).
  it("shows the enabled date as dd/mm/aaaa in the workshop's zone, and the codes left", async () => {
    twoFactorStatus.mockResolvedValue({ enabled: true, enabledAt: new Date("2026-11-23T03:00:00Z"), codesLeft: 7 });
    render(await AccountPage());
    expect(screen.getByText(/Te quedan/)).toHaveTextContent("Activada el 22/11/2026. Te quedan 7 de 10 códigos de recuperación.");
  });

  it("treats an administrador as a mandatory role: no Desactivar", async () => {
    session.mockResolvedValue({ ...USER, role: "administrador" });
    twoFactorStatus.mockResolvedValue({ enabled: true, enabledAt: new Date("2026-11-23T15:00:00Z"), codesLeft: 10 });
    render(await AccountPage());
    expect(screen.getByRole("button", { name: "Generar códigos nuevos" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Desactivar" })).not.toBeInTheDocument();
  });
});
