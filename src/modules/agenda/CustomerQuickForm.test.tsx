/**
 * Component tests for `CustomerQuickForm` (jsdom). `fetch` returns REAL `Response` objects with the
 * wire shapes of `POST /api/customers` (201 `{cliente}`, 400 `{errors}`, 409 `{error, existingClienteId}`)
 * and `GET /api/customers` (`{customers, total}`, dates as ISO strings). The toast hook is a spy.
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const addToast = vi.fn();
vi.mock("@/shared/ui/ToastProvider", () => ({ useToast: () => ({ addToast }) }));

import { CONNECTION_ERROR } from "@/shared/ui/messages";
import { CustomerQuickForm } from "./CustomerQuickForm";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const CREATED = { id: "c-new", name: "Luis Gómez", phone: "50766667777", email: null, deactivatedAt: null, createdAt: "2026-10-26T00:00:00.000Z" };
const EXISTING = { id: "c-old", name: "Ana Pérez", phone: "50766667777", email: "ana@example.com", deactivatedAt: null, plates: ["ABC111"], createdAt: "2026-01-01T00:00:00.000Z" };
const DUPLICATE = () => json({ error: "duplicate_phone", existingClienteId: "c-old" }, 409);

type Call = { url: string; method: string; body: Record<string, unknown> | null };

/** `posts` answers the POSTs in order (the last one repeats); GET answers the lookup. */
function stubFetch(posts: Array<() => Response | Promise<Response>>, lookup: () => Response = () => json({ customers: [EXISTING], total: 1 })) {
  const calls: Call[] = [];
  let n = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : null });
      if (method === "POST") return posts[Math.min(n++, posts.length - 1)]();
      return lookup();
    }),
  );
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  addToast.mockReset();
});

async function fill(onSaved = vi.fn(), canWrite = true) {
  const user = userEvent.setup();
  render(<CustomerQuickForm canWrite={canWrite} onSaved={onSaved} />);
  return { user, onSaved };
}

async function typeAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Nombre"), "Luis Gómez");
  await user.type(screen.getByLabelText("Teléfono"), "50766667777");
  await user.click(screen.getByRole("button", { name: "Crear cliente" }));
}

const posts = (calls: Call[]) => calls.filter((c) => c.method === "POST");

