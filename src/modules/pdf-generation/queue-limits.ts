// R12.1/12.5 — 1 active + 2 waiting = 3 total (design.md's pg-boss Job
// Definitions table). Its own module because enqueue.ts imports the database
// and pg-boss, and the builder's client component needs this number too.
export const MAX_QUEUE_DEPTH = 3;
