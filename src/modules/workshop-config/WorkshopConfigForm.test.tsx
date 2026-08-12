/**
 * Component tests for the workshop-settings form (catalog-templates-and-
 * workshop-info WU1). Covers the new contact fields + coverText + social
 * handles added alongside the existing name/logo fields.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { WorkshopConfig } from "@/shared/db/schema";
import { MAX_HANDLE_ENTRIES } from "./limits";
import { WorkshopConfigForm } from "./WorkshopConfigForm";

function mockFetch(response: { status: number; body?: unknown }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    json: async () => response.body ?? {},
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function bodyOf(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  return JSON.parse(fetchMock.mock.calls[call][1].body);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("WorkshopConfigForm — contact fields", () => {
  it("renders and submits every new contact field", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 200, body: { config: { id: "singleton" } } });
    render(<WorkshopConfigForm initialConfig={null} />);

    await user.type(screen.getByLabelText("Teléfono"), "555-1234");
    await user.type(screen.getByLabelText("WhatsApp"), "555-5678");
    await user.type(screen.getByLabelText("Email"), "taller@ejemplo.com");
    await user.type(screen.getByLabelText("Dirección"), "Av. Siempre Viva 123");
    await user.type(screen.getByLabelText("Sitio web"), "https://taller.com");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = bodyOf(fetchMock);
    expect(body).toMatchObject({
      phone: "555-1234",
      whatsapp: "555-5678",
      email: "taller@ejemplo.com",
      address: "Av. Siempre Viva 123",
      website: "https://taller.com",
    });
  });

  it("stores hours as one free-text field with no per-day parsing", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 200, body: { config: { id: "singleton" } } });
    render(<WorkshopConfigForm initialConfig={null} />);

    const hoursValue = "Lun-Vie 9-18, Sáb 9-13";
    await user.type(screen.getByLabelText("Horario"), hoursValue);
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(bodyOf(fetchMock).hours).toBe(hoursValue);
  });

  it("submits the cover text", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 200, body: { config: { id: "singleton" } } });
    render(<WorkshopConfigForm initialConfig={null} />);

    await user.type(screen.getByLabelText("Texto de portada"), "Bienvenido a nuestro catálogo");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(bodyOf(fetchMock).coverText).toBe("Bienvenido a nuestro catálogo");
  });

  // One test covering two of the seven near-identical error slots this PR
  // added (coverText + phone) — proves the setErrors → per-field <p role="alert">
  // wiring generalizes across the new JSX blocks without one redundant test
  // per field (each block is otherwise the same three lines copy-pasted).
  it("surfaces server-returned field validation errors next to their inputs", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({
      status: 400,
      body: {
        errors: {
          coverText: "El texto de portada debe tener 500 caracteres o menos",
          phone: "El teléfono debe tener 200 caracteres o menos",
          socialHandles: "Puedes guardar hasta 20 redes sociales",
        },
      },
    });
    render(<WorkshopConfigForm initialConfig={null} />);

    await user.type(screen.getByLabelText("Texto de portada"), "algo");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(await screen.findByText("El texto de portada debe tener 500 caracteres o menos")).toBeInTheDocument();
    expect(screen.getByText("El teléfono debe tener 200 caracteres o menos")).toBeInTheDocument();
    expect(screen.getByText("Puedes guardar hasta 20 redes sociales")).toBeInTheDocument();
  });

  it("adds a social handle row and submits it under an arbitrary platform key", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 200, body: { config: { id: "singleton" } } });
    render(<WorkshopConfigForm initialConfig={null} />);

    await user.click(screen.getByRole("button", { name: "Agregar red social" }));
    await user.type(screen.getByLabelText("Plataforma"), "instagram");
    await user.type(screen.getByLabelText("Usuario o enlace"), "@mitaller");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(bodyOf(fetchMock).socialHandles).toEqual({ instagram: "@mitaller" });
  });

  it("prefills existing contact values", () => {
    const initialConfig: WorkshopConfig = {
      id: "singleton",
      name: "Mi Taller",
      logoR2Key: null,
      logoContentType: null,
      coverImageR2Key: null,
      coverImageContentType: null,
      phone: "555-1234",
      whatsapp: null,
      email: "taller@ejemplo.com",
      address: null,
      hours: null,
      website: null,
      coverText: "Bienvenido",
      socialHandles: null,
      updatedAt: new Date(),
    };
    render(<WorkshopConfigForm initialConfig={initialConfig} />);

    expect(screen.getByLabelText("Teléfono")).toHaveValue("555-1234");
    expect(screen.getByLabelText("Email")).toHaveValue("taller@ejemplo.com");
    expect(screen.getByLabelText("Texto de portada")).toHaveValue("Bienvenido");
  });

  it("omits an untouched optional field from the request instead of resending it", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 200, body: { config: { id: "singleton" } } });
    render(<WorkshopConfigForm initialConfig={null} />);

    await user.type(screen.getByLabelText("Teléfono"), "555-1234");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(bodyOf(fetchMock)).not.toHaveProperty("website");
  });

  // Closes the stale-tab data-loss gap an RDD review caught: this form
  // always owns the whole contact block, so resending every field on every
  // save — including fields the admin never touched this session — means a
  // save from a tab that loaded before some OTHER field was set elsewhere
  // silently reverts it. Only fields that actually changed from what the
  // form was loaded with are sent, matching UserForm.tsx's existing
  // "omit unchanged optional fields" precedent.
  it("omits an already-set field the admin left untouched, protecting it from a stale-tab overwrite", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 200, body: { config: { id: "singleton" } } });
    const initialConfig: WorkshopConfig = {
      id: "singleton",
      name: "Mi Taller",
      logoR2Key: null,
      logoContentType: null,
      coverImageR2Key: null,
      coverImageContentType: null,
      phone: "555-1234",
      whatsapp: null,
      email: "taller@ejemplo.com",
      address: null,
      hours: null,
      website: null,
      coverText: null,
      socialHandles: null,
      updatedAt: new Date(),
    };
    render(<WorkshopConfigForm initialConfig={initialConfig} />);

    await user.type(screen.getByLabelText("Dirección"), "Av. Siempre Viva 123");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = bodyOf(fetchMock);
    expect(body).toEqual({ address: "Av. Siempre Viva 123" });
    expect(body).not.toHaveProperty("phone");
    expect(body).not.toHaveProperty("email");
  });

  it("sends an explicit empty value when the admin deliberately clears an already-set field", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 200, body: { config: { id: "singleton" } } });
    const initialConfig: WorkshopConfig = {
      id: "singleton",
      name: "Mi Taller",
      logoR2Key: null,
      logoContentType: null,
      coverImageR2Key: null,
      coverImageContentType: null,
      phone: "555-1234",
      whatsapp: null,
      email: null,
      address: null,
      hours: null,
      website: null,
      coverText: null,
      socialHandles: null,
      updatedAt: new Date(),
    };
    render(<WorkshopConfigForm initialConfig={initialConfig} />);

    await user.clear(screen.getByLabelText("Teléfono"));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(bodyOf(fetchMock)).toEqual({ phone: "" });
  });

  it("disables Agregar red social once the entry-count cap is reached", () => {
    const socialHandles = Object.fromEntries(
      Array.from({ length: MAX_HANDLE_ENTRIES }, (_, i) => [`platform${i}`, `@handle${i}`]),
    );
    const initialConfig: WorkshopConfig = {
      id: "singleton",
      name: null,
      logoR2Key: null,
      logoContentType: null,
      coverImageR2Key: null,
      coverImageContentType: null,
      phone: null,
      whatsapp: null,
      email: null,
      address: null,
      hours: null,
      website: null,
      coverText: null,
      socialHandles,
      updatedAt: new Date(),
    };
    render(<WorkshopConfigForm initialConfig={initialConfig} />);

    expect(screen.getByRole("button", { name: "Agregar red social" })).toBeDisabled();
  });

  // WU5 (design D6, task 6.6) — the cover-image field is a second
  // LogoUploadField instance pointed at the cover-image route; it must not
  // be confused with the logo field.
  it("renders the cover-image upload field alongside the logo field", () => {
    render(<WorkshopConfigForm initialConfig={null} />);

    expect(screen.getByLabelText("Logo del taller")).toBeInTheDocument();
    expect(screen.getByLabelText("Imagen de portada")).toBeInTheDocument();
  });

  it("uploads a cover image to the dedicated cover-image route, not the logo route", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 200, body: { key: "covers/1.png" } });
    render(<WorkshopConfigForm initialConfig={null} />);

    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "cover.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Imagen de portada"), png);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith("/api/workshop-config/cover-image", expect.objectContaining({ method: "POST" }));
  });

  it("removes the correct social handle row when a middle row is deleted", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 200, body: { config: { id: "singleton" } } });
    render(<WorkshopConfigForm initialConfig={null} />);

    await user.click(screen.getByRole("button", { name: "Agregar red social" }));
    await user.type(screen.getAllByLabelText("Plataforma")[0], "instagram");
    await user.type(screen.getAllByLabelText("Usuario o enlace")[0], "@a");
    await user.click(screen.getByRole("button", { name: "Agregar red social" }));
    await user.type(screen.getAllByLabelText("Plataforma")[1], "facebook");
    await user.type(screen.getAllByLabelText("Usuario o enlace")[1], "@b");

    await user.click(screen.getAllByRole("button", { name: "Eliminar" })[0]);
    expect(screen.getAllByLabelText("Plataforma")).toHaveLength(1);
    expect(screen.getByLabelText("Plataforma")).toHaveValue("facebook");

    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(bodyOf(fetchMock).socialHandles).toEqual({ facebook: "@b" });
  });
});
