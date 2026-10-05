"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, LoaderCircle, Trash2 } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { CONNECTION_ERROR } from "@/shared/ui/messages";
import { FIELD_ERROR } from "@/shared/ui/styles";
import { useToast } from "@/shared/ui/ToastProvider";
import { compressPhoto } from "./compress-photo";
import { MAX_PHOTOS } from "./photo-limits";

/** Per photo (<=3 MB after compression); a healthy LAN takes a fraction of this. */
const UPLOAD_TIMEOUT_MS = 60_000;
const photoUrl = (orderId: string, photoId: string) => `/api/service-orders/${orderId}/photos/${photoId}`;
const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/** Every 409 from the photo routes is `{error, message}` with the Spanish text ready to show. */
async function conflictMessage(response: Response): Promise<string | null> {
  if (response.status !== 409) return null;
  const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
  return typeof body?.message === "string" ? body.message : null;
}

/**
 * Reception photos card. Every boolean is resolved on the server (`canAdd`,
 * `canDelete`), so no function crosses the Server -> Client boundary and the
 * card never re-derives a permission. `compress` is a seam for tests only:
 * jsdom has neither `createImageBitmap` nor a drawing canvas.
 *
 * The browser here is in an INSECURE context (plain HTTP on a LAN): nothing in
 * this file or `compress-photo.ts` may need `crypto.randomUUID`, the clipboard
 * or `mediaDevices`. The file input has no `capture`, so a phone offers both
 * the camera and the gallery and allows picking several photos.
 */
export function OrderPhotos({
  orderId,
  photos,
  canAdd,
  canDelete,
  compress = compressPhoto,
}: {
  orderId: string;
  photos: { id: string }[];
  canAdd: boolean;
  canDelete: boolean;
  compress?: (file: File) => Promise<Blob>;
}) {
  const router = useRouter();
  const { addToast } = useToast();
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; number: number } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const slots = MAX_PHOTOS - photos.length;
  const isUploading = progress !== null;

  async function uploadAll(selected: File[]) {
    const files = selected.slice(0, Math.max(slots, 0));
    const skipped = selected.length - files.length;
    if (skipped > 0) {
      addToast("error", `${plural(skipped, "foto no se subió", "fotos no se subieron")}: el máximo es ${MAX_PHOTOS} por orden.`);
    }

    let applied = 0;
    for (const [index, file] of files.entries()) {
      setProgress({ current: index + 1, total: files.length });

      let body: Blob;
      try {
        body = await compress(file);
      } catch {
        addToast("error", `No se pudo procesar ${file.name}.`);
        continue;
      }

      const form = new FormData();
      form.append("file", body, "foto.jpg");
      let response: Response;
      // A stalled LAN connection never rejects by itself; the abort makes it
      // the same failure a dropped one is. Plain AbortController + setTimeout:
      // no secure-context API.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
      try {
        // No Content-Type header: the browser adds the multipart boundary itself.
        response = await fetch(`/api/service-orders/${orderId}/photos`, {
          method: "POST",
          body: form,
          signal: controller.signal,
        });
      } catch {
        addToast("error", CONNECTION_ERROR);
        break;
      } finally {
        clearTimeout(timer);
      }

      if (response.ok) {
        applied += 1;
        continue;
      }
      const conflict = await conflictMessage(response);
      if (conflict) {
        // photo_limit / order_closed: every remaining file would fail the same way.
        addToast("error", conflict);
        break;
      }
      addToast("error", `No se pudo subir ${file.name}.`);
    }
    setProgress(null);

    // Below the per-file try/catch, and the toast above the refresh: a refresh
    // that throws must not retract the only confirmation of photos the server
    // already accepted. The count is what APPLIED, never `files.length`.
    if (applied > 0) {
      addToast("success", `${plural(applied, "foto agregada", "fotos agregadas")}`);
      router.refresh();
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const response = await fetch(photoUrl(orderId, pendingDelete.id), { method: "DELETE" });
      if (!response.ok) {
        setDeleteError((await conflictMessage(response)) ?? "No se pudo eliminar la foto.");
        return;
      }
    } catch {
      setDeleteError(CONNECTION_ERROR);
      return;
    } finally {
      setIsDeleting(false);
    }
    setPendingDelete(null);
    addToast("success", "Foto eliminada");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {photos.length} de {MAX_PHOTOS}
        </p>
        {canAdd && slots > 0 && (
          <label
            className={cn(
              buttonVariants({ variant: "default", size: "default" }),
              "min-h-11 min-w-11 cursor-pointer has-focus-visible:ring-3 has-focus-visible:ring-ring/50 max-sm:w-full",
              isUploading && "pointer-events-none opacity-50",
            )}
          >
            <Camera aria-hidden="true" />
            Agregar fotos
            <input
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              disabled={isUploading}
              onChange={(event) => {
                const selected = Array.from(event.target.files ?? []);
                // Reset so choosing the same file again still fires `change`.
                event.target.value = "";
                if (selected.length > 0) void uploadAll(selected);
              }}
            />
          </label>
        )}
      </div>

      {progress && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2 text-sm"
        >
          <LoaderCircle className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
          Subiendo {progress.current} de {progress.total}…
        </div>
      )}

      {photos.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no hay fotos.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {photos.map((photo, index) => (
            <li key={photo.id} className="relative aspect-4/3 overflow-hidden rounded-lg border bg-muted">
              <a
                href={photoUrl(orderId, photo.id)}
                target="_blank"
                rel="noreferrer"
                aria-label={`Abrir foto ${index + 1}`}
              >
                {/* A plain <img>: the route is authenticated and its bytes are already <=1600px. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoUrl(orderId, photo.id)}
                  alt={`Foto de recepción ${index + 1}`}
                  loading="lazy"
                  className="size-full object-cover"
                />
              </a>
              {canDelete && (
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="absolute top-1 right-1 min-h-11 min-w-11"
                  aria-label={`Borrar foto ${index + 1}`}
                  onClick={() => {
                    setDeleteError(null);
                    setPendingDelete({ id: photo.id, number: index + 1 });
                  }}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => !open && !isDeleting && setPendingDelete(null)}>
        <DialogContent showCloseButton={false}>
          <DialogTitle>¿Eliminar la foto {pendingDelete?.number}?</DialogTitle>
          <p className="px-6 text-sm text-muted-foreground">Esta acción no se puede deshacer.</p>
          {deleteError && (
            <p role="alert" className={`px-6 ${FIELD_ERROR}`}>
              {deleteError}
            </p>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={isDeleting} className="min-h-11 min-w-11" />}>
              Cancelar
            </DialogClose>
            <Button variant="destructive" className="min-h-11 min-w-11" disabled={isDeleting} onClick={confirmDelete}>
              {isDeleting ? "Eliminando…" : "Eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
