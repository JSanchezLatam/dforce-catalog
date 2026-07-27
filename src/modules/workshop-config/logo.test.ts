import { describe, expect, it } from "vitest";

import { validateLogo } from "./logo";

function pngMagic(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}
function jpegMagic(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff]);
}
function webpMagic(): Buffer {
  return Buffer.from("RIFF\x00\x00\x00\x00WEBP");
}
function svgBuffer(content: string): Buffer {
  return Buffer.from(content);
}

describe("validateLogo — magic byte sniff", () => {
  it("accepts a valid PNG within size limit", () => {
    const result = validateLogo(pngMagic());
    expect(result).toEqual({ buffer: pngMagic(), contentType: "image/png", ext: "png" });
  });

  it("accepts a valid JPEG within size limit", () => {
    const result = validateLogo(jpegMagic());
    expect(result).toEqual({ buffer: jpegMagic(), contentType: "image/jpeg", ext: "jpg" });
  });

  it("accepts a valid WebP within size limit", () => {
    const result = validateLogo(webpMagic());
    expect(result).toEqual({ buffer: webpMagic(), contentType: "image/webp", ext: "webp" });
  });

  it("accepts an SVG with <?xml prefix", () => {
    const svg = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>';
    const result = validateLogo(svgBuffer(svg));
    expect(result.contentType).toBe("image/svg+xml");
    expect(result.ext).toBe("svg");
  });

  it("accepts an SVG with <svg prefix", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    const result = validateLogo(svgBuffer(svg));
    expect(result.contentType).toBe("image/svg+xml");
    expect(result.ext).toBe("svg");
  });

  it("rejects an unknown format", () => {
    expect(() => validateLogo(Buffer.from([0x00, 0x01, 0x02]))).toThrow();
  });
});

describe("validateLogo — size limits", () => {
  it("rejects a raster image over 2MB", () => {
    const buf = Buffer.concat([pngMagic(), Buffer.alloc(2 * 1024 * 1024)]);
    expect(() => validateLogo(buf)).toThrow();
  });

  it("accepts a raster image at exactly 2MB", () => {
    const buf = Buffer.concat([pngMagic(), Buffer.alloc(2 * 1024 * 1024 - pngMagic().length)]);
    expect(() => validateLogo(buf)).not.toThrow();
  });

  it("rejects an SVG over 512KB", () => {
    const buf = Buffer.concat([Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'), Buffer.alloc(512 * 1024), Buffer.from("</svg>")]);
    expect(() => validateLogo(buf)).toThrow();
  });

  it("accepts an SVG at exactly 512KB", () => {
    const head = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">');
    const foot = Buffer.from("</svg>");
    const padding = 512 * 1024 - head.length - foot.length;
    const buf = Buffer.concat([head, Buffer.alloc(Math.max(0, padding)), foot]);
    expect(() => validateLogo(buf)).not.toThrow();
  });
});

describe("validateLogo — SVG reject cases", () => {
  it("rejects SVG with <script>", () => {
    expect(() => validateLogo(svgBuffer('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toThrow();
  });

  it("rejects SVG with <foreignObject>", () => {
    expect(() => validateLogo(svgBuffer('<svg xmlns="http://www.w3.org/2000/svg"><foreignObject></foreignObject></svg>'))).toThrow();
  });

  it("rejects SVG with event handlers (onclick)", () => {
    expect(() => validateLogo(svgBuffer('<svg xmlns="http://www.w3.org/2000/svg" onclick="alert(1)"></svg>'))).toThrow();
  });

  it("rejects SVG with remote xlink:href", () => {
    expect(() => validateLogo(svgBuffer('<svg xmlns="http://www.w3.org/2000/svg"><image xlink:href="http://evil.com/x.svg"/></svg>'))).toThrow();
  });

  it("rejects SVG with remote href", () => {
    expect(() => validateLogo(svgBuffer('<svg xmlns="http://www.w3.org/2000/svg"><image href="http://evil.com/x.svg"/></svg>'))).toThrow();
  });

  it("rejects SVG with <!DOCTYPE", () => {
    expect(() => validateLogo(svgBuffer('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg></svg>'))).toThrow();
  });

  it("rejects SVG with <!ENTITY", () => {
    expect(() => validateLogo(svgBuffer('<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg></svg>'))).toThrow();
  });

  it("rejects SVG with <a> (anchor)", () => {
    expect(() => validateLogo(svgBuffer('<svg xmlns="http://www.w3.org/2000/svg"><a href="http://evil.com"><text>click</text></a></svg>'))).toThrow();
  });
});

describe("validateLogo — SVG sanitized output stability", () => {
  it("strips XML comments", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>hello</text><!-- comment --></svg>';
    const result = validateLogo(svgBuffer(svg));
    expect(result.buffer.toString()).not.toContain("comment");
    expect(result.buffer.toString()).toContain("hello");
  });

  it("strips @import inside <style>", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><style>@import url("http://evil.com");</style><text>hello</text></svg>';
    const result = validateLogo(svgBuffer(svg));
    const out = result.buffer.toString();
    expect(out).not.toContain("import");
    expect(out).toContain("hello");
  });

  it("strips non-local <use> elements", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><use href="#local"/><use href="http://evil.com/icon.svg#x"/><text>hello</text></svg>';
    const result = validateLogo(svgBuffer(svg));
    const out = result.buffer.toString();
    expect(out).toContain("#local");
    expect(out).not.toContain("evil.com");
    expect(out).toContain("hello");
  });

  it("keeps legitimate content stable", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="red"/><text x="50" y="55" text-anchor="middle">Dforce</text></svg>';
    const result = validateLogo(svgBuffer(svg));
    expect(result.buffer.toString()).toBe(svg);
  });

  it("rejects corrupt/malformed file", () => {
    expect(() => validateLogo(Buffer.from([0x89, 0x50, 0x4e]))).toThrow();
  });
});
