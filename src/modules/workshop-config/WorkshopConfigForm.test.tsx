/**
 * Component tests for the workshop-settings form (catalog-templates-and-
 * workshop-info WU1). Covers the new contact fields + coverText + social
 * handles added alongside the existing name/logo fields.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { WorkshopConfig } from "@/shared/db/schema";
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

  it("submits an untouched optional field as an empty string, which the API layer collapses to null", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 200, body: { config: { id: "singleton" } } });
    render(<WorkshopConfigForm initialConfig={null} />);

    await user.type(screen.getByLabelText("Teléfono"), "555-1234");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // Untouched fields still travel as "" (this form owns the whole contact
    // block, unlike LogoUploadField's separate route) — validateWorkshopConfigInput
    // is the layer responsible for collapsing "" to NULL (service.test.ts).
    expect(bodyOf(fetchMock).website).toBe("");
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
