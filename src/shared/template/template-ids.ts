/**
 * Registry ids only — zero JSX/component imports. Mirrors
 * `workshop-config/limits.ts`'s DB-free-import guarantee: a server-only
 * module (e.g. `template-config/service.ts`, which imports `@/shared/db/
 * client`) can validate a `selectedTemplateId` against this list without
 * importing `registry.ts`'s Card-bearing template entries — so a future
 * template's `Card` pulling in something heavier never risks that server
 * module's import graph, and (the actual present risk) a "use client" form
 * importing `registry.ts` for its gallery never risks pulling this module's
 * server-only neighbor in through a shared barrel.
 */
export const KNOWN_TEMPLATE_IDS = ["dforce-classic"] as const;
export const DEFAULT_TEMPLATE_ID: (typeof KNOWN_TEMPLATE_IDS)[number] = "dforce-classic";
