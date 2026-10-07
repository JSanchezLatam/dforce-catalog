/**
 * `OrderPhotos` is a client card. The compressor is INJECTED (`compress`):
 * jsdom has no `createImageBitmap` and no drawing canvas, so faking them here
 * would test the fake. `compress-photo.test.ts` owns that boundary.
 *
 * `useToast` is mocked rather than rendered: two of the rules this card must
 * keep are about ORDER (toast above `router.refresh()`) and about the COUNT
 * the toast reports, and call order is not observable through the DOM because
 * React batches both state updates into one commit.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
const addToast = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/shared/ui/ToastProvider", () => ({ useToast: () => ({ addToast }) }));

import { OrderPhotos } from "./OrderPhotos";

const photo = (n: number) => ({ id: `p${n}` });
const photos = (count: number) => Array.from({ length: count }, (_, i) => photo(i + 1));

const jpeg = (name: string) => new File([name], name, { type: "image/jpeg" });
const compressed: Blob[] = [];
const compress = vi.fn(async (file: File) => {
  const blob = new Blob([`compressed-${file.name}`], { type: "image/jpeg" });
  compressed.push(blob);
  return blob;
});

/** The wire: POST answers `{id, position}`; every 409 carries `{error, message}`. */
const created = () => new Response(JSON.stringify({ id: "new", position: 5 }), { status: 201 });
const conflict = (error: "photo_limit" | "order_closed", message: string) =>
  new Response(JSON.stringify({ error, message }), { status: 409 });
const serverError = () => new Response(JSON.stringify({ error: "boom" }), { status: 500 });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function renderCard(props: Partial<React.ComponentProps<typeof OrderPhotos>> = {}) {
  return render(
    <OrderPhotos orderId="o1" photos={photos(5)} canAdd canDelete={false} compress={compress} {...props} />,
  );
}

