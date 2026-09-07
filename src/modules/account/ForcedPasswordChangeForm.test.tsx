/**
 * Component tests for the forced-rotation screen (design.md Decision 8). This
 * is the only surface a `mustChangePassword` user can reach, so the two things
 * that must never break are: the form can actually submit, and the logout
 * escape hatch is present. Without the latter a user unwilling to rotate is
 * trapped with no way out — worse than the problem being solved.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ForcedPasswordChangeForm } from "./ForcedPasswordChangeForm";

const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

function mockFetch(response: { status: number; body?: unknown }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    json: async () => response.body ?? {},
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function fillAndSubmit(
  user: ReturnType<typeof userEvent.setup>,
  values: { current: string; next: string; confirm?: string },
) {
  await user.type(screen.getByLabelText("Contraseña temporal"), values.current);
  await user.type(screen.getByLabelText("Nueva contraseña"), values.next);
  await user.type(screen.getByLabelText("Confirmar nueva contraseña"), values.confirm ?? values.next);
  await user.click(screen.getByRole("button", { name: "Cambiar contraseña" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("ForcedPasswordChangeForm — server rejections", () => {
  it("shows the server's message when the current password is wrong", async () => {
    const user = userEvent.setup();
    mockFetch({ status: 400, body: { error: "Contraseña actual incorrecta." } });

    render(<ForcedPasswordChangeForm />);
    await fillAndSubmit(user, { current: "wrong", next: "a-new-password" });

    expect(await screen.findByRole("alert")).toHaveTextContent("Contraseña actual incorrecta.");
    expect(push).not.toHaveBeenCalled();
  });

  it("shows the server's message when the new password repeats the temporary one", async () => {
    const user = userEvent.setup();
    mockFetch({ status: 400, body: { error: "La nueva contraseña debe ser distinta de la actual." } });

    render(<ForcedPasswordChangeForm />);
    await fillAndSubmit(user, { current: "temp-pass", next: "temp-pass" });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La nueva contraseña debe ser distinta de la actual.",
    );
    expect(push).not.toHaveBeenCalled();
  });
});

describe("ForcedPasswordChangeForm — network failure", () => {
  it("recovers from a rejected fetch instead of hanging on the disabled button", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    render(<ForcedPasswordChangeForm />);
    await fillAndSubmit(user, { current: "temp-pass", next: "a-new-password" });

    // The FULL sentence, not a prefix — see the note in `UsersTable.test.tsx`.
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo conectar. Revisa tu conexión e intenta de nuevo.");
    // Re-enabled: a flagged user is blocked from every other surface, so a
    // permanently disabled submit button strands them with no unlock path.
    expect(screen.getByRole("button", { name: "Cambiar contraseña" })).toBeEnabled();
  });
});

describe("ForcedPasswordChangeForm — client-side validation", () => {
  it("rejects a mismatched confirmation without calling the API", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 200 });

    render(<ForcedPasswordChangeForm />);
    await fillAndSubmit(user, { current: "temp-pass", next: "a-new-password", confirm: "different" });

    expect(await screen.findByRole("alert")).toHaveTextContent("Las contraseñas no coinciden.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a too-short password without calling the API", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 200 });

    render(<ForcedPasswordChangeForm />);
    await fillAndSubmit(user, { current: "temp-pass", next: "abc" });

    expect(await screen.findByRole("alert")).toHaveTextContent("al menos 6 caracteres");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The rule is enforced server-side too (service.ts); catching it here just
  // saves a round-trip and gives the user the message immediately.
  it("rejects reusing the temporary password before calling the API", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 200 });

    render(<ForcedPasswordChangeForm />);
    await fillAndSubmit(user, { current: "temp-pass", next: "temp-pass" });

    expect(await screen.findByRole("alert")).toHaveTextContent("distinta");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/**
 * `router.push("/")` runs OUTSIDE the `try` that catches the fetch, so a push
 * that throws is never reported as a connection failure over a password that
 * WAS rotated — which on this screen would be the worst possible lie: the user
 * is locked out of every other surface until the rotation lands, and the one
 * message telling them it failed would be false.
 */
describe("ForcedPasswordChangeForm — a throwing push is not a connection failure", () => {
  it("does not show the connection error when the redirect itself throws", async () => {
    const user = userEvent.setup();
    mockFetch({ status: 200, body: { success: true } });
    const boom = new Error("push blew up");
    push.mockImplementationOnce(() => {
      throw boom;
    });

    // The throw ESCAPES — that is the property under test — so it surfaces as
    // an unhandled rejection. Captured rather than left for the runner: a
    // stray one is silent under this config and a red suite under a stricter
    // one (`customers/service.test.ts` documents the same trap). Capturing it
    // also makes "no connection error appeared" a positive claim: the error
    // went somewhere, and that somewhere was not the operator's screen.
    const escaped: unknown[] = [];
    const capture = (reason: unknown) => escaped.push(reason);
    process.on("unhandledRejection", capture);
    try {
      render(<ForcedPasswordChangeForm />);
      await fillAndSubmit(user, { current: "temp-pass", next: "a-new-password" });

      await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(escaped).toContain(boom));
    } finally {
      process.off("unhandledRejection", capture);
    }

    expect(screen.queryByText("No se pudo conectar. Revisa tu conexión e intenta de nuevo.")).not.toBeInTheDocument();
  });
});

describe("ForcedPasswordChangeForm — success", () => {
  it("posts to the session-only password route and clears every field", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 200, body: { success: true } });

    render(<ForcedPasswordChangeForm />);
    await fillAndSubmit(user, { current: "temp-pass", next: "a-new-password" });

    expect(fetchMock).toHaveBeenCalledWith("/api/account/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: "temp-pass", newPassword: "a-new-password" }),
    });

    // Cleared so a shared or unattended screen does not keep the temporary
    // password sitting in an input after the rotation completes.
    expect(await screen.findByLabelText("Contraseña temporal")).toHaveValue("");
    expect(screen.getByLabelText("Nueva contraseña")).toHaveValue("");
    expect(screen.getByLabelText("Confirmar nueva contraseña")).toHaveValue("");
  });

  it("navigates into the app once the flag is cleared", async () => {
    const user = userEvent.setup();
    mockFetch({ status: 200, body: { success: true } });

    render(<ForcedPasswordChangeForm />);
    await fillAndSubmit(user, { current: "temp-pass", next: "a-new-password" });

    // push, not refresh: refreshing /change-password re-renders the same
    // screen, and the proxy would no longer redirect away from it.
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/"));
  });
});

describe("ForcedPasswordChangeForm — the escape hatch", () => {
  it("offers a logout control so the user is never trapped", async () => {
    render(<ForcedPasswordChangeForm />);

    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeInTheDocument();
  });

  it("logs out through the exempt /api/logout route and returns to /login", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 200 });

    render(<ForcedPasswordChangeForm />);
    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/logout", { method: "POST" });
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
  });
});
