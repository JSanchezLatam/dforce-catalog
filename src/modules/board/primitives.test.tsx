import { render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { AlertStrip, CardShell, CategoryTag, ColumnShell, STATUS_HUE, TechAvatars, TimeChip, UrgentBadge } from "./primitives";

const card = (over: Partial<Parameters<typeof CardShell>[0]> = {}) => (
  <CardShell plate="AB1234" make="Toyota" model="Hilux" urgent={false} footer={<span>footer</span>} {...over} />
);

describe("Card Content and Color Rules - CardShell", () => {
  it("shows the plate and the vehicle", () => {
    render(<ul>{card()}</ul>);
    expect(screen.getByText("AB1234")).toBeInTheDocument();
    expect(screen.getByText("Toyota Hilux")).toBeInTheDocument();
  });

  it("reads 'Sin placa' and 'Sin vehículo' when there is neither", () => {
    render(<ul>{card({ plate: null, make: null, model: null })}</ul>);
    expect(screen.getByText("Sin placa")).toBeInTheDocument();
    expect(screen.getByText("Sin vehículo")).toBeInTheDocument();
  });

  it("is a list item, so a column of cards is a list", () => {
    render(<ul>{card()}</ul>);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("an urgent card carries the red stripe and border; a plain one carries neither", () => {
    const { rerender } = render(<ul>{card({ urgent: true })}</ul>);
    expect(screen.getByRole("listitem")).toHaveClass("border-urgent/45");
    expect(screen.getByRole("listitem").querySelector("span[aria-hidden].bg-urgent")).not.toBeNull();
    rerender(<ul>{card({ urgent: false })}</ul>);
    expect(screen.getByRole("listitem")).not.toHaveClass("border-urgent/45");
    expect(screen.getByRole("listitem").querySelector(".bg-urgent")).toBeNull();
  });

  it("renders the grip, action, tags and alert slots only when given", () => {
    const { rerender } = render(<ul>{card()}</ul>);
    expect(screen.queryByText("slot-tags")).toBeNull();
    rerender(<ul>{card({ grip: <i>slot-grip</i>, action: <i>slot-action</i>, tags: <i>slot-tags</i>, alert: <i>slot-alert</i> })}</ul>);
    for (const t of ["slot-grip", "slot-action", "slot-tags", "slot-alert"]) expect(screen.getByText(t)).toBeInTheDocument();
  });
});

describe("Card Content and Color Rules - UrgentBadge", () => {
  it("is the red badge with an icon AND the text, never colour alone", () => {
    const { container } = render(<UrgentBadge />);
    const badge = screen.getByText("Urgente").closest("span")!;
    expect(badge).toHaveClass("bg-urgent");
    expect(badge.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("Card Content and Color Rules - TimeChip", () => {
  it("is neutral: never red or amber", () => {
    render(<TimeChip>12 min</TimeChip>);
    const chip = screen.getByText("12 min").closest("span")!;
    expect(chip).toHaveClass("bg-muted", "text-muted-foreground");
    expect(chip.className).not.toMatch(/urgent|warn|red|amber|destructive/);
  });
});

describe("Card Content and Color Rules - AlertStrip", () => {
  it.each([
    ["overdue", "Cita vencida · hace 1 h 10 min"],
    ["hold", "Repuesto · hace 3 días"],
    ["missing", "Falta vehículo y categoría"],
  ] as const)("a %s strip shows an icon and its text on the amber tokens", (kind, text) => {
    render(<AlertStrip alert={{ kind, text }} />);
    const strip = screen.getByText(text).closest("div")!;
    expect(strip).toHaveClass("bg-board-warn-bg", "text-board-warn-fg");
    expect(strip.querySelector("svg")).not.toBeNull();
  });
});

describe("Card Content and Color Rules - TechAvatars", () => {
  it("reads 'Sin técnico' with no one assigned", () => {
    render(<TechAvatars names={[]} />);
    expect(screen.getByText("Sin técnico")).toBeInTheDocument();
  });

  it("shows initials visually and keeps the full names, joined, as accessible text", () => {
    render(<TechAvatars names={["Ana Pérez", "Beto"]} />);
    expect(screen.getByText("Ana Pérez, Beto")).toHaveClass("sr-only");
    expect(screen.getByText("AP")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("B")).toHaveAttribute("aria-hidden", "true");
  });

  it("caps the visible avatars at three and counts the rest, names all kept", () => {
    render(<TechAvatars names={["Ana", "Beto", "Carla", "Dani", "Eva"]} />);
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(screen.queryByText("D")).toBeNull();
    expect(screen.getByText("Ana, Beto, Carla, Dani, Eva")).toHaveClass("sr-only");
  });

  it("gives the same name the same hue every time", () => {
    const hue = () => {
      const { unmount } = render(<TechAvatars names={["Ana"]} />);
      const h = screen.getByText("A").style.getPropertyValue("--h");
      unmount();
      return h;
    };
    expect(hue()).toBe(hue());
    expect(hue()).toMatch(/^\d+$/);
  });
});

describe("Card Content and Color Rules - CategoryTag", () => {
  it("shows the category label and renders nothing without one", () => {
    const { container, rerender } = render(<CategoryTag categoria="mant_preventivo" />);
    expect(screen.getByText("Mant. Preventivo")).toBeInTheDocument();
    rerender(<CategoryTag categoria={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("Board Layout and Columns - ColumnShell", () => {
  it("is a region named by its heading, with the count and the status hue", () => {
    render(
      <ColumnShell status="in_progress" label="En progreso" count={2}>
        {card()}
        {card()}
      </ColumnShell>,
    );
    const region = screen.getByRole("region", { name: "En progreso" });
    expect(within(region).getByRole("heading", { level: 2 })).toHaveTextContent("En progreso");
    expect(within(region).getByText("2")).toBeInTheDocument();
    expect(within(region).getAllByRole("listitem")).toHaveLength(2);
    expect(region.style.getPropertyValue("--h")).toBe(String(STATUS_HUE.in_progress.h));
    expect(region.style.getPropertyValue("--s")).toBe(STATUS_HUE.in_progress.s);
  });

  it("shows the empty text only when the column is empty and one was given", () => {
    const { rerender } = render(<ColumnShell status="done" label="Completada" count={0} empty="Sin órdenes" />);
    expect(screen.getByText("Sin órdenes")).toBeInTheDocument();
    rerender(<ColumnShell status="done" label="Completada" count={0} />);
    expect(screen.queryByText("Sin órdenes")).toBeNull();
    rerender(
      <ColumnShell status="done" label="Completada" count={1} empty="Sin órdenes">
        {card()}
      </ColumnShell>,
    );
    expect(screen.queryByText("Sin órdenes")).toBeNull();
  });

  it("has a hue for each of the seven columns and none for cancelled", () => {
    expect(Object.keys(STATUS_HUE)).toEqual(["booked", "open", "diagnosing", "in_progress", "on_hold", "ready_for_review", "done"]);
  });

  it("keeps red (0) and amber (about 30-45) hues out of the status palette", () => {
    for (const { h } of Object.values(STATUS_HUE)) expect(h >= 120 && h <= 300).toBe(true);
  });
});

describe("Primitives are presentational and shared with the read-only TV boards", () => {
  it("render no button and no link, with every primitive on", () => {
    const { container } = render(
      <ColumnShell status="on_hold" label="En espera" count={1} empty="Sin órdenes">
        {card({
          urgent: true,
          tags: (
            <>
              <UrgentBadge />
              <CategoryTag categoria="reparacion" />
            </>
          ),
          alert: <AlertStrip alert={{ kind: "hold", text: "Repuesto · hace 3 días" }} />,
          footer: (
            <>
              <TechAvatars names={["Ana"]} />
              <TimeChip>3 d</TimeChip>
            </>
          ),
        })}
      </ColumnShell>,
    );
    expect(container.querySelectorAll("button, a, [role=button], input")).toHaveLength(0);
  });

  it("the module is neither a client component nor a hook user", () => {
    const src = readFileSync(`${__dirname}/primitives.tsx`, "utf8");
    expect(src).not.toMatch(/["']use client["']/);
    expect(src).not.toMatch(/\buse[A-Z]\w*\s*\(/);
    expect(src).not.toMatch(/Date\.now|new Date\(\)/);
  });
});
