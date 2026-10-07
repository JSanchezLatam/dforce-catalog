import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { monthKeys } from "./months";
import { MonthSelect } from "./MonthSelect";

const keys = monthKeys(new Date("2026-10-15T12:00:00Z"), 12).reverse();

describe("MonthSelect", () => {
  it("is a plain GET form: a named select and a submit button, no JS needed", () => {
    const { container } = render(<MonthSelect keys={keys} selected="2026-10" />);

    const form = container.querySelector("form")!;
    expect(form).toHaveAttribute("method", "get");
    const select = screen.getByLabelText("Mes");
    expect(select).toHaveAttribute("name", "mes");
    expect(within(form).getByRole("button", { name: "Ver" })).toHaveAttribute("type", "submit");
  });

  it("lists the 12 months newest first with Spanish labels", () => {
    render(<MonthSelect keys={keys} selected="2026-10" />);

    const options = within(screen.getByLabelText("Mes")).getAllByRole("option");
    expect(options).toHaveLength(12);
    expect(options[0]).toHaveTextContent("Octubre 2026");
    expect(options[0]).toHaveValue("2026-10");
    expect(options[11]).toHaveTextContent("Noviembre 2025");
  });

  it("marks the selected month", () => {
    render(<MonthSelect keys={keys} selected="2026-08" />);

    expect(screen.getByLabelText("Mes")).toHaveValue("2026-08");
  });

  it("keeps both controls at the 44px touch target", () => {
    render(<MonthSelect keys={keys} selected="2026-10" />);

    for (const control of [screen.getByLabelText("Mes"), screen.getByRole("button", { name: "Ver" })]) {
      expect(control).toHaveClass("min-h-11", "min-w-11");
    }
  });
});
