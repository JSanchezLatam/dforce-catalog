/**
 * Text guard over `globals.css`: jsdom loads no stylesheet, so the app palette
 * (support palette Opción B, adopted app-wide on 2026-11-18) and its contrast
 * pairs can only be pinned by reading the file.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const srcDir = path.resolve(import.meta.dirname, "..");
const css = fs
  .readFileSync(path.join(srcDir, "app/globals.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

function tokensOf(selector: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const [, rule, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (rule.trim() !== selector) continue;
    for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokens[name] = value.trim();
  }
  return tokens;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

const PAIRS = [
  ["--foreground", "--background"],
  ["--card-foreground", "--card"],
  ["--popover-foreground", "--popover"],
  ["--primary-foreground", "--primary"],
  ["--secondary-foreground", "--secondary"],
  ["--muted-foreground", "--muted"],
  ["--muted-foreground", "--background"],
  ["--muted-foreground", "--card"],
  ["--accent-foreground", "--accent"],
  ["--sidebar-foreground", "--sidebar"],
  ["--sidebar-primary-foreground", "--sidebar-primary"],
  ["--sidebar-accent-foreground", "--sidebar-accent"],
] as const;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe("app palette", () => {
  it("uses the support palette values in dark", () => {
    expect(tokensOf(".dark")).toMatchObject({
      "--background": "#121417",
      "--foreground": "#d9dce1",
      "--card": "#1b1e22",
      "--primary": "#dc2626",
      "--primary-foreground": "#ffffff",
      "--muted-foreground": "#a3a8b0",
      "--border": "#2e3238",
      "--sidebar": "#1b1e22",
    });
  });

  it("keeps the workshop red as the primary colour in light", () => {
    expect(tokensOf(":root")["--primary"]).toBe("#dc2626");
  });

  it.each([":root", ".dark"])("keeps every text pair at 4.5:1 or more in %s", (selector) => {
    const tokens = tokensOf(selector);
    for (const [foreground, background] of PAIRS) {
      expect(
        contrast(tokens[foreground], tokens[background]),
        `${foreground} on ${background}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("never uses the red primary as a text colour, it fails 4.5:1 on the dark ground", () => {
    const offenders = sourceFiles(srcDir).filter((file) =>
      /(^|[\s"'`:])text-(sidebar-)?primary(?![-\w])/.test(fs.readFileSync(file, "utf8")),
    );
    expect(offenders.map((file) => path.relative(srcDir, file))).toEqual([]);
  });

  it("gives links the text colour with a red underline", () => {
    const link = /@utility link-accent \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(link).toContain("color: var(--foreground);");
    expect(link).toContain("text-decoration-color: var(--primary);");
    expect(link).toContain("&:hover");
  });

  it("opens in the dark theme", () => {
    const layout = fs.readFileSync(path.join(srcDir, "app/layout.tsx"), "utf8");
    expect(layout).toContain('defaultTheme="dark"');
  });
});
