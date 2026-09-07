/**
 * Component tests for the admin create/edit user dialog (WU5b).
 *
 * The behaviours worth pinning are the ones that either create a broken
 * account or lose the admin's typing: what the client refuses to send, what
 * the payload actually looks like, and how a server-side duplicate lands back
 * on the offending field instead of as a generic failure.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MIN_PASSWORD_LENGTH } from "./password-policy";
import { UserForm } from "./UserForm";

const EXISTING = {
  id: "u-1",
  username: "ana",
  name: "Ana Ruiz",
  email: "ana@taller.com",
  role: "administrador",
};

function mockFetch(response: { status: number; body?: unknown }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    json: async () => response.body ?? {},
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Every assertion here starts with the dialog open — it is closed until its trigger is clicked. */
async function open(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole("button", { name: label }));
}

async function chooseRole(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByLabelText("Rol"));
  await user.click(await screen.findByRole("option", { name: label }));
}

/**
 * Queried by role, not by label text: the base-ui Checkbox puts the `id` on an
 * `aria-hidden` input and labels the visible control through `aria-labelledby`,
 * so `getByLabelText` matches both and throws.
 */
function resetPasswordBox() {
  return screen.getByRole("checkbox", { name: "Restablecer contraseña" });
}

function bodyOf(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  return JSON.parse(fetchMock.mock.calls[call][1].body);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("UserForm — what it refuses to send", () => {
  it("requires a username", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 201 });
    render(<UserForm />);
    await open(user, "Nuevo usuario");

    await chooseRole(user, "Técnico");
    await user.type(screen.getByLabelText("Contraseña inicial"), "secreto123");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText(/usuario es obligatorio/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires a role", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 201 });
    render(<UserForm />);
    await open(user, "Nuevo usuario");

    await user.type(screen.getByLabelText("Usuario"), "beto");
    await user.type(screen.getByLabelText("Contraseña inicial"), "secreto123");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText(/rol es obligatorio/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Mirrors PasswordForm.tsx's client-side floor: the server enforces the same
  // rule, but bouncing it here keeps the admin's typing on screen.
  it("rejects a password under the shared minimum before any request", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 201 });
    render(<UserForm />);
    await open(user, "Nuevo usuario");

    await user.type(screen.getByLabelText("Usuario"), "beto");
    await chooseRole(user, "Técnico");
    await user.type(screen.getByLabelText("Contraseña inicial"), "a".repeat(MIN_PASSWORD_LENGTH - 1));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText(new RegExp(`${MIN_PASSWORD_LENGTH} caracteres`))).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("UserForm — creating", () => {
  it("POSTs to /api/users with the typed fields", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 201, body: { user: { id: "u-9" } } });
    render(<UserForm />);
    await open(user, "Nuevo usuario");

    await user.type(screen.getByLabelText("Usuario"), "beto");
    await user.type(screen.getByLabelText("Nombre"), "Beto Díaz");
    await user.type(screen.getByLabelText("Email"), "beto@taller.com");
    await chooseRole(user, "Técnico");
    await user.type(screen.getByLabelText("Contraseña inicial"), "secreto123");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/users");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(bodyOf(fetchMock)).toEqual({
      username: "beto",
      name: "Beto Díaz",
      email: "beto@taller.com",
      role: "tecnico",
      password: "secreto123",
    });
  });

  // Blank optionals are omitted, not sent as "" — createUser() treats an empty
  // email as null but an empty string would still travel the wire as a value.
  it("omits blank optional fields instead of sending empty strings", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 201, body: { user: { id: "u-9" } } });
    render(<UserForm />);
    await open(user, "Nuevo usuario");

    await user.type(screen.getByLabelText("Usuario"), "beto");
    await chooseRole(user, "Administrador");
    await user.type(screen.getByLabelText("Contraseña inicial"), "secreto123");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = bodyOf(fetchMock);
    expect(body).not.toHaveProperty("name");
    expect(body).not.toHaveProperty("email");
    expect(body.role).toBe("administrador");
  });

  it("calls onSaved after a successful create", async () => {
    const user = userEvent.setup();
    mockFetch({ status: 201, body: { user: { id: "u-9" } } });
    const onSaved = vi.fn();
    render(<UserForm onSaved={onSaved} />);
    await open(user, "Nuevo usuario");

    await user.type(screen.getByLabelText("Usuario"), "beto");
    await chooseRole(user, "Técnico");
    await user.type(screen.getByLabelText("Contraseña inicial"), "secreto123");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
  });
});

/**
 * `setOpen`/`onSaved` sit inside a SECOND `try` that has only a `finally` and
 * no `catch`, so a throwing `onSaved` propagates instead of being reported as
 * a connection failure. Not pinned here for the same reason as the other two
 * dialog forms — see the note in `CustomerForm.test.tsx`; the dialog is closed
 * before any message could render. `OrderStatusControls`, `UsersTable` and
 * `ForcedPasswordChangeForm` carry the guard.
 */
