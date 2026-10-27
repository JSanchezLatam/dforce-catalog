import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/shared/ui/ToastProvider", () => ({ useToast: () => ({ addToast: vi.fn() }) }));

import { AgendaHeader } from "./AgendaHeader";

const base = { view: "week" as const, date: "2026-10-26", today: "2026-10-28", truncated: false };

describe("AgendaHeader", () => {
  it("Navigation links: previous, next and Hoy are plain links that rewrite the query", () => {
    render(<AgendaHeader {...base} />);
    expect(screen.getByRole("link", { name: "Anterior" })).toHaveAttribute("href", "/agenda?view=week&date=2026-10-19");
    expect(screen.getByRole("link", { name: "Siguiente" })).toHaveAttribute("href", "/agenda?view=week&date=2026-11-02");
    expect(screen.getByRole("link", { name: "Hoy" })).toHaveAttribute("href", "/agenda?view=week&date=2026-10-28");
  });

  it("Navigation links: the view switcher keeps the selected date", () => {
    render(<AgendaHeader {...base} />);
    expect(screen.getByRole("link", { name: "Día" })).toHaveAttribute("href", "/agenda?view=day&date=2026-10-26");
    expect(screen.getByRole("link", { name: "Mes" })).toHaveAttribute("href", "/agenda?view=month&date=2026-10-26");
    expect(screen.getByRole("link", { name: "Combinada" })).toHaveAttribute("href", "/agenda?view=combined&date=2026-10-26");
    expect(screen.getByRole("link", { name: "Semana" })).toHaveAttribute("aria-current", "page");
  });

  it("Hit targets classes: every link is at least 44x44", () => {
    render(<AgendaHeader {...base} />);
    for (const link of screen.getAllByRole("link")) {
      expect(link.className).toContain("min-h-11");
      expect(link.className).toContain("min-w-11");
    }
  });

  it("Header trigger: 'Agendar cita' stays the primary variant and keeps the 44px class", () => {
    render(<AgendaHeader {...base} />);
    const button = screen.getByRole("button", { name: "Agendar cita" });
    expect(button.className).toContain("bg-primary");
    expect(button.className).toContain("min-h-11");
  });

  it("Manual refresh: the existing RefreshListButton is there", () => {
    render(<AgendaHeader {...base} />);
    expect(screen.getByRole("button", { name: "Actualizar" })).toBeInTheDocument();
  });

  it("Row cap disclosure: the notice renders only when truncated", () => {
    const { rerender } = render(<AgendaHeader {...base} />);
    expect(screen.queryByText("Se muestran las primeras 500 citas; acotá el rango.")).not.toBeInTheDocument();
    rerender(<AgendaHeader {...base} truncated />);
    expect(screen.getByText("Se muestran las primeras 500 citas; acotá el rango.")).toBeInTheDocument();
  });

  it("labels the range with digits only", () => {
    const { rerender } = render(<AgendaHeader {...base} />);
    expect(screen.getByText("Semana del 26/10/2026")).toBeInTheDocument();
    rerender(<AgendaHeader {...base} view="month" />);
    expect(screen.getByText("10/2026")).toBeInTheDocument();
    rerender(<AgendaHeader {...base} view="day" />);
    expect(screen.getByText("26/10/2026")).toBeInTheDocument();
  });

  it("Booking trigger: 'Agendar cita' opens the dialog defaulting to the selected date", async () => {
    render(<AgendaHeader {...base} />);
    await userEvent.click(screen.getByRole("button", { name: "Agendar cita" }));
    expect((screen.getByLabelText("Día") as HTMLInputElement).value).toBe("2026-10-26");
  });
});
