import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { makeItem } from "./items.fixture";
import { NextCard } from "./NextCard";

const item = makeItem({ id: "n1", time: "11:00", customerName: "Jorge Vega", customerPhone: "61234567", vehicleLabel: "AC 5521 · Toyota Corolla", description: "Revisado + alineación" });

describe("NextCard", () => {
  it("Próxima cita text: label, time, customer, vehicle and description", () => {
    render(<NextCard next={{ item, label: "en 20 min" }} />);
    expect(screen.getByText("Próxima cita · en 20 min")).toBeInTheDocument();
    expect(screen.getByText("11:00")).toBeInTheDocument();
    expect(screen.getByText("Jorge Vega")).toBeInTheDocument();
    expect(screen.getByText("AC 5521 · Toyota Corolla")).toBeInTheDocument();
    expect(screen.getByText("Revisado + alineación")).toBeInTheDocument();
  });

  it("no description: no empty line", () => {
    const { container } = render(<NextCard next={{ item: { ...item, description: null }, label: "en 20 min" }} />);
    expect(container.querySelector("[data-description]")).toBeNull();
  });

  it("Abrir orden and the tel: link are real links, each 44x44", () => {
    render(<NextCard next={{ item, label: "en 20 min" }} />);
    const open = screen.getByRole("link", { name: "Abrir orden" });
    const call = screen.getByRole("link", { name: "Llamar a Jorge Vega" });
    expect(open).toHaveAttribute("href", "/service-orders/n1");
    expect(call).toHaveAttribute("href", "tel:61234567");
    for (const el of [open, call]) {
      expect(el.className).toContain("min-h-11");
      expect(el.className).toContain("min-w-11");
    }
  });

  it("Próxima cita empty: 'Sin citas próximas' and no links", () => {
    render(<NextCard next={null} />);
    expect(screen.getByText("Sin citas próximas")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
