/**
 * catalog-storage — Cloudflare R2 adapter (S3-compatible; design.md's
 * "Technical Approach": "Cloudflare R2 (S3-compatible) holds PDFs"). The
 * ONLY file in this codebase that imports `@aws-sdk/client-s3` — a new
 * dependency, but the standard/expected way to talk to an S3-compatible
 * store (coding-style ladder rule 5), not something worth hand-rolling.
 *
 * Context7 unavailable this session (same finding as PR1-7) — endpoint
 * shape (`region: "auto"`, R2's own S3-compatible endpoint URL) and the
 * `NoSuchKey`/`Body.transformToByteArray()` API confirmed by reading
 * node_modules/@aws-sdk/client-s3/dist-types directly (index.d.ts's
 * re-exports, models/errors.d.ts's `NoSuchKey`, and
 * @smithy/types' `transformToByteArray`), not by guessing.
 */
import { DeleteObjectCommand, GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { env } from "@/shared/config/env";

const client = new S3Client({
  region: "auto", // required by the SDK, ignored by R2
  endpoint: env.R2_ENDPOINT,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID ?? "",
    secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? "",
  },
});

/** R11.1 — uploads the PDF buffer; returns a display-only URL (see env.ts's `R2_PUBLIC_URL` note — never used to serve downloads directly). */
export async function putObject(key: string, body: Buffer, contentType = "application/pdf"): Promise<string> {
  await client.send(
    new PutObjectCommand({ Bucket: env.R2_BUCKET, Key: key, Body: body, ContentType: contentType }),
  );
  return `${env.R2_PUBLIC_URL ?? ""}/${key}`;
}

/** R7.5 — returns `null` (not a throw) when the object no longer exists, so callers can offer "regenerate" instead of a 500. */
export async function getObject(key: string): Promise<Buffer | null> {
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
    const bytes = await result.Body?.transformToByteArray();
    return bytes ? Buffer.from(bytes) : null;
  } catch (err) {
    if (err instanceof NoSuchKey) return null;
    throw err;
  }
}

/** R11.3/11.4 — retention deletes the R2 object; the DB row is deleted separately (see retention.ts's partial-failure handling). */
export async function deleteObject(key: string): Promise<void> {
  await client.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
}
