/**
 * Real-SQL proof for the per-template cover image service
 * (catalog-cover-templates WU3a). The unit tests inject the db seam, so the
 * PK upsert and `DELETE … RETURNING` never run there — they run here against a
 * real Postgres (`DATABASE_URL`, see README "Running the E2E test").
 *
 * Rows use `e2e-cover-*` template ids: there is no FK, and no registry id can
 * collide with them, so cleanup by id never touches a real row.
 */
import { execSync } from "node:child_process";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  deleteTemplateCoverImage,
  listTemplateCoverImages,
  upsertTemplateCoverImage,
} from "@/modules/template-config/service";
import { db } from "@/shared/db/client";
import { templateCoverImage } from "@/shared/db/schema";

const A = "e2e-cover-a";
const B = "e2e-cover-b";

describe("template cover image service (E2E)", () => {
  beforeAll(() => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
  }, 60_000);

  afterAll(async () => {
    await db.delete(templateCoverImage).where(inArray(templateCoverImage.templateId, [A, B]));
    await db.$client.end();
  });

  const mine = async () =>
    (await listTemplateCoverImages()).filter((r) => r.templateId === A || r.templateId === B);

  it("first upsert inserts a row and reports no previous key", async () => {
    const previous = await upsertTemplateCoverImage(A, { r2Key: "covers/a/1.png", contentType: "image/png" });

    expect(previous).toBeNull();
    expect(await mine()).toEqual([
      expect.objectContaining({ templateId: A, r2Key: "covers/a/1.png", contentType: "image/png" }),
    ]);
  });

  it("a second upsert for the same id replaces the row, returns the old key, and leaves ONE row", async () => {
    const previous = await upsertTemplateCoverImage(A, { r2Key: "covers/a/2.jpg", contentType: "image/jpeg" });

    expect(previous).toBe("covers/a/1.png");
    const rows = await mine();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({ r2Key: "covers/a/2.jpg", contentType: "image/jpeg" }));
  });

  it("two template ids coexist, and each upsert only reports its own previous key", async () => {
    expect(await upsertTemplateCoverImage(B, { r2Key: "covers/b/1.webp", contentType: "image/webp" })).toBeNull();

    const rows = await mine();
    expect(rows.map((r) => [r.templateId, r.r2Key]).sort()).toEqual([
      [A, "covers/a/2.jpg"],
      [B, "covers/b/1.webp"],
    ]);
  });

  it("delete removes only that template's row and returns its key", async () => {
    expect(await deleteTemplateCoverImage(A)).toBe("covers/a/2.jpg");

    expect((await mine()).map((r) => r.templateId)).toEqual([B]);
  });

  it("deleting a template with no row returns null and removes nothing", async () => {
    expect(await deleteTemplateCoverImage(A)).toBeNull();

    expect((await mine()).map((r) => r.templateId)).toEqual([B]);
  });
});
