/**
 * The password floor, shared by the admin-create path (`service.ts`), the
 * self-service form and the forced-rotation form.
 *
 * It lives in its own leaf module rather than in `service.ts` because both
 * consumers are `"use client"` components: `service.ts` imports the Drizzle db
 * client, and importing it from a client component would pull the database
 * driver into the browser bundle.
 */
export const MIN_PASSWORD_LENGTH = 6;
