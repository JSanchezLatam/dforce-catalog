import { StrictMode } from "react";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pathname = vi.hoisted(() => ({ current: "/service-orders" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

import { UsageCounter } from "./UsageCounter";

// A plain function, not `vi.fn`: Vitest's spy attaches its own handler to a returned
// promise to record `settledResults`, so a rejection from a `vi.fn` is never unhandled
// and a missing `.catch` would pass. Resolves to a 204 Response, as the route answers.
type Call = [url: string, init?: RequestInit];
let calls: Call[] = [];
let respond: () => Promise<Response> = () => Promise.resolve(new Response(null, { status: 204 }));
function fetchMock(url: string, init?: RequestInit): Promise<Response> {
  calls.push([url, init]);
  return respond();
}

function sentScreens(): string[] {
  return calls.map(([, init]) => JSON.parse(String(init?.body)).screen);
}

beforeEach(() => {
  calls = [];
  respond = () => Promise.resolve(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  pathname.current = "/service-orders";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UsageCounter", () => {
  it("sends exactly one view on first mount, as a keepalive JSON POST", () => {
    const { container } = render(<UsageCounter />);

    expect(container).toBeEmptyDOMElement();
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0];
    expect(url).toBe("/api/usage/view");
    expect(init).toEqual({
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ screen: "/service-orders" }),
    });
  });

  it("sends nothing more on a re-render with the same pathname", () => {
    pathname.current = "/agenda";
    const { rerender } = render(<UsageCounter />);
    rerender(<UsageCounter />);
    rerender(<UsageCounter />);

    expect(sentScreens()).toEqual(["/agenda"]);
  });

  it("sends one view under StrictMode's double effect", () => {
    pathname.current = "/agenda";
    render(
      <StrictMode>
        <UsageCounter />
      </StrictMode>,
    );

    expect(sentScreens()).toEqual(["/agenda"]);
  });

  it("sends two views for two orders, both under the /service-orders/[id] pattern", () => {
    pathname.current = "/service-orders/a";
    const { rerender } = render(<UsageCounter />);
    pathname.current = "/service-orders/b";
    rerender(<UsageCounter />);

    expect(sentScreens()).toEqual(["/service-orders/[id]", "/service-orders/[id]"]);
  });

  it("maps a nested dynamic route to its pattern", () => {
    pathname.current = "/customers/7/vehicles/9";
    render(<UsageCounter />);

    expect(sentScreens()).toEqual(["/customers/[id]/vehicles/[vehicleId]"]);
  });

  // usePathname carries no search params, so a query change re-renders with the same pathname.
  it("sends nothing when only the search params change", () => {
    pathname.current = "/customers";
    const { rerender } = render(<UsageCounter />);
    calls = [];
    rerender(<UsageCounter />);

    expect(calls).toEqual([]);
  });

  it("sends nothing for a route that has no screen label", () => {
    pathname.current = "/no-such-screen";
    render(<UsageCounter />);

    expect(calls).toEqual([]);
  });

  it("swallows a rejected fetch: no throw, no console error, navigation continues", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    respond = () => Promise.reject(new TypeError("Failed to fetch"));

    const { rerender } = render(<UsageCounter />);
    await new Promise((r) => setTimeout(r, 0));
    pathname.current = "/agenda";
    rerender(<UsageCounter />);
    // Node reports an unhandled rejection only after the turn that created it, so wait a full macrotask.
    await new Promise((r) => setTimeout(r, 20));

    expect(sentScreens()).toEqual(["/service-orders", "/agenda"]);
    expect(consoleError).not.toHaveBeenCalled();
    expect(unhandled).not.toHaveBeenCalled();
    process.off("unhandledRejection", unhandled);
    consoleError.mockRestore();
  });
});
