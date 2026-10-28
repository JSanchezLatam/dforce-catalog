import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";

import { NavSearch } from "./NavSearch";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

function Harness({ href }: { href?: string }) {
  const [query, setQuery] = React.useState("");
  return <NavSearch query={query} onQueryChange={setQuery} firstHref={href} />;
}

describe("NavSearch", () => {
  it("names the input for assistive tech and shows the placeholder", () => {
    render(<Harness />);

    expect(screen.getByRole("textbox", { name: "Buscar en el menú" })).toHaveAttribute("placeholder", "Buscar…");
  });

  it("Esc clears the query", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "Buscar en el menú" });

    await user.type(input, "ven{Escape}");

    expect(input).toHaveValue("");
  });

  it("Enter navigates to the first visible link and clears the query", async () => {
    push.mockClear();
    const user = userEvent.setup();
    render(<Harness href="/vencimientos" />);
    const input = screen.getByRole("textbox", { name: "Buscar en el menú" });

    await user.type(input, "ven{Enter}");

    expect(push).toHaveBeenCalledWith("/vencimientos");
    expect(input).toHaveValue("");
  });

  it("Enter with no result does nothing", async () => {
    push.mockClear();
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "Buscar en el menú" });

    await user.type(input, "zzz{Enter}");

    expect(push).not.toHaveBeenCalled();
    expect(input).toHaveValue("zzz");
  });

  it("hides the / chip on a coarse pointer", () => {
    render(<Harness />);

    expect(screen.getByText("/")).toHaveClass("pointer-coarse:hidden");
  });
});
