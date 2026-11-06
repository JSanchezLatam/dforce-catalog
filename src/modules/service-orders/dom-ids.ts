/**
 * DOM ids shared between a server page and the client controls that own them.
 * A plain module on purpose: a constant exported from a `"use client"` file
 * reaches a Server Component as a client reference, not as its string value.
 */
export const ASSIGN_TECNICO_ID = "assign-tecnico";
/** The status-bar hint, so a disabled button can point `aria-describedby` at it. */
export const STATUS_HINT_ID = "status-hint";
