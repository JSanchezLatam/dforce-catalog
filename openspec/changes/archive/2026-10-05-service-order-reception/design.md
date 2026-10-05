# Design: Service Order Reception

## Technical Approach

Three additive migrations; intake fields are whitelisted fields on the existing create/PATCH routes; photos are a child table plus one service (`photos.ts`) whose writes serialize on a row lock of the parent order. Compression is client-side with only APIs that do not need a secure context. Print adds rows, a print-only QR slot and chunked photo pages.

## Architecture Decisions

| Decision | Choice | Rejected | Why |
|---|---|---|---|
| Columns | `cliente.documento_identidad text`. `orden_servicio.kilometraje integer` CHECK `between 0 and 2000000`, `nivel_combustible smallint` CHECK `between 0 and 4`, `bateria_pct smallint` CHECK `between 0 and 100`. All nullable | DB CHECK on the document's length | The spec caps the document in code only, like `phone`. The intake ranges are the spec's DB-level rule |
| Migrations | `drizzle-kit generate --name cliente_documento` (0023, PR1), `--name orden_intake` (0024, PR2), `--name orden_servicio_foto` (0025, PR3). Read the generated SQL to confirm each CHECK | Hand-written SQL, a trigger | Repo convention |
| Document write | `normalizeDocumento(v)`: trims, `""`→`null`, >30 → `ClienteValidationError` "La cédula / RUC no puede superar 30 caracteres". `updateCliente` sets `persistedPatch.documentoIdentidad` from it, as `phone` is set at `service.ts:224`. The form sends `trim() \|\| null` | Sending `undefined` the way `email` is sent | `persistedPatch` is the RAW patch, so without this an untrimmed value would be persisted. `undefined` can never clear the field |
| Photo table | `orden_servicio_foto(id text PK set by the service, orden_id FK cascade, r2_key text, position smallint, created_by FK set null, created_at)`, plus `uniqueIndex(orden_id, position)`. No `content_type` column | `content_type` column | Only JPEG is accepted. The unique index orders the list and backs up the lock |
| R2 key | `service-orders/<ordenId>/<photoId>.jpg`. `photoId = crypto.randomUUID()` on the **server** | Generating the id on the client | `randomUUID` does not exist over LAN HTTP |
| Cap 12, race-safe | One transaction: `SELECT … FROM orden_servicio WHERE id=$1 FOR UPDATE` → status gate → `count(*)` and `coalesce(max(position)+1,0)` → if `count ≥ 12`, `PhotoLimitError` → insert | `pg_advisory_xact_lock(hashtext(id))`, CHECK, trigger | The row lock serializes concurrent uploads per order, and `transitionOrder`'s `UPDATE` waits on the same lock, so an order cannot close between the gate and the insert. An advisory lock serializes only the uploads, needs a hash, and does not block the transition. A CHECK cannot count rows |
| Upload order | Inside that transaction: insert the row, then `putObject`. If the put throws, the transaction rolls back and no row is left. If the commit fails after the put, `catch` → `deleteObject(key).catch(()=>{})` and rethrow | Put first, then insert | Putting first leaves an orphan for every cap or status refusal. This way the only orphan is a failed commit. Cost: the order row stays locked for one ~600 KB PUT |
| Delete order | Transaction: lock the order, run the gate, `DELETE … RETURNING r2_key`. After the commit, `deleteObject(...).catch(()=>{})` | Deleting the R2 object first | An orphan object is invisible. A row whose object is missing is a broken image. `ponytail:` no orphan sweeper; add one if the bucket ever matters |
| Status gate | `canChangeOrderPhotos(status)` in `edit-policy.ts` over an exhaustive `Record<OrderStatus, boolean>` (`open`/`in_progress` true). It takes no role | Reusing `canEditOrderFields` | A técnico must photograph `open` orders, which D11 forbids for field edits |
| Admin delete | New action `service-orders.deletePhoto` (admin true, tecnico false) in `policy.ts` | An inline `role === "administrador"` check | Follows the `customers.deleteVehicle` precedent. It is visible in `ROUTE_GUARDS`, and the detail page uses the same `can()` |
| Byte check | `isJpeg(buf)` = `FF D8 FF`, size ≤ 3 MB (`MAX_PHOTO_BYTES`). Content-Length is pre-checked against cap + 64 KB of multipart slack | `validateCover` | The spec allows JPEG only; `validateCover` accepts PNG/WebP |
| Serving | Copy the cover route's headers. `Content-Type: image/jpeg`, `ETag: photoId`, `Cache-Control: private, max-age=86400, immutable`. Look up by `(photoId, ordenId)` | `max-age=60` | The bytes behind an id never change, and the print page re-requests up to 12 images |
| Compression | `compress-photo.ts`: decode with `createImageBitmap(file, {imageOrientation:"from-image"})`, falling back to `HTMLImageElement` + `URL.createObjectURL` + `img.decode()`. A pure `fitWithin(w,h,1600)` sizes the canvas, then `toBlob("image/jpeg",0.8)` (`null` → throw) | `sharp`, a library | Not installed. None of these APIs needs a secure context |
| Uploader | `OrderPhotos.tsx` takes props `{orderId, photos:{id}[], canAdd, canDelete}`, all booleans resolved on the server. A `<label>` styled with `buttonVariants` + `min-h-11 min-w-11` opens the hidden `<input type=file accept="image/*" multiple>`. Files upload **sequentially**, with "Subiendo 2 de 5…" in `aria-live`. Each failed file gets its own error toast. At the end: success toast with the APPLIED count ("1 foto agregada" / "3 fotos agregadas"), then `router.refresh()`, both below the try/catch. Delete opens a confirm dialog → "Foto eliminada" | `capture="environment"` | `capture` forces the camera and blocks picking several photos from the gallery. Without it the phone offers both |
| Navigate after create | `ServiceOrderFormTrigger.onSaved(saved)`: toast, then on create `router.push(\`/service-orders/${saved.id}\`)`, on edit `router.refresh()` | Changing the form | `ServiceOrderForm` already passes `body.orden` (201) to `onSaved`. Failures never call it |
| Motor-aware | Client-safe `intake.ts`: `FUEL_LABEL` (Vacío,1/4,1/2,3/4,Lleno), `intakeInputsFor(motor) → {fuel,battery}`, `parseIntake(body)` (integer + range, Spanish errors per key). Create: the motor of the selected vehicle in `vehicles`. Edit: new prop `motor` on Form and Trigger, which the detail page passes as `vehiculo?.motor ?? null`. Only VISIBLE fields are sent. Edit sends `null` for a blank one; a hidden one is omitted, so it is preserved | Clearing hidden fields | Omitting a field can never wipe it |
| Print | Rows for Cédula/RUC (after Teléfono) and Kilometraje; fuel and battery when set. QR: `<div aria-hidden className="hidden print:block size-[25mm]"/>` inside the right header div, in flow (it adds ~30px). Photos: `photos` chunked into groups of 4, each `<div class="break-before-page grid grid-cols-2 gap-4">` holding `img h-[120mm] object-contain loading="eager"` | One CSS grid | Explicit chunks guarantee 4 per sheet; Chrome fragments a grid unpredictably |
| Print waits | `PrintButton` click: `await Promise.all([...document.images].map(i => i.complete ? 0 : i.decode().catch(()=>{})))`, then `window.print()`. Photos also render on screen, so Ctrl+P finds them loaded | `onload` counters | Still zero props, no effect, no hydration risk |

