// @vitest-environment jsdom
/**
 * Support palette Opción B (usage-metrics WU6, design D8): dark-only tokens on a
 * `.support` wrapper, so the customer page `/c` keeps `:root`'s palette.
 * Contrast is computed from the CSS itself, so a token edit that breaks 4.5:1 fails here.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import SupportLayout from "./layout";

const css = readFileSync(path.join(__dirname, "support.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
/** Top-level rules only; the file has no nested at-rule that sets a token. */
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
const tokens = Object.fromEntries(
  [...(rules.find((r) => r.selector === ".support")?.body ?? "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
);
const color = (v: string): string => {
  const ref = /^var\((--[\w-]+)\)$/.exec(v);
  return ref ? color(tokens[ref[1]]) : v;
};
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (fg: string, bg: string) => {
  const [a, b] = [luminance(color(fg)), luminance(color(bg))].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
};

afterEach(cleanup);

describe("support palette Opción B", () => {
  it("wraps every support page, login included, in .support", () => {
    render(<SupportLayout>{<p>hijo</p>}</SupportLayout>);
    expect(screen.getByText("hijo").closest(".support")).not.toBeNull();
  });

  it("is dark-only, with the Opción B red as its accent", () => {
    expect(rules.find((r) => r.selector === ".support")?.body).toMatch(/color-scheme:\s*dark/);
    expect(tokens["--accent"]).toBe("#dc2626");
    expect(tokens["--bg"]).toBe("#121417");
  });

  it("sets tokens only on .support, never on :root, html or body, so /c keeps its palette", () => {
    const setters = rules.filter((r) => /--[\w-]+\s*:/.test(r.body));
    expect(setters.length).toBeGreaterThan(0);
    for (const r of setters) expect(r.selector).toBe(".support");
    for (const r of rules) for (const s of r.selector.split(",")) expect(s.trim()).not.toMatch(/^(:root|html|body)\b/);
  });

  it("does not paint Nuevo red: the chip is the brightest neutral", () => {
    expect(color(tokens["--chip-nuevo-bg"])).toBe("#d9dce1");
    expect(color(tokens["--unread-dot"])).not.toBe(tokens["--accent"]);
  });

  it.each([
    ["text on background", "--text", "--bg"],
    ["text on surface", "--text", "--surface"],
    ["muted on background", "--muted", "--bg"],
    ["muted on surface", "--muted", "--surface"],
    ["button text on accent", "--on-accent", "--accent"],
    ["error text on surface", "--danger", "--surface"],
    ["warning text", "--warn-text", "--warn-bg"],
    ["chip Nuevo", "--chip-nuevo-fg", "--chip-nuevo-bg"],
    ["chip Leído", "--chip-leido-fg", "--chip-leido-bg"],
    ["chip Resuelto", "--chip-resuelto-fg", "--chip-resuelto-bg"],
  ])("%s reaches 4.5:1", (_, fg, bg) => {
    expect(contrast(`var(${fg})`, `var(${bg})`)).toBeGreaterThanOrEqual(4.5);
  });
});
