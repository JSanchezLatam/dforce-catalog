/**
 * Field-length/count caps shared between `service.ts` (the trust boundary —
 * `route.ts` passes the raw body straight through) and `WorkshopConfigForm.tsx`
 * (the client-side UX hint via `maxLength`). Kept in their own file, with no
 * `@/shared/db` import, so a "use client" form can import these constants
 * without pulling drizzle/pg into the browser bundle — `service.ts` itself is
 * not safe to import from client code.
 */
export const MAX_NAME_LENGTH = 100;
export const MAX_CONTACT_FIELD_LENGTH = 200;
export const MAX_COVER_TEXT_LENGTH = 500;
export const MAX_HANDLE_LENGTH = 100;
export const MAX_HANDLE_ENTRIES = 20;
