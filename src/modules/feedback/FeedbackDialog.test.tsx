/**
 * Component tests for the feedback dialog. Strings are asserted in Spanish,
 * spelled out, never imported from the module under test.
 *
 * jsdom cannot see the bottom-sheet layout, the 44px result or an RSC
 * boundary: those are pinned as classes here and measured in the browser.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FeedbackDialog } from "./FeedbackDialog";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), addToast: vi.fn(), pathname: "/service-orders/abc-123" }));
vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("@/shared/ui/ToastProvider", () => ({ useToast: () => ({ addToast: mocks.addToast }) }));

const AUTHOR = { username: "jperez", roleLabel: "Técnico" };

const PH_BUG =
  "Escribí qué pasó y qué estabas haciendo. Por ejemplo: «Al guardar la orden me salió un error y se borró lo que había cargado».";
const PH_IDEA = "Contanos qué te ahorraría tiempo. Por ejemplo: «Estaría bueno filtrar el tablero por técnico».";
const PH_OTHER = "Escribí lo que quieras contarle al equipo de soporte.";
const QUEUED = "Comentario guardado. Se va a enviar automáticamente cuando vuelva la conexión.";

const onOpenChange = vi.fn();

function renderDialog() {
  return render(<FeedbackDialog open onOpenChange={onOpenChange} author={AUTHOR} />);
}
const textarea = () => screen.getByLabelText("Comentario");
const sendButton = () => screen.getByRole("button", { name: /^Enviar(ando…)?$|^Enviando…$/ });

function stubFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  const fn = vi.fn().mockResolvedValue({ ok: true, status: 201, ...response });
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  mocks.pathname = "/service-orders/abc-123";
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("FeedbackDialog — form", () => {
  it("titles itself and describes itself in Spanish", () => {
    renderDialog();
    expect(screen.getByRole("dialog", { name: "Enviar comentario" })).toBeInTheDocument();
    expect(screen.getByText("Contale al equipo de soporte qué anda mal o qué mejorarías.")).toBeInTheDocument();
  });

  it("preselects no category", () => {
    renderDialog();
    for (const name of ["Algo no funciona", "Idea o mejora", "Otra cosa"]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "false");
    }
    expect(screen.getByText("¿Qué querés contarnos?")).toBeInTheDocument();
  });

  it("marks only the chosen category as pressed", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: "Idea o mejora" }));
    expect(screen.getByRole("button", { name: "Idea o mejora" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Algo no funciona" })).toHaveAttribute("aria-pressed", "false");
  });

  it("follows the category with the placeholder, starting on the bug text", async () => {
    const user = userEvent.setup();
    renderDialog();
    expect(textarea()).toHaveAttribute("placeholder", PH_BUG);
    await user.click(screen.getByRole("button", { name: "Idea o mejora" }));
    expect(textarea()).toHaveAttribute("placeholder", PH_IDEA);
    await user.click(screen.getByRole("button", { name: "Otra cosa" }));
    expect(textarea()).toHaveAttribute("placeholder", PH_OTHER);
  });

  it("shows the missing-category message and sends nothing", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch({});
    renderDialog();
    await user.type(textarea(), "no guarda");
    await user.click(sendButton());
    expect(screen.getByText("Elegí qué querés contarnos.")).toBeInTheDocument();
    expect(screen.queryByText("Escribí tu comentario antes de enviarlo.")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("flags whitespace-only text as invalid and sends nothing", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch({});
    renderDialog();
    await user.click(screen.getByRole("button", { name: "Algo no funciona" }));
    await user.type(textarea(), "   ");
    await user.click(sendButton());
    expect(screen.getByText("Escribí tu comentario antes de enviarlo.")).toBeInTheDocument();
    expect(textarea()).toHaveAttribute("aria-invalid", "true");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows both messages when both are missing", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(sendButton());
    expect(screen.getByText("Elegí qué querés contarnos.")).toBeInTheDocument();
    expect(screen.getByText("Escribí tu comentario antes de enviarlo.")).toBeInTheDocument();
  });

  it("is not invalid before the first send attempt", () => {
    renderDialog();
    expect(textarea()).toHaveAttribute("aria-invalid", "false");
  });

  it("caps the textarea at 2000 and counts live, amber from 1800", async () => {
    const user = userEvent.setup();
    renderDialog();
    expect(textarea()).toHaveAttribute("maxlength", "2000");
    expect(screen.getByText("0 / 2000")).toBeInTheDocument();

    await user.click(textarea());
    await user.paste("a".repeat(1799));
    const low = screen.getByText("1799 / 2000");
    expect(low).not.toHaveClass("text-amber-700");

    await user.paste("a");
    expect(screen.getByText("1800 / 2000")).toHaveClass("text-amber-700");
  });

  it("names the author with the role label", () => {
    renderDialog();
    expect(screen.getByText("jperez")).toBeInTheDocument();
    expect(screen.getByText(/Se envía al equipo de soporte como/)).toHaveTextContent(
      "Se envía al equipo de soporte como jperez (Técnico)",
    );
  });

  it("shows the screen read-only: the mapped label for a known route, the raw route for an unknown one", () => {
    const { unmount } = renderDialog();
    expect(screen.getByText(/^Pantalla:/)).toHaveTextContent("Pantalla: Orden de servicio — Detalle");
    unmount();

    mocks.pathname = "/some/new/page";
    renderDialog();
    expect(screen.getByText(/^Pantalla:/)).toHaveTextContent("Pantalla: /some/new/page");
  });

  it("renders the context lines as text, not as form controls", () => {
    renderDialog();
    const line = screen.getByText(/^Pantalla:/);
    expect(line.closest("input, textarea, select, button")).toBeNull();
  });

  it("carries the 44px classes on every action control", () => {
    renderDialog();
    for (const name of ["Algo no funciona", "Idea o mejora", "Otra cosa", "Cancelar", "Enviar"]) {
      expect(screen.getByRole("button", { name })).toHaveClass("min-h-11");
    }
    expect(screen.getByRole("button", { name: "Cerrar" })).toHaveClass("pointer-coarse:min-h-11", "pointer-coarse:min-w-11");
  });

  it("starts empty the next time it opens", async () => {
    const user = userEvent.setup();
    const ui = (open: boolean) => <FeedbackDialog open={open} onOpenChange={onOpenChange} author={AUTHOR} />;
    const { rerender } = render(ui(true));
    await user.click(screen.getByRole("button", { name: "Idea o mejora" }));
    await user.type(textarea(), "algo a medias");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    rerender(ui(false));
    rerender(ui(true));

    expect(screen.getByRole("button", { name: "Idea o mejora" })).toHaveAttribute("aria-pressed", "false");
    expect(textarea()).toHaveValue("");
  });

  it("closes on Cancelar", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("FeedbackDialog — submit", () => {
  async function fill(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Algo no funciona" }));
    await user.type(textarea(), "no guarda la orden");
  }

  it("posts category, text and the pathname only", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch({ json: async () => ({ id: "x", outcome: "delivered" }) });
    renderDialog();
    await fill(user);
    await user.click(sendButton());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/feedback");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ category: "bug", text: "no guarda la orden", route: "/service-orders/abc-123" });
  });

  it("raises a success toast, closes and refreshes on a delivered outcome", async () => {
    const user = userEvent.setup();
    stubFetch({ json: async () => ({ id: "x", outcome: "delivered" }) });
    renderDialog();
    await fill(user);
    await user.click(sendButton());

    await vi.waitFor(() => expect(mocks.addToast).toHaveBeenCalledWith("success", "Comentario enviado"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("raises the neutral info toast on a queued outcome", async () => {
    const user = userEvent.setup();
    stubFetch({ json: async () => ({ id: "x", outcome: "queued" }) });
    renderDialog();
    await fill(user);
    await user.click(sendButton());

    await vi.waitFor(() => expect(mocks.addToast).toHaveBeenCalledWith("info", QUEUED));
    expect(mocks.addToast).not.toHaveBeenCalledWith("success", expect.anything());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("locks every control and reads Enviando… while the request is in flight", async () => {
    const user = userEvent.setup();
    let release!: (v: unknown) => void;
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise((r) => (release = r))));
    renderDialog();
    await fill(user);
    await user.click(sendButton());

    expect(await screen.findByRole("button", { name: "Enviando…" })).toBeDisabled();
    for (const name of ["Algo no funciona", "Idea o mejora", "Otra cosa", "Cancelar", "Cerrar"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    expect(textarea()).toBeDisabled();

    release({ ok: true, status: 201, json: async () => ({ id: "x", outcome: "delivered" }) });
    await vi.waitFor(() => expect(mocks.addToast).toHaveBeenCalled());
  });

  it("keeps the text and shows an inline error, with no toast, on a 5xx", async () => {
    const user = userEvent.setup();
    stubFetch({ ok: false, status: 500, json: async () => ({}) });
    renderDialog();
    await fill(user);
    await user.click(sendButton());

    expect(await screen.findByText("No se pudo guardar el comentario. Intenta de nuevo.")).toBeInTheDocument();
    expect(textarea()).toHaveValue("no guarda la orden");
    expect(textarea()).toBeEnabled();
    expect(mocks.addToast).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("shows the server's own Spanish text on a 400", async () => {
    const user = userEvent.setup();
    stubFetch({ ok: false, status: 400, json: async () => ({ error: "validation_error", errors: { text: "El comentario es muy largo." } }) });
    renderDialog();
    await fill(user);
    await user.click(sendButton());

    expect(await screen.findByText("El comentario es muy largo.")).toBeInTheDocument();
    expect(mocks.addToast).not.toHaveBeenCalled();
  });

  it("shows the connection error inline, keeping the text, when fetch rejects", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    renderDialog();
    await fill(user);
    await user.click(sendButton());

    expect(await screen.findByText("No se pudo conectar. Revisa tu conexión e intenta de nuevo.")).toBeInTheDocument();
    expect(textarea()).toHaveValue("no guarda la orden");
    expect(mocks.addToast).not.toHaveBeenCalled();
  });

  // The throw ESCAPES the handler (that is the property), so it surfaces as an unhandled rejection.
  it("has already raised the toast when router.refresh throws", async () => {
    const user = userEvent.setup();
    stubFetch({ json: async () => ({ id: "x", outcome: "delivered" }) });
    const boom = new Error("refresh blew up");
    mocks.refresh.mockImplementationOnce(() => {
      throw boom;
    });
    const escaped: unknown[] = [];
    const capture = (reason: unknown) => escaped.push(reason);
    process.on("unhandledRejection", capture);
    try {
      renderDialog();
      await fill(user);
      await user.click(sendButton());
      await vi.waitFor(() => expect(escaped).toContain(boom));
    } finally {
      process.off("unhandledRejection", capture);
    }
    expect(mocks.addToast).toHaveBeenCalledWith("success", "Comentario enviado");
    expect(screen.queryByText("No se pudo conectar. Revisa tu conexión e intenta de nuevo.")).not.toBeInTheDocument();
  });
});
