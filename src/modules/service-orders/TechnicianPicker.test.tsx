import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TechnicianPicker } from "./TechnicianPicker";

const TECNICOS = [
  { id: "t1", nombre: "Ana Mecánica" },
  { id: "t2", nombre: "Beto Frenos" },
];

describe("TechnicianPicker", () => {
  it("lists one native checkbox per technician it is given, named by the technician", () => {
    render(<TechnicianPicker tecnicos={TECNICOS} selected={[]} onChange={() => {}} />);

    expect(screen.getByRole("checkbox", { name: "Ana Mecánica" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Beto Frenos" })).not.toBeChecked();
  });

  it("reports the selection in the order picked, and un-picks on a second click", () => {
    const onChange = vi.fn();
    const { rerender } = render(<TechnicianPicker tecnicos={TECNICOS} selected={[]} onChange={onChange} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Beto Frenos" }));
    expect(onChange).toHaveBeenLastCalledWith(["t2"]);

    rerender(<TechnicianPicker tecnicos={TECNICOS} selected={["t2"]} onChange={onChange} />);
    expect(screen.getByRole("checkbox", { name: "Beto Frenos" })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Beto Frenos" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("makes every row a 44px-tall label, so the whole row is the hit target", () => {
    render(<TechnicianPicker tecnicos={TECNICOS} selected={[]} onChange={() => {}} />);

    const row = screen.getByRole("checkbox", { name: "Ana Mecánica" }).closest("label")!;
    expect(row).toHaveClass("min-h-11");
  });

  it("says there is nobody to pick when the roster is empty, and renders no checkbox", () => {
    render(<TechnicianPicker tecnicos={[]} selected={[]} onChange={() => {}} />);

    expect(screen.getByText("No hay técnicos activos.")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
