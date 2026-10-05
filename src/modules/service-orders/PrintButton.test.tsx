/**
 * jsdom never loads images, so `complete` and `decode` are scripted per
 * element. What this proves is the ORDER of calls; that a real browser has
 * decoded the bitmaps before the print dialog opens is the print preview's job.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PrintButton } from "./PrintButton";

function addImage(opts: { complete: boolean; decode?: () => Promise<void> }) {
  const img = document.createElement("img");
  Object.defineProperty(img, "complete", { value: opts.complete });
  img.decode = vi.fn(opts.decode ?? (async () => {}));
  document.body.appendChild(img);
  return img;
}

afterEach(() => {
  document.querySelectorAll("img").forEach((i) => i.remove());
  vi.restoreAllMocks();
});

describe("PrintButton", () => {
  it("waits for every incomplete image to decode before printing, and skips complete ones", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    let release!: () => void;
    const slow = addImage({ complete: false, decode: () => new Promise<void>((r) => (release = r)) });
    const done = addImage({ complete: true });
    render(<PrintButton />);

    await userEvent.click(screen.getByRole("button", { name: "Imprimir" }));

    expect(slow.decode).toHaveBeenCalledTimes(1);
    expect(done.decode).not.toHaveBeenCalled();
    expect(print).not.toHaveBeenCalled();

    release();
    await vi.waitFor(() => expect(print).toHaveBeenCalledTimes(1));
  });

  it("still prints when a decode rejects", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    addImage({ complete: false, decode: () => Promise.reject(new Error("EncodingError")) });
    render(<PrintButton />);

    await userEvent.click(screen.getByRole("button", { name: "Imprimir" }));

    await vi.waitFor(() => expect(print).toHaveBeenCalledTimes(1));
  });
});
