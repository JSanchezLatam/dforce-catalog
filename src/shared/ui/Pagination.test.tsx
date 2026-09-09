/**
 * `Pagination` had no test at all, and its three user-facing strings were the
 * last English copy left in the shell — shared by four modules, so the mixture
 * showed on `/customers`, `/inventory`, `/service-orders` and the catalog
 * builder at once.
 *
 * AGENTS.md's language rule is what this file exists to enforce: "Tests assert
 * the Spanish string. Those are what catch an untranslated screen — never
 * loosen them to match both languages." Nothing pinned these before, which is
 * exactly why they survived every other translation pass.
 *
 * The component also returns `null` below two pages, and that is not a detail:
 * one customer in the dev database once hid a production defect entirely,
 * because the component under test never rendered. Every case here therefore
 * uses `pageCount` >= 2.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Pagination } from "./Pagination";

describe("Pagination — the copy staff reads", () => {
  it("names the previous and next links in Spanish", () => {
    render(<Pagination currentPage={2} pageCount={5} hrefPattern="/customers?page={page}" />);

    expect(screen.getByRole("link", { name: "Anterior" })).toHaveAttribute(
      "href",
      "/customers?page=1",
    );
    expect(screen.getByRole("link", { name: "Siguiente" })).toHaveAttribute(
      "href",
      "/customers?page=3",
    );
  });

  it("states the position in Spanish", () => {
    render(<Pagination currentPage={3} pageCount={7} hrefPattern="/inventory?page={page}" />);

    expect(screen.getByText("Página 3 de 7")).toBeInTheDocument();
  });

  it("offers no Anterior on the first page and no Siguiente on the last", () => {
    const { unmount } = render(
      <Pagination currentPage={1} pageCount={3} hrefPattern="/x?page={page}" />,
    );
    expect(screen.queryByRole("link", { name: "Anterior" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Siguiente" })).toBeInTheDocument();
    unmount();

    render(<Pagination currentPage={3} pageCount={3} hrefPattern="/x?page={page}" />);
    expect(screen.getByRole("link", { name: "Anterior" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Siguiente" })).not.toBeInTheDocument();
  });

  // The callback variant renders <button>s rather than <a>s, so the labels
  // live in a second code path and can drift back to English on their own.
  it("keeps the Spanish labels in the callback variant, which is a different branch", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(<Pagination currentPage={2} pageCount={4} onPageChange={onPageChange} />);

    await user.click(screen.getByRole("button", { name: "Siguiente" }));

    expect(onPageChange).toHaveBeenCalledWith(3);
    expect(screen.getByRole("button", { name: "Anterior" })).toBeInTheDocument();
  });
});
