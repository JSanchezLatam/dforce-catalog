// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Page from "./page";

let authed: boolean;
vi.mock("../../src/support/session", () => ({ requireSupport: async () => authed }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));

beforeEach(() => {
  authed = true;
});
afterEach(cleanup);

describe("/support (placeholder until the inbox lands)", () => {
  it("redirects to the login page without a session, rendering nothing", async () => {
    authed = false;
    await expect(Page()).rejects.toThrow("REDIRECT /support/login");
  });

  it("renders for a valid session", async () => {
    render(await Page());
    expect(screen.getByRole("heading", { name: "Soporte — Dforce" })).toBeTruthy();
  });
});
