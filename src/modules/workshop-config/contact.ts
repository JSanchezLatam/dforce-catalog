import type { WorkshopContact } from "@/shared/template/CatalogTemplate";

/**
 * WU5 (design D6) — `generate/route.ts` (server) and `CatalogBuilderForm.tsx`
 * (client preview, Risk-5) both need the exact same `WorkshopConfig` row ->
 * `WorkshopContact` mapping, or the preview and the PDF could drift. Typed
 * structurally instead of importing `WorkshopConfig` from `@/shared/db/schema`
 * — this file must stay importable from a "use client" component (same
 * reasoning as `limits.ts`'s "no @/shared/db import" convention).
 */
type ContactSource = {
  name: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  hours: string | null;
  website: string | null;
  socialHandles: Record<string, string> | null;
};

/** `null` config (no workshop_config row at all) yields a `null` contact — CatalogTemplate then omits the whole contact page instead of an empty one. */
export function buildWorkshopContact(config: ContactSource | null): WorkshopContact | null {
  if (!config) return null;
  return {
    name: config.name ?? null,
    phone: config.phone ?? null,
    whatsapp: config.whatsapp ?? null,
    email: config.email ?? null,
    address: config.address ?? null,
    hours: config.hours ?? null,
    website: config.website ?? null,
    socialHandles: config.socialHandles ?? null,
  };
}
