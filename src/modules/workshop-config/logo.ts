export type LogoResult = {
  buffer: Buffer;
  contentType: string;
  ext: string;
};

export const RASTER_SIZE_LIMIT = 2 * 1024 * 1024;
export const SVG_SIZE_LIMIT = 512 * 1024;
/** Largest of the two per-format caps — the route enforces this against
 * `Content-Length` BEFORE buffering the request body, since the exact
 * format (and therefore the tighter SVG cap) is only known after sniffing
 * magic bytes, which requires having read some of the body already. */
export const MAX_UPLOAD_BYTES = RASTER_SIZE_LIMIT;

function detectWebP(buffer: Buffer): boolean {
  return (
    buffer.length >= 12 &&
    buffer[0] === 0x52 && buffer[1] === 0x49 &&
    buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 &&
    buffer[10] === 0x42 && buffer[11] === 0x50
  );
}

function sanitizeSvg(buffer: Buffer): Buffer {
  let raw = buffer.toString("utf8");

  if (/<!DOCTYPE/i.test(raw)) throw new Error("SVG DOCTYPE rejected");
  if (/<!ENTITY/i.test(raw)) throw new Error("SVG ENTITY rejected");

  // ponytail: string-level sanitisation — no XML parser dependency.
  // Ceiling: a crafted payload could bypass these patterns; upgrade to
  // a real SVG sanitizer (e.g. DOMPurify server-side) if throughput matters.
  const SVG_DENY = [/<script[\s>]/i, /<foreignObject[\s>]/i, /<a[\s>]/i, /on\w+\s*=/i];

  for (const p of SVG_DENY) {
    if (p.test(raw)) throw new Error("SVG rejected: dangerous content");
  }

  // Strip remote <use> elements before checking for other remote references
  raw = raw.replace(/<use\s+[^>]*(?:href|xlink:href)\s*=\s*["']https?:\/\/[^"']*["'][^>]*\/?\s*>/gi, "");

  // Reject remaining remote href/xlink:href (e.g. <image>, not <use>)
  if (/xlink:href\s*=\s*["']https?:\/\//i.test(raw)) throw new Error("SVG rejected: remote xlink:href");
  if (/href\s*=\s*["']https?:\/\//i.test(raw)) throw new Error("SVG rejected: remote href");

  raw = raw.replace(/<!--[\s\S]*?-->/g, "");
  raw = raw.replace(/<style[^>]*>@import[^<]*<\/style>/gi, "");

  return Buffer.from(raw, "utf8");
}

export function validateLogo(buffer: Buffer): LogoResult {
  if (buffer.length < 3) throw new Error("File too small");

  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    if (buffer.length > RASTER_SIZE_LIMIT) throw new Error("PNG exceeds 2MB limit");
    return { buffer, contentType: "image/png", ext: "png" };
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    if (buffer.length > RASTER_SIZE_LIMIT) throw new Error("JPEG exceeds 2MB limit");
    return { buffer, contentType: "image/jpeg", ext: "jpg" };
  }

  if (detectWebP(buffer)) {
    if (buffer.length > RASTER_SIZE_LIMIT) throw new Error("WebP exceeds 2MB limit");
    return { buffer, contentType: "image/webp", ext: "webp" };
  }

  const preview = buffer.toString("utf8", 0, Math.min(buffer.length, 256));
  if (preview.startsWith("<?xml") || preview.startsWith("<svg")) {
    if (buffer.length > SVG_SIZE_LIMIT) throw new Error("SVG exceeds 512KB limit");
    const sanitized = sanitizeSvg(buffer);
    return { buffer: sanitized, contentType: "image/svg+xml", ext: "svg" };
  }

  throw new Error("Unrecognised image format");
}