describe("UserForm — when the server refuses", () => {
  it("lands a duplicate email on the email field", async () => {
    const user = userEvent.setup();
    mockFetch({ status: 409, body: { error: "duplicate_email" } });
    render(<UserForm />);
    await open(user, "Nuevo usuario");

    await user.type(screen.getByLabelText("Usuario"), "beto");
    await user.type(screen.getByLabelText("Email"), "ana@taller.com");
    await chooseRole(user, "Técnico");
    await user.type(screen.getByLabelText("Contraseña inicial"), "secreto123");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/email/i);
    expect(alert).not.toHaveTextContent("duplicate_email");
  });

  // Two distinct 409 codes exist precisely so the form can mark the right
  // field; collapsing them into one message would throw that away.
  it("lands a duplicate username on the username field", async () => {
    const user = userEvent.setup();
    mockFetch({ status: 409, body: { error: "duplicate_username" } });
    render(<UserForm />);
    await open(user, "Nuevo usuario");

    await user.type(screen.getByLabelText("Usuario"), "ana");
    await chooseRole(user, "Técnico");
    await user.type(screen.getByLabelText("Contraseña inicial"), "secreto123");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/usuario/i);
    expect(alert).not.toHaveTextContent("duplicate_username");
  });

  it("surfaces field errors returned as a 400 map", async () => {
    const user = userEvent.setup();
    mockFetch({ status: 400, body: { errors: { email: "Email must be a valid email address" } } });
    render(<UserForm />);
    await open(user, "Nuevo usuario");

    await user.type(screen.getByLabelText("Usuario"), "beto");
    await chooseRole(user, "Técnico");
    await user.type(screen.getByLabelText("Contraseña inicial"), "secreto123");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Email must be a valid email address");
  });

  // A rejected fetch must not strand the admin on a permanently disabled
  // button — the same defect the RDD review caught in WU3's change-password form.
  it("recovers from a rejected fetch instead of leaving Guardar disabled", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<UserForm />);
    await open(user, "Nuevo usuario");

    await user.type(screen.getByLabelText("Usuario"), "beto");
    await chooseRole(user, "Técnico");
    await user.type(screen.getByLabelText("Contraseña inicial"), "secreto123");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    // The FULL sentence, not `/no se pudo/i`: `CONNECTION_ERROR` is shared by
    // six surfaces, and a three-word regex leaves the rest of it rewritable
    // with this file still green.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo conectar. Revisa tu conexión e intenta de nuevo.",
    );
    expect(screen.getByRole("button", { name: "Guardar" })).toBeEnabled();
  });
});

describe("UserForm — editing", () => {
  it("prefills the existing name, email and role", async () => {
    const user = userEvent.setup();
    render(<UserForm user={EXISTING} />);
    await open(user, "Editar");

    expect(screen.getByLabelText("Nombre")).toHaveValue("Ana Ruiz");
    expect(screen.getByLabelText("Email")).toHaveValue("ana@taller.com");
    expect(screen.getByLabelText("Rol")).toHaveTextContent("Administrador");
  });

  // The username is the login identifier and `updateUser()` cannot change it —
  // an editable field the server ignores is a lie to the admin.
  it("shows the username as read-only", async () => {
    const user = userEvent.setup();
    render(<UserForm user={EXISTING} />);
    await open(user, "Editar");

    expect(screen.getByLabelText("Usuario")).toHaveAttribute("readonly");
  });

  it("hides the password field until a reset is requested", async () => {
    const user = userEvent.setup();
    render(<UserForm user={EXISTING} />);
    await open(user, "Editar");

    expect(screen.queryByLabelText("Nueva contraseña")).not.toBeInTheDocument();

    await user.click(resetPasswordBox());

    expect(screen.getByLabelText("Nueva contraseña")).toBeInTheDocument();
  });

  it("PATCHes without a password when no reset was requested", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 200, body: { success: true } });
    render(<UserForm user={EXISTING} />);
    await open(user, "Editar");

    await user.clear(screen.getByLabelText("Nombre"));
    await user.type(screen.getByLabelText("Nombre"), "Ana R. Ruiz");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/users/u-1");
    expect(fetchMock.mock.calls[0][1].method).toBe("PATCH");
    const body = bodyOf(fetchMock);
    expect(body.name).toBe("Ana R. Ruiz");
    expect(body).not.toHaveProperty("password");
  });

  it("includes the password only when the reset box is checked", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 200, body: { success: true } });
    render(<UserForm user={EXISTING} />);
    await open(user, "Editar");

    await user.click(resetPasswordBox());
    await user.type(screen.getByLabelText("Nueva contraseña"), "nuevo-secreto");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(bodyOf(fetchMock).password).toBe("nuevo-secreto");
  });

  it("applies the same password floor to a reset", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 200, body: { success: true } });
    render(<UserForm user={EXISTING} />);
    await open(user, "Editar");

    await user.click(resetPasswordBox());
    await user.type(screen.getByLabelText("Nueva contraseña"), "a".repeat(MIN_PASSWORD_LENGTH - 1));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText(new RegExp(`${MIN_PASSWORD_LENGTH} caracteres`))).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Clearing an optional field must reach the server as an explicit null,
  // otherwise `updateUser()`'s "only the supplied keys" patch leaves the old
  // value in place and the admin's deletion silently does nothing.
  it("sends a cleared email as an empty value rather than omitting it", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 200, body: { success: true } });
    render(<UserForm user={EXISTING} />);
    await open(user, "Editar");

    await user.clear(screen.getByLabelText("Email"));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(bodyOf(fetchMock)).toHaveProperty("email", "");
  });
});
