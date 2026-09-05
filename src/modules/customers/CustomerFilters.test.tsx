/**
 * R20/D6 — the "Ver desactivados" toggle is URL state, not client state. A
 * filter that does not survive a refresh or a shared link is one staff will
 * not trust, so what these assert is the URL the component pushes.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.hoisted(() => vi.fn());
const searchParams = vi.hoisted(() => ({ value: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/customers",
  useSearchParams: () => searchParams.value,
}));

import { CustomerFilters } from "./CustomerFilters";

afterEach(() => {
  push.mockClear();
  searchParams.value = new URLSearchParams();
});

describe("CustomerFilters — ver desactivados (R20)", () => {
  it("is off by default, so the list is active-only until asked otherwise", () => {
    render(<CustomerFilters selected={{}} pageSize={10} />);
    expect(screen.getByRole("checkbox", { name: "Ver desactivados" })).not.toBeChecked();
  });

  it("puts includeInactive=1 in the URL when ticked", async () => {
    const user = userEvent.setup();
    render(<CustomerFilters selected={{}} pageSize={10} />);

    await user.click(screen.getByRole("checkbox", { name: "Ver desactivados" }));

    expect(push).toHaveBeenCalledWith("/customers?includeInactive=1");
  });

  it("removes it from the URL when unticked, rather than setting it to 0", async () => {
    const user = userEvent.setup();
    searchParams.value = new URLSearchParams("includeInactive=1");
    render(<CustomerFilters selected={{ includeInactive: true }} pageSize={10} />);

    await user.click(screen.getByRole("checkbox", { name: "Ver desactivados" }));

    expect(push).toHaveBeenCalledWith("/customers?");
  });

  it("keeps an active search term when the toggle changes", async () => {
    const user = userEvent.setup();
    searchParams.value = new URLSearchParams("search=perez");
    render(<CustomerFilters selected={{ search: "perez" }} pageSize={10} />);

    await user.click(screen.getByRole("checkbox", { name: "Ver desactivados" }));

    const [url] = push.mock.calls[0] as [string];
    expect(url).toContain("search=perez");
    expect(url).toContain("includeInactive=1");
  });

  // `applyFilter` drops `page` for every key except `pageSize`. Without that,
  // ticking the box while on page 3 would land on page 3 of a DIFFERENT result
  // set - usually empty, which reads as "there are none".
  it("returns to page 1 when the toggle changes", async () => {
    const user = userEvent.setup();
    searchParams.value = new URLSearchParams("page=3");
    render(<CustomerFilters selected={{}} pageSize={10} />);

    await user.click(screen.getByRole("checkbox", { name: "Ver desactivados" }));

    expect((push.mock.calls[0] as [string])[0]).not.toContain("page=3");
  });

  it("offers Limpiar once the toggle alone is on, not only after a search", () => {
    render(<CustomerFilters selected={{ includeInactive: true }} pageSize={10} />);
    expect(screen.getByRole("button", { name: "Limpiar" })).toBeInTheDocument();
  });
});