describe("CustomerQuickForm", () => {
  it("Only two fields: a name and a phone, no opt-out or other field", async () => {
    stubFetch([() => json({ cliente: CREATED }, 201)]);
    await fill();
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/whatsapp|email|cédula/i)).not.toBeInTheDocument();
  });

  it("Create requires customers.write: renders nothing without it", async () => {
    stubFetch([() => json({ cliente: CREATED }, 201)]);
    await fill(vi.fn(), false);
    expect(screen.queryByLabelText("Nombre")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("Successful create selects: exact payload, toast, and the new customer handed back", async () => {
    const calls = stubFetch([() => json({ cliente: CREATED }, 201)]);
    const { user, onSaved } = await fill();
    await typeAndSubmit(user);

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: "/api/customers", method: "POST", body: { name: "Luis Gómez", phone: "50766667777" } });
    expect(onSaved.mock.calls[0][0]).toMatchObject({ id: "c-new", name: "Luis Gómez", plates: [] });
    expect(addToast).toHaveBeenCalledExactlyOnceWith("success", "Cliente creado");
  });

  it("400 field errors show inline per field and select nothing", async () => {
    stubFetch([() => json({ errors: { name: "El nombre es obligatorio", phone: "El teléfono debe tener entre 7 y 15 dígitos" } }, 400)]);
    const { user, onSaved } = await fill();
    await typeAndSubmit(user);

    expect(await screen.findByText("El nombre es obligatorio")).toBeInTheDocument();
    expect(screen.getByText("El teléfono debe tener entre 7 y 15 dígitos")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(addToast).not.toHaveBeenCalled();
  });

  it("A dropped connection shows the connection error and selects nothing", async () => {
    stubFetch([() => Promise.reject(new TypeError("Failed to fetch"))]);
    const { user, onSaved } = await fill();
    await typeAndSubmit(user);

    expect(await screen.findByText(CONNECTION_ERROR)).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("Duplicate offers three choices and no silent create button", async () => {
    stubFetch([DUPLICATE]);
    const { user } = await fill();
    await typeAndSubmit(user);

    expect(await screen.findByRole("button", { name: "Ver el cliente existente" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Usar ese cliente" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar igual" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Crear cliente" })).not.toBeInTheDocument();
  });

  it("Ver el cliente existente looks the phone up and shows the match without selecting it", async () => {
    const calls = stubFetch([DUPLICATE]);
    const { user, onSaved } = await fill();
    await typeAndSubmit(user);
    await user.click(await screen.findByRole("button", { name: "Ver el cliente existente" }));

    expect(await screen.findByText(/Ana Pérez/)).toBeInTheDocument();
    const get = calls.find((c) => c.method === "GET")!;
    expect(get.url).toBe("/api/customers?search=50766667777&pageSize=50&status=all");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("Usar ese cliente selects the existing customer and creates nothing", async () => {
    const calls = stubFetch([DUPLICATE]);
    const { user, onSaved } = await fill();
    await typeAndSubmit(user);
    await user.click(await screen.findByRole("button", { name: "Usar ese cliente" }));

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onSaved.mock.calls[0][0]).toMatchObject({ id: "c-old", name: "Ana Pérez" });
    expect(posts(calls)).toHaveLength(1);
    expect(addToast).not.toHaveBeenCalled();
  });

  it("Guardar igual resubmits with allowDuplicatePhone: true", async () => {
    const calls = stubFetch([DUPLICATE, () => json({ cliente: CREATED }, 201)]);
    const { user, onSaved } = await fill();
    await typeAndSubmit(user);
    await user.click(await screen.findByRole("button", { name: "Guardar igual" }));

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(posts(calls)).toHaveLength(2);
    expect(posts(calls)[0].body).toEqual({ name: "Luis Gómez", phone: "50766667777" });
    expect(posts(calls)[1].body).toEqual({ name: "Luis Gómez", phone: "50766667777", allowDuplicatePhone: true });
    expect(addToast).toHaveBeenCalledExactlyOnceWith("success", "Cliente creado");
  });

  it("Deactivated duplicate cannot be reused: Usar ese cliente is disabled with the note, Guardar igual stays enabled", async () => {
    stubFetch([DUPLICATE], () => json({ customers: [{ ...EXISTING, deactivatedAt: "2026-09-01T00:00:00.000Z" }], total: 1 }));
    const { user, onSaved } = await fill();
    await typeAndSubmit(user);
    await user.click(await screen.findByRole("button", { name: "Ver el cliente existente" }));

    expect(await screen.findByText(/está desactivado/)).toBeInTheDocument();
    const usar = screen.getByRole("button", { name: "Usar ese cliente" });
    expect(usar).toBeDisabled();
    expect(screen.getByRole("button", { name: "Guardar igual" })).toBeEnabled();
    await user.click(usar);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("Usar ese cliente without looking first does the lookup, and a deactivated match is not selected", async () => {
    stubFetch([DUPLICATE], () => json({ customers: [{ ...EXISTING, deactivatedAt: "2026-09-01T00:00:00.000Z" }], total: 1 }));
    const { user, onSaved } = await fill();
    await typeAndSubmit(user);
    await user.click(await screen.findByRole("button", { name: "Usar ese cliente" }));

    expect(await screen.findByText(/está desactivado/)).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Usar ese cliente" })).toBeDisabled();
  });

  it("In flight: every duplicate choice is disabled until the response lands", async () => {
    let release!: (r: Response) => void;
    stubFetch([DUPLICATE, () => new Promise<Response>((resolve) => (release = resolve))]);
    const { user } = await fill();
    await typeAndSubmit(user);
    await user.click(await screen.findByRole("button", { name: "Guardar igual" }));

    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Guardar igual" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Usar ese cliente" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Ver el cliente existente" })).toBeDisabled();
    release(json({ cliente: CREATED }, 201));
  });

  it("Editing the phone drops the duplicate choices and brings the create button back", async () => {
    stubFetch([DUPLICATE]);
    const { user } = await fill();
    await typeAndSubmit(user);
    await screen.findByRole("button", { name: "Guardar igual" });
    await user.type(screen.getByLabelText("Teléfono"), "8");

    expect(screen.queryByRole("button", { name: "Guardar igual" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Crear cliente" })).toBeInTheDocument();
  });
});
