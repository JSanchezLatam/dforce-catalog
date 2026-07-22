/**
 * pdf-generation — queue-position adapter (Risk-3, R12.3/12.4).
 *
 * design.md's "New Risks Flagged" #3: deriving queue position couples to
 * pg-boss's own job-table ordering and is brittle if that schema changes.
 * This is the ONE file allowed to read `pgboss.job` for position purposes —
 * a future pg-boss upgrade only requires editing here.
 */
import { sql } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { PDF_GENERATE_JOB } from "./enqueue";

export type QueueJobState = "created" | "retry" | "active" | "completed" | "cancelled" | "failed";
export type QueueJobRef = { id: string; state: QueueJobState; createdOn: Date };

const OCCUPYING_STATES = new Set<QueueJobState>(["created", "retry", "active"]);

/**
 * Pure — R12.3/12.4's "position" is the count of jobs strictly ahead of
 * `targetJobId`, ordered the same way pg-boss's own worker-fetch query
 * orders candidates (active first, then created_on/id ascending — see
 * node_modules/pg-boss/dist/plans.js's `ORDER BY ... created_on, j.id`).
 *
 * Position 0 = active/about to start; 1 = first waiter; 2 = second waiter —
 * matches the spec scenario ("a 3rd user's request queues at position 2":
 * 1 active + 1 waiter ahead of them = 2 jobs ahead).
 */
export function deriveQueuePosition(jobs: QueueJobRef[], targetJobId: string): number | null {
  const ordered = jobs
    .filter((job) => OCCUPYING_STATES.has(job.state))
    .sort((a, b) => {
      if (a.state === "active" && b.state !== "active") return -1;
      if (b.state === "active" && a.state !== "active") return 1;
      const diff = a.createdOn.getTime() - b.createdOn.getTime();
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    });

  const index = ordered.findIndex((job) => job.id === targetJobId);
  return index === -1 ? null : index;
}

type DbLike = {
  execute: (query: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }>;
};

/** DB-touching wrapper — thin by design, see the Risk-3 note above. Not unit-tested against a real Postgres this phase (deferred, same gap as PR2/PR3's DB-integration coverage). */
export async function getQueuePosition(jobId: string, deps: { database?: DbLike } = {}): Promise<number | null> {
  const database = deps.database ?? db;
  const result = await database.execute(
    sql`SELECT id, state, created_on AS "createdOn" FROM pgboss.job WHERE name = ${PDF_GENERATE_JOB} AND state IN ('created','retry','active')`,
  );
  return deriveQueuePosition(result.rows as QueueJobRef[], jobId);
}
