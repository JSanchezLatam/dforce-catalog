import { describe, expect, it } from "vitest";

import { renderQrSvg } from "./qr";

const URL_WITH_TOKEN = "http://192.168.0.3:3001/c#SENTINEL-token-0123456789abcdefghijklmnopqrstuv";

describe("renderQrSvg", () => {
  it("returns an SVG document string", async () => {
    const svg = await renderQrSvg(URL_WITH_TOKEN);

    expect(svg.startsWith("<?xml") || svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });

  it("scales to its container: a viewBox, and no fixed pixel size", async () => {
    const svg = await renderQrSvg(URL_WITH_TOKEN);

    expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/);
    expect(svg).not.toMatch(/<svg[^>]*\swidth=/);
  });

  it("encodes the text without carrying it: the SVG never contains the URL or the token", async () => {
    const svg = await renderQrSvg(URL_WITH_TOKEN);

    expect(svg).not.toContain("SENTINEL");
    expect(svg).not.toContain("192.168.0.3");
  });

  it("draws different modules for different input", async () => {
    expect(await renderQrSvg(URL_WITH_TOKEN)).not.toBe(await renderQrSvg(URL_WITH_TOKEN.replace("SENTINEL", "OTHER-ZZZ")));
  });

  it("carries no script or external reference", async () => {
    const svg = await renderQrSvg(URL_WITH_TOKEN);

    expect(svg).not.toMatch(/<script|href=|xlink|<image/i);
  });
});
