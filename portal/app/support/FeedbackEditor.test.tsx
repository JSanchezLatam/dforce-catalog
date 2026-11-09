// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FeedbackEditor } from "./FeedbackEditor";

const router = { replace: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset().mockResolvedValue(new Response("{}", { status: 200 }));
  router.refresh.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ID = "11111111-1111-4111-8111-111111111111";
const body = () => JSON.parse(fetchMock.mock.calls[0][1].body);

describe("FeedbackEditor", () => {
  it("shows the status control with the current one pressed, and the note with its placeholder", () => {
    render(<FeedbackEditor id={ID} status="leido" note="vieja" />);
    const group = screen.getByRole("group", { name: "Estado" });
    expect(group.querySelectorAll("button")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Leído" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Nuevo" }).getAttribute("aria-pressed")).toBe("false");
    const note = screen.getByLabelText("Nota interna") as HTMLTextAreaElement;
    expect(note.value).toBe("vieja");
    expect(note.placeholder).toBe("Solo la ves vos. No llega al taller.");
    expect(note.maxLength).toBe(2000);
  });

  it("choosing a status PATCHes only the status, confirms and refreshes", async () => {
    render(<FeedbackEditor id={ID} status="leido" note="" />);
    fireEvent.click(screen.getByRole("button", { name: "Resuelto" }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/support/feedback/${ID}`);
    expect(init.method).toBe("PATCH");
    expect(body()).toEqual({ status: "resuelto" });
    expect(screen.getByRole("status").textContent).toBe("Estado actualizado.");
  });

  it("Guardar nota PATCHes only the note and shows Nota guardada. in the status region", async () => {
    render(<FeedbackEditor id={ID} status="nuevo" note="" />);
    fireEvent.change(screen.getByLabelText("Nota interna"), { target: { value: "llamar al cliente" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar nota" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Nota guardada."));
    expect(body()).toEqual({ note: "llamar al cliente" });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("a failed save shows an error, no confirmation and no refresh", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));
    render(<FeedbackEditor id={ID} status="nuevo" note="" />);
    fireEvent.click(screen.getByRole("button", { name: "Guardar nota" }));
    expect((await screen.findByRole("alert")).textContent).toBe("No se pudo guardar. Probá de nuevo.");
    expect(screen.getByRole("status").textContent).toBe("");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("a network failure is the same error", async () => {
    fetchMock.mockRejectedValue(new TypeError("offline"));
    render(<FeedbackEditor id={ID} status="nuevo" note="" />);
    fireEvent.click(screen.getByRole("button", { name: "Guardar nota" }));
    expect((await screen.findByRole("alert")).textContent).toBe("No se pudo guardar. Probá de nuevo.");
  });

  // The throw ESCAPES the handler (that is the property), so it surfaces as an unhandled rejection.
  it("keeps Nota guardada. when the refresh throws after an accepted save", async () => {
    const boom = new Error("refresh blew up");
    router.refresh.mockImplementationOnce(() => {
      throw boom;
    });
    const escaped: unknown[] = [];
    const capture = (reason: unknown) => escaped.push(reason);
    process.on("unhandledRejection", capture);
    try {
      render(<FeedbackEditor id={ID} status="nuevo" note="" />);
      fireEvent.click(screen.getByRole("button", { name: "Guardar nota" }));
      await waitFor(() => expect(escaped).toContain(boom));
      expect(screen.getByRole("status").textContent).toBe("Nota guardada.");
      expect(screen.queryByRole("alert")).toBeNull();
    } finally {
      process.off("unhandledRejection", capture);
    }
  });
});
