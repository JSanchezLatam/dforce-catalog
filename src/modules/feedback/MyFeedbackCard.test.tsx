/**
 * Component tests for the "Mis comentarios" card. Strings are asserted in
 * Spanish, spelled out. jsdom cannot see the 44px result or a Server Component
 * boundary: the class is pinned here and the rest is measured in the browser.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FeedbackProvider } from "./FeedbackProvider";
import { MyFeedbackCard, type MyFeedbackRow } from "./MyFeedbackCard";

vi.mock("next/navigation", () => ({ usePathname: () => "/account", useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/shared/ui/ToastProvider", () => ({ useToast: () => ({ addToast: vi.fn() }) }));

const AUTHOR = { username: "jperez", roleLabel: "Técnico" };

const row = (over: Partial<MyFeedbackRow> = {}): MyFeedbackRow => ({
  id: "r1",
  category: "bug",
  text: "Al guardar la orden me salió un error",
  screenLabel: "Orden #1234 — Detalle",
  createdAt: "09/11/2026, 9:12:00 a. m.",
  delivered: true,
  ...over,
});

function renderCard(rows: MyFeedbackRow[]) {
  return render(
    <FeedbackProvider author={AUTHOR}>
      <MyFeedbackCard rows={rows} />
    </FeedbackProvider>,
  );
}

describe("MyFeedbackCard", () => {
  it("shows the title, the description and the send button", () => {
    renderCard([row()]);
    expect(screen.getByText("Mis comentarios")).toBeInTheDocument();
    expect(screen.getByText("Lo que enviaste al equipo de soporte.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar comentario" })).toHaveClass("min-h-11");
  });

  it("lists the rows in the order received, each with category, first line, date and screen", () => {
    renderCard([
      row({ id: "a", category: "idea", text: "Filtrar el tablero\nsegunda línea", createdAt: "10/11/2026" }),
      row({ id: "b", category: "other", text: "Otra cosa más vieja", createdAt: "09/11/2026" }),
    ]);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText("Idea o mejora")).toBeInTheDocument();
    expect(within(items[0]).getByText("Filtrar el tablero")).toBeInTheDocument();
    expect(items[0]).not.toHaveTextContent("segunda línea");
    expect(within(items[0]).getByText("10/11/2026 · Orden #1234 — Detalle")).toBeInTheDocument();
    expect(within(items[1]).getByText("Otra cosa")).toBeInTheDocument();
  });

  it("reads Enviado for a delivered row and Pendiente de envío with the offline text for the rest", () => {
    renderCard([row({ id: "a", delivered: true }), row({ id: "b", delivered: false })]);
    const [sent, pending] = screen.getAllByRole("listitem");
    expect(within(sent).getByText("Enviado")).toBeInTheDocument();
    expect(sent).not.toHaveTextContent("Pendiente de envío");
    expect(sent).not.toHaveTextContent("Sin conexión a internet");
    expect(within(pending).getByText("Pendiente de envío")).toBeInTheDocument();
    expect(within(pending).getByText("Sin conexión a internet. Se envía solo cuando vuelva.")).toBeInTheDocument();
    expect(pending).not.toHaveTextContent("Enviado");
  });

  it("shows the empty state with no rows", () => {
    renderCard([]);
    expect(screen.getByText("Todavía no enviaste comentarios")).toBeInTheDocument();
    expect(
      screen.getByText("Usá «Enviar comentario» en el menú para contarnos qué anda mal o qué mejorarías."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("never shows a Respondido state", () => {
    renderCard([row({ id: "a" }), row({ id: "b", delivered: false })]);
    expect(screen.queryByText(/Respondido/)).not.toBeInTheDocument();
  });

  it("opens the shared dialog from the button", async () => {
    const user = userEvent.setup();
    renderCard([]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Enviar comentario" }));
    expect(await screen.findByRole("dialog", { name: "Enviar comentario" })).toBeInTheDocument();
  });
});
