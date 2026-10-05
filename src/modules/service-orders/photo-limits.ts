/**
 * Client-safe: `photos.ts` imports the database and R2, so a `"use client"`
 * component that needs the cap must not import it from there.
 */
export const MAX_PHOTOS = 12;
