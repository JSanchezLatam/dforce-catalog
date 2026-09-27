// Uploads a verified pg_dump (and its run log) to R2 under backups/. Plain
// Node script (migrate.mjs/seed-user.mjs convention), called from
// standalone.ps1 with R2_* as env vars, never argv, and with Windows
// absolute paths (the real wire shape — see upload-backup.test.mjs). Only
// buildUploads is unit-tested — the S3Client half has no mock-free way to
// test it here (AGENTS.md's injected-seam limit); the real-bucket smoke
// test in tasks.md is its verification.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

// Pairs a dump with its run log under one backups/ key prefix. win32.basename
// splits on both \ and / on every platform — standalone.ps1 passes Windows
// absolute paths, and plain path.basename would only split on / elsewhere.
export function buildUploads(dumpPath, logPath) {
  const dumpBase = path.win32.basename(dumpPath);
  const uploads = [{ key: `backups/${dumpBase}`, path: dumpPath }];
  if (logPath) {
    const stem = dumpBase.replace(/\.dump$/, "");
    uploads.push({ key: `backups/${stem}.service.log`, path: logPath });
  }
  return uploads;
}

async function main() {
  const [dumpPath, logArg] = process.argv.slice(2);
  let logPath = logArg;
  if (!dumpPath) {
    console.error("Usage: node scripts/upload-backup.mjs <dump.dump> [service.log]");
    process.exit(1);
  }

  const { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
  if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
    console.error("Missing R2_ENDPOINT/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET");
    process.exit(1);
  }

  // requestChecksumCalculation/responseChecksumValidation: R2 rejects the
  // CRC32 checksum this SDK sends by default (>= 3.729).
  const client = new S3Client({
    region: "auto",
    endpoint: R2_ENDPOINT,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

  if (logPath) {
    try {
      await stat(logPath);
    } catch {
      console.warn(`No encontré ${logPath} — subo solo el dump.`);
      logPath = undefined;
    }
  }

  for (const upload of buildUploads(dumpPath, logPath)) {
    const { size: ContentLength } = await stat(upload.path);
    await client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: upload.key,
        Body: createReadStream(upload.path),
        ContentLength,
      }),
    );
    console.log(`Subido: ${upload.key}`);
  }
}

// fileURLToPath, not .pathname: a URL pathname stays percent-encoded, so a
// space in the checkout path never matches process.argv[1] (migrate.mjs lesson).
if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  main().catch((err) => {
    console.error("Upload failed:", err);
    process.exit(1);
  });
}