## Data Flow

    Form ─POST─> route(parseIntake) ─> createOrder ─201 {orden}─> Trigger: toast → router.push(/service-orders/id)
    OrderPhotos ─compressPhoto─> FormData ─POST /api/service-orders/[id]/photos─> isJpeg/size
       ─> tx{ FOR UPDATE order → canChangeOrderPhotos → count<12 → insert → putObject } ─201
    <img src=/api/service-orders/[id]/photos/[photoId]> ─GET─> row(photoId,ordenId) ─> getObject

## Routes (`ROUTE_GUARDS`)

| Key | Entry |
|---|---|
| `/api/service-orders/[id]/photos` | `POST: "service-orders.write"` → 201, 400 (not JPEG), 413, 404, 409 `{error:"photo_limit"\|"order_closed"}` |
| `/api/service-orders/[id]/photos/[photoId]` | `GET: "service-orders.read"`, `DELETE: "service-orders.deletePhoto"` (409 closed, 404) |

## File Changes (chained PRs, each ≤400 including tests)

| PR | Files | Est. |
|---|---|---|
| 1 | `schema.ts`, 0023, `customers/{validation,service}.ts`, `CustomerForm.tsx`, customer detail display, e2e | ~250 |
| 2 | 0024, `service-orders/intake.ts`, both order routes, `service.ts` types/values, `ServiceOrderForm.tsx`, `ServiceOrderFormTrigger.tsx`, `[id]/page.tsx` rows, e2e | ~380 |
| 3 | 0025, `r2.ts` (2 options), `service-orders/photos.ts`, `edit-policy.ts`, `policy.ts`(+test), 2 route files, `route-guards.test.ts`, e2e | ~400 |
| 4 | `compress-photo.ts`, `OrderPhotos.tsx`, `[id]/page.tsx` card | ~300 |
| 5 | `print/page.tsx`, `PrintButton.tsx` | ~250 |

## Testing Strategy

| Layer | What |
|---|---|
| Unit | `normalizeDocumento` (30/31 chars, trim). `parseIntake` (-1, 1.5, "abc", 5, 101). `intakeInputsFor` × 4. `canChangeOrderPhotos` × 4. `isJpeg` (PNG, text labelled jpeg). `fitWithin`. Route handlers with injected deps: 403/409/413/404 |
| Component | The form shows inputs by motor; the trigger pushes `/service-orders/<id>` and does not navigate on failure; `OrderPhotos` uploads sequentially, toasts per file, shows the applied count, hides delete for técnico; detail shows "Sin kilometraje"; print renders `ceil(n/4)` photo chunks, none for 0, and a QR slot with no text |
| E2E (real SQL, R2 put injected) | 0024/0025 CHECKs reject 5/101/-1; intake round-trips; **13 concurrent `addOrderPhoto` → exactly 12 rows, one `PhotoLimitError`** (mutation: drop `.for("update")` → red); positions ascend after a delete; a throwing put leaves 0 rows; add on a `done` order is refused; the document stays untouched by the import update |
| Browser (LAN IP, phone) | Camera + compression; photos load; print preview: photo-less = 1 page, 9 photos = 4 pages, signature on page 1; one real R2 PUT/GET plus an existing catalog PDF download after the `r2.ts` change |

## Threat Matrix

N/A: no shell, subprocess, VCS automation or executable classification. Upload trust is covered above (byte sniff, size cap, server id, sandbox CSP, auth proxy).

## Migration / Rollout

Additive. Revert in reverse order. Objects under `service-orders/` can be deleted by prefix.

## Open Questions

- [ ] Owner mockup approval (form, photo card, print) before apply.
- [ ] Dropping `capture` (gallery and camera both offered): confirm on the owner's phone.