beforeEach(() => {
  compressed.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("OrderPhotos — the grid", () => {
  it("shows the counter and one lazy thumbnail per photo, in the order given, served by the authenticated route", () => {
    renderCard({ photos: [photo(3), photo(1), photo(2)] });

    expect(screen.getByText("3 de 12")).toBeInTheDocument();
    const imgs = screen.getAllByRole("img");
    expect(imgs.map((i) => i.getAttribute("src"))).toEqual([
      "/api/service-orders/o1/photos/p3",
      "/api/service-orders/o1/photos/p1",
      "/api/service-orders/o1/photos/p2",
    ]);
    imgs.forEach((img) => expect(img).toHaveAttribute("loading", "lazy"));
  });

  it("opens a thumbnail large: each is a link to the same image", () => {
    renderCard({ photos: photos(2) });

    expect(screen.getByRole("link", { name: "Abrir foto 2" })).toHaveAttribute(
      "href",
      "/api/service-orders/o1/photos/p2",
    );
  });

  it("says so when there are no photos yet", () => {
    renderCard({ photos: [] });

    expect(screen.getByText("0 de 12")).toBeInTheDocument();
    expect(screen.getByText("Todavía no hay fotos.")).toBeInTheDocument();
  });
});

describe("OrderPhotos — the add control", () => {
  it("offers gallery AND camera: accept image/*, multiple, and NO capture attribute", () => {
    renderCard();
    const input = screen.getByLabelText("Agregar fotos");

    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", "image/*");
    expect(input).toHaveAttribute("multiple");
    expect(input).not.toHaveAttribute("capture");
  });

  it("is absent when canAdd is false, though the photos still show", () => {
    renderCard({ canAdd: false });

    expect(screen.queryByLabelText("Agregar fotos")).not.toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(5);
  });

  it("is absent once the order already holds 12 photos", () => {
    renderCard({ photos: photos(12) });

    expect(screen.queryByLabelText("Agregar fotos")).not.toBeInTheDocument();
    expect(screen.getByText("12 de 12")).toBeInTheDocument();
  });
});

describe("OrderPhotos — uploading", () => {
  it("compresses each file, then POSTs the COMPRESSED blob as field `file`", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => created());
    vi.stubGlobal("fetch", fetchMock);
    renderCard();

    await user.upload(screen.getByLabelText("Agregar fotos"), [jpeg("a.jpg")]);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/service-orders/o1/photos");
    expect(init.method).toBe("POST");
    const sent = (init.body as FormData).get("file") as File;
    expect(sent.size).toBe(compressed[0].size);
    expect(sent.size).not.toBe(jpeg("a.jpg").size);
    // No Content-Type header: the browser must add the multipart boundary itself.
    expect(init.headers).toBeUndefined();
  });

  it("uploads one at a time, announcing 'Subiendo 2 de 3…' in an aria-live region", async () => {
    const user = userEvent.setup();
    const first = deferred<Response>();
    const second = deferred<Response>();
    const third = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise);
    vi.stubGlobal("fetch", fetchMock);
    renderCard();

    await user.upload(screen.getByLabelText("Agregar fotos"), [jpeg("a.jpg"), jpeg("b.jpg"), jpeg("c.jpg")]);

    const status = await screen.findByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    await waitFor(() => expect(status).toHaveTextContent("Subiendo 1 de 3…"));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    first.resolve(created());
    await waitFor(() => expect(status).toHaveTextContent("Subiendo 2 de 3…"));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    second.resolve(created());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    third.resolve(created());
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("locks the add control while a batch runs", async () => {
    const user = userEvent.setup();
    const pending = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => pending.promise));
    renderCard();

    await user.upload(screen.getByLabelText("Agregar fotos"), [jpeg("a.jpg")]);

    await waitFor(() => expect(screen.getByLabelText("Agregar fotos")).toBeDisabled());
    pending.resolve(created());
    await waitFor(() => expect(screen.getByLabelText("Agregar fotos")).toBeEnabled());
  });

  it("reports the APPLIED count, singular for one and plural for several", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => created()));
    renderCard();

    await user.upload(screen.getByLabelText("Agregar fotos"), [jpeg("a.jpg")]);
    await waitFor(() => expect(addToast).toHaveBeenCalledWith("success", "1 foto agregada"));

    addToast.mockClear();
    await user.upload(screen.getByLabelText("Agregar fotos"), [jpeg("a.jpg"), jpeg("b.jpg"), jpeg("c.jpg")]);
    await waitFor(() => expect(addToast).toHaveBeenCalledWith("success", "3 fotos agregadas"));
  });

  it("reports 2 of 3 when one file fails, and the failed file gets its OWN error toast", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(created()).mockResolvedValueOnce(serverError()).mockResolvedValueOnce(created()),
    );
    renderCard();

    await user.upload(screen.getByLabelText("Agregar fotos"), [jpeg("a.jpg"), jpeg("b.jpg"), jpeg("c.jpg")]);

    await waitFor(() => expect(addToast).toHaveBeenCalledWith("success", "2 fotos agregadas"));
    expect(addToast).toHaveBeenCalledWith("error", "No se pudo subir b.jpg.");
    expect(addToast).not.toHaveBeenCalledWith("success", "3 fotos agregadas");
  });

  it("toasts BEFORE it refreshes", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => created()));
    renderCard();

    await user.upload(screen.getByLabelText("Agregar fotos"), [jpeg("a.jpg")]);

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(addToast.mock.invocationCallOrder[0]).toBeLessThan(refresh.mock.invocationCallOrder[0]);
  });

  it("keeps going past a file that cannot be compressed, and names it", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => created());
    vi.stubGlobal("fetch", fetchMock);
    compress.mockRejectedValueOnce(new Error("No se pudo comprimir la foto"));
    renderCard();

    await user.upload(screen.getByLabelText("Agregar fotos"), [jpeg("bad.heic"), jpeg("ok.jpg")]);

    await waitFor(() => expect(addToast).toHaveBeenCalledWith("success", "1 foto agregada"));
    expect(addToast).toHaveBeenCalledWith("error", "No se pudo procesar bad.heic.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops at a 409 and shows the server's own message instead of failing every remaining file", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(conflict("order_closed", "La orden está cerrada"));
    vi.stubGlobal("fetch", fetchMock);
    renderCard();

    await user.upload(screen.getByLabelText("Agregar fotos"), [jpeg("a.jpg"), jpeg("b.jpg"), jpeg("c.jpg")]);

    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("error", "La orden está cerrada"),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Nothing applied: no success toast and nothing to refresh.
    expect(addToast).not.toHaveBeenCalledWith("success", expect.anything());
    expect(refresh).not.toHaveBeenCalled();
  });

  it("says the connection failed, stops, and does not claim success when the request never lands", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    renderCard();

    await user.upload(screen.getByLabelText("Agregar fotos"), [jpeg("a.jpg"), jpeg("b.jpg")]);

    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("error", "No se pudo conectar. Revisa tu conexión e intenta de nuevo."),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(addToast).not.toHaveBeenCalledWith("success", expect.anything());
    expect(refresh).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText("Agregar fotos")).toBeEnabled());
  });

  // A stalled LAN connection never rejects on its own: without a deadline the
  // card sits on "Subiendo…" forever. The abort turns it into the same
  // rejection a dropped connection produces.
  it("aborts an upload that stalls for 60 s, says the connection failed, and stops the batch", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const fetchMock = vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      );
      vi.stubGlobal("fetch", fetchMock);
      renderCard();

      fireEvent.change(screen.getByLabelText("Agregar fotos"), { target: { files: [jpeg("a.jpg"), jpeg("b.jpg")] } });
      await vi.advanceTimersByTimeAsync(59_999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(addToast).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });

      expect(addToast).toHaveBeenCalledWith("error", "No se pudo conectar. Revisa tu conexión e intenta de nuevo.");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(addToast).not.toHaveBeenCalledWith("success", expect.anything());
      expect(screen.getByLabelText("Agregar fotos")).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("uploads only up to the remaining slots and tells the operator how many were skipped", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => created());
    vi.stubGlobal("fetch", fetchMock);
    renderCard({ photos: photos(10) });

    await user.upload(
      screen.getByLabelText("Agregar fotos"),
      ["a", "b", "c", "d", "e"].map((n) => jpeg(`${n}.jpg`)),
    );

    await waitFor(() => expect(addToast).toHaveBeenCalledWith("success", "2 fotos agregadas"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(addToast).toHaveBeenCalledWith("error", "3 fotos no se subieron: el máximo es 12 por orden.");
  });

  it("uses the singular when exactly one file does not fit", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => created()));
    renderCard({ photos: photos(11) });

    await user.upload(screen.getByLabelText("Agregar fotos"), [jpeg("a.jpg"), jpeg("b.jpg")]);

    await waitFor(() => expect(addToast).toHaveBeenCalledWith("success", "1 foto agregada"));
    expect(addToast).toHaveBeenCalledWith("error", "1 foto no se subió: el máximo es 12 por orden.");
  });
});

describe("OrderPhotos — deleting", () => {
  it("shows no delete control to a user who cannot delete", () => {
    renderCard({ canDelete: false });

    expect(screen.queryByRole("button", { name: /Borrar foto/ })).not.toBeInTheDocument();
  });

  it("shows one delete control per photo to a user who can", () => {
    renderCard({ canDelete: true, photos: photos(3) });

    expect(screen.getAllByRole("button", { name: /Borrar foto/ })).toHaveLength(3);
  });

  it("asks first; cancelling sends nothing", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderCard({ canDelete: true });

    await user.click(screen.getByRole("button", { name: "Borrar foto 2" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("¿Eliminar la foto 2?");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("confirming DELETEs that photo, toasts 'Foto eliminada' and refreshes", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    renderCard({ canDelete: true });

    await user.click(screen.getByRole("button", { name: "Borrar foto 2" }));
    await user.click(await screen.findByRole("button", { name: "Eliminar" }));

    await waitFor(() => expect(addToast).toHaveBeenCalledWith("success", "Foto eliminada"));
    expect(fetchMock).toHaveBeenCalledWith("/api/service-orders/o1/photos/p2", { method: "DELETE" });
    expect(addToast.mock.invocationCallOrder[0]).toBeLessThan(refresh.mock.invocationCallOrder[0]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("keeps the dialog open with the server's message when the order closed meanwhile", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => conflict("order_closed", "La orden está cerrada")),
    );
    renderCard({ canDelete: true });

    await user.click(screen.getByRole("button", { name: "Borrar foto 1" }));
    await user.click(await screen.findByRole("button", { name: "Eliminar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("La orden está cerrada");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(addToast).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("says the connection failed, inline, when the request never lands", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    renderCard({ canDelete: true });

    await user.click(screen.getByRole("button", { name: "Borrar foto 1" }));
    await user.click(await screen.findByRole("button", { name: "Eliminar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo conectar");
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Eliminar" })).toBeEnabled();
  });
});
