import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";

import { SidebarProvider } from "@/components/ui/sidebar";
import { NavSearch } from "./NavSearch";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia;
});

function Harness({ href, defaultOpen = true }: { href?: string; defaultOpen?: boolean }) {
  const [query, setQuery] = React.useState("");
  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <NavSearch query={query} onQueryChange={setQuery} firstHref={href} />
      <input aria-label="otro" />
      <textarea aria-label="nota" />
      <select aria-label="rol">
        <option>a</option>
      </select>
      <div role="textbox" aria-label="editable" contentEditable tabIndex={0} suppressContentEditableWarning />
    </SidebarProvider>
  );
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

  describe("/ shortcut and rail button", () => {
    const original = window.innerWidth;
    afterEach(() => {
      window.innerWidth = original;
    });
    const box = () => screen.getByRole("textbox", { name: "Buscar en el menú" });

    it("/ on the body focuses the box and types nothing", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await user.keyboard("/");

      expect(box()).toHaveFocus();
      expect(box()).toHaveValue("");
    });

    it.each([
      ["input", "otro"],
      ["textarea", "nota"],
      ["select", "rol"],
      ["contenteditable", "editable"],
    ])("/ inside a page %s leaves focus alone", async (_n, name) => {
      const user = userEvent.setup();
      render(<Harness />);
      const el = screen.getByRole(name === "rol" ? "combobox" : "textbox", { name });
      el.focus();

      await user.keyboard("/");

      expect(el).toHaveFocus();
    });

    it.each([["Control"], ["Meta"], ["Alt"]])("/ with %s held leaves focus alone", async (mod) => {
      const user = userEvent.setup();
      render(<Harness />);

      await user.keyboard(`{${mod}>}/{/${mod}}`);

      expect(box()).not.toHaveFocus();
    });

    it("/ in the rail expands the sidebar and focuses the box", async () => {
      const user = userEvent.setup();
      render(<Harness defaultOpen={false} />);

      await user.keyboard("/");

      await waitFor(() => expect(box()).toHaveFocus());
      expect(document.cookie).toContain("sidebar_state=true");
    });

    it("the rail button 'Buscar en el menú' expands the sidebar and focuses the box", async () => {
      const user = userEvent.setup();
      render(<Harness defaultOpen={false} />);

      await user.click(screen.getByRole("button", { name: "Buscar en el menú" }));

      await waitFor(() => expect(box()).toHaveFocus());
      expect(document.cookie).toContain("sidebar_state=true");
    });

    it("/ does nothing below 1024 while the sheet is closed", async () => {
      window.innerWidth = 800;
      const user = userEvent.setup();
      render(<Harness />);

      await user.keyboard("/");

      expect(box()).not.toHaveFocus();
    });

    it("stops listening once unmounted", () => {
      const { unmount } = render(<Harness />);
      const press = () => {
        const e = new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true });
        document.body.dispatchEvent(e);
        return e.defaultPrevented;
      };
      expect(press()).toBe(true);

      unmount();

      expect(press()).toBe(false);
    });
  });
});
