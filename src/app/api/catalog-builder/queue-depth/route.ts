import { NextResponse, type NextRequest } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { requireSession } from "@/modules/auth/session";
import { PDF_GENERATE_JOB, MAX_QUEUE_DEPTH } from "@/modules/pdf-generation/enqueue";

export async function GET(request: NextRequest) {
  requireSession(request);

  const result = await db.execute(
    sql`SELECT count(*)::int AS count FROM pgboss.job WHERE name = ${PDF_GENERATE_JOB} AND state IN ('created','retry','active')`,
  );

  const depth = Number(result.rows[0]?.count ?? 0);

  return NextResponse.json({ depth, maxDepth: MAX_QUEUE_DEPTH });
}
