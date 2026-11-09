// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import Page from "./page";

// The real queries run against a recording stub of the db: any write is a failure.
const writes = vi.hoisted(() => vi.fn());
vi.mock("../../src/db/client", () => {
  const select = () => {
    let grouped = false;
    const chain: Record<string, unknown> = {};
    for (const m of ["from", "where", "orderBy"]) chain[m] = () => chain;
    chain.groupBy = () => ((grouped = true), chain);
    chain.then = (resolve: (v: unknown) => void) => resolve(grouped ? [{ status: "nuevo", n: 1 }] : [{ id: "a", username: "u", role: "tecnico", category: "bug", status: "nuevo", screenLabel: "s", createdAt: new Date(), receivedAt: new Date() }]);
    return chain;
  };
  return { db: { select, update: writes, insert: writes, delete: writes, execute: writes } };
});
vi.mock("../../src/support/session", () => ({ requireSupport: async () => true }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

afterEach(cleanup);

describe("rendering the inbox list", () => {
  it("writes nothing: a Nuevo row stays Nuevo until it is opened with ?id=", async () => {
    render(await Page({ searchParams: Promise.resolve({}) }));
    expect(writes).not.toHaveBeenCalled();
  });
});
