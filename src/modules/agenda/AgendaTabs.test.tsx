import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AgendaTabs } from "./AgendaTabs";

const base = { tab: "todas" as const, agendadas: 14, vencidas: 2, onTab: vi.fn() };

describe("AgendaTabs", () => {
  it("Tabs on every view: Todas, Agendadas and Vencidas, with Todas selected and the badges", () => {
    render(<AgendaTabs {...base} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Todas", "Agendadas14", "Vencidas2"]);
    expect(screen.getByRole("tab", { name: /Todas/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Agendadas/ })).toHaveAttribute("aria-selected", "false");
  });

  it("a zero count shows no badge", () => {
    render(<AgendaTabs {...base} agendadas={0} vencidas={0} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Todas", "Agendadas", "Vencidas"]);
  });

  it("selecting a tab reports it and navigates nowhere", async () => {
    const onTab = vi.fn();
    render(<AgendaTabs {...base} onTab={onTab} />);
    await userEvent.click(screen.getByRole("tab", { name: /Agendadas/ }));
    expect(onTab).toHaveBeenCalledWith("agendadas");
    await userEvent.click(screen.getByRole("tab", { name: /Vencidas/ }));
    expect(onTab).toHaveBeenLastCalledWith("vencidas");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("Hit targets classes: every pill is at least 44px tall", () => {
    render(<AgendaTabs {...base} />);
    for (const t of screen.getAllByRole("tab")) expect(t.className).toContain("min-h-11");
  });

  it("Phone chips: below md the tabs are rounded bordered chips that scroll inside their row", () => {
    render(<AgendaTabs {...base} />);
    expect(screen.getByRole("tablist").className).toContain("max-md:overflow-x-auto");
    for (const t of screen.getAllByRole("tab")) {
      expect(t.className).toContain("max-md:rounded-full");
      expect(t.className).toContain("max-md:border");
      expect(t.className).toContain("shrink-0");
    }
  });
});
