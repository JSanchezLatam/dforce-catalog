import { afterEach, describe, expect, it, vi } from "vitest";

import { compressPhoto, decodeImage, fitWithin, MAX_PHOTO_EDGE, type Decoded } from "./compress-photo";

afterEach(() => vi.unstubAllGlobals());

describe("fitWithin", () => {
  it("shrinks a landscape photo so its long edge is the max", () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
  });

  it("shrinks a portrait photo so its long edge (the height) is the max", () => {
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it("never upscales a photo already inside the box", () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1600, 1600, 1600)).toEqual({ width: 1600, height: 1600 });
  });

  it("rounds to whole pixels and never reaches 0", () => {
    expect(fitWithin(4001, 3001, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(100000, 10, 1600)).toEqual({ width: 1600, height: 1 });
  });

  it("is 1600 in production", () => {
    expect(MAX_PHOTO_EDGE).toBe(1600);
  });
});

/** The two browser seams, injected: jsdom has neither `createImageBitmap` nor a canvas that draws. */
function harness(toBlobResult: Blob | null, size = { width: 4000, height: 3000 }) {
  const release = vi.fn();
  const decoded: Decoded = { source: {} as CanvasImageSource, ...size, release };
  const drawImage = vi.fn();
  const toBlob = vi.fn((cb: BlobCallback) => cb(toBlobResult));
  const canvas = { width: 0, height: 0, getContext: vi.fn(() => ({ drawImage })), toBlob };
  const createCanvas = vi.fn(() => canvas as unknown as HTMLCanvasElement);
  return { decoded, release, drawImage, toBlob, canvas, createCanvas, decode: vi.fn(async () => decoded) };
}

describe("compressPhoto", () => {
  const file = new File(["x"], "foto.heic", { type: "image/heic" });

  it("draws the decoded image at the fitted size and returns the JPEG at quality 0.8", async () => {
    const h = harness(new Blob(["jpeg"], { type: "image/jpeg" }));
    const out = await compressPhoto(file, { decode: h.decode, createCanvas: h.createCanvas });

    expect(await out.text()).toBe("jpeg");
    expect(h.decode).toHaveBeenCalledWith(file);
    expect(h.canvas.width).toBe(1600);
    expect(h.canvas.height).toBe(1200);
    expect(h.drawImage).toHaveBeenCalledWith(h.decoded.source, 0, 0, 1600, 1200);
    expect(h.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.8);
    expect(h.release).toHaveBeenCalledTimes(1);
  });

  it("keeps a small photo at its own size", async () => {
    const h = harness(new Blob(["j"]), { width: 640, height: 480 });
    await compressPhoto(file, { decode: h.decode, createCanvas: h.createCanvas });

    expect([h.canvas.width, h.canvas.height]).toEqual([640, 480]);
  });

  it("throws when toBlob yields null, and still releases the decoded image", async () => {
    const h = harness(null);

    await expect(compressPhoto(file, { decode: h.decode, createCanvas: h.createCanvas })).rejects.toThrow(
      "No se pudo comprimir la foto",
    );
    expect(h.release).toHaveBeenCalledTimes(1);
  });

  it("throws when the canvas has no 2d context", async () => {
    const h = harness(new Blob(["j"]));
    h.canvas.getContext.mockReturnValue(null as never);

    await expect(compressPhoto(file, { decode: h.decode, createCanvas: h.createCanvas })).rejects.toThrow(
      "No se pudo comprimir la foto",
    );
    expect(h.release).toHaveBeenCalledTimes(1);
  });
});

describe("decodeImage", () => {
  const file = new File(["x"], "foto.jpg", { type: "image/jpeg" });

  it("asks createImageBitmap to apply the EXIF orientation", async () => {
    const bitmap = { width: 4000, height: 3000, close: vi.fn() };
    const createImageBitmap = vi.fn(async () => bitmap);
    vi.stubGlobal("createImageBitmap", createImageBitmap);

    const decoded = await decodeImage(file);

    expect(createImageBitmap).toHaveBeenCalledWith(file, { imageOrientation: "from-image" });
    expect(decoded).toMatchObject({ source: bitmap, width: 4000, height: 3000 });
    decoded.release();
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  describe("fallback to an HTMLImageElement", () => {
    function stubImage() {
      const created = vi.fn(() => "blob:fake-1");
      const revoked = vi.fn();
      vi.stubGlobal("URL", { createObjectURL: created, revokeObjectURL: revoked });
      class FakeImage {
        naturalWidth = 3000;
        naturalHeight = 2000;
        src = "";
        decode = vi.fn(async () => {});
      }
      vi.stubGlobal("Image", FakeImage);
      return { created, revoked };
    }

    it("is used when createImageBitmap does not exist, and the object URL is revoked on release", async () => {
      vi.stubGlobal("createImageBitmap", undefined);
      const { created, revoked } = stubImage();

      const decoded = await decodeImage(file);

      expect(created).toHaveBeenCalledWith(file);
      expect(decoded).toMatchObject({ width: 3000, height: 2000 });
      expect((decoded.source as HTMLImageElement).src).toBe("blob:fake-1");
      expect(revoked).not.toHaveBeenCalled();
      decoded.release();
      expect(revoked).toHaveBeenCalledWith("blob:fake-1");
    });

    it("is used when createImageBitmap rejects (a browser that refuses the options bag)", async () => {
      vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new TypeError("options")));
      stubImage();

      const decoded = await decodeImage(file);

      expect(decoded).toMatchObject({ width: 3000, height: 2000 });
    });

    it("revokes the URL even when the image fails to decode", async () => {
      vi.stubGlobal("createImageBitmap", undefined);
      const { revoked } = stubImage();
      class BrokenImage {
        naturalWidth = 0;
        naturalHeight = 0;
        src = "";
        decode = vi.fn().mockRejectedValue(new Error("EncodingError"));
      }
      vi.stubGlobal("Image", BrokenImage);

      await expect(decodeImage(file)).rejects.toThrow("EncodingError");
      expect(revoked).toHaveBeenCalledWith("blob:fake-1");
    });
  });
});
