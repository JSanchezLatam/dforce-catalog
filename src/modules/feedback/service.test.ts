import { describe, expect, it, vi } from "vitest";

import { createFeedback, FeedbackValidationError, listOwnFeedback, type FeedbackRow, type NewFeedback } from "./service";

const author = { userId: "u1", username: "jperez", role: "tecnico" as const };
const base = { ...author, category: "bug" as const, route: "/service-orders/abc", text: "No guarda" };

function seam() {
  const insert = vi.fn(async (_row: NewFeedback) => ({ id: "fb-1" }));
  return { insert };
}

describe("createFeedback", () => {
  it("stores the author and role it was given, plus the derived label", async () => {
    const deps = seam();
    await createFeedback(base, deps);
    expect(deps.insert).toHaveBeenCalledWith({
      userId: "u1",
      username: "jperez",
      role: "tecnico",
      category: "bug",
      text: "No guarda",
      route: "/service-orders/abc",
      screenLabel: "Orden de servicio — Detalle",
    });
  });

  it("returns the id the insert produced", async () => {
    expect(await createFeedback(base, seam())).toEqual({ id: "fb-1" });
  });

  it("trims the text before storing", async () => {
    const deps = seam();
    await createFeedback({ ...base, text: "  hola \n" }, deps);
    expect(deps.insert.mock.calls[0][0].text).toBe("hola");
  });

  it("stores the route without query or fragment, falling back to it as label", async () => {
    const deps = seam();
    await createFeedback({ ...base, route: "/nueva?x=1#y" }, deps);
    expect(deps.insert.mock.calls[0][0]).toMatchObject({ route: "/nueva", screenLabel: "/nueva" });
  });

  it("accepts exactly 2000 characters", async () => {
    const deps = seam();
    await createFeedback({ ...base, text: "a".repeat(2000) }, deps);
    expect(deps.insert).toHaveBeenCalledOnce();
  });

  it("rejects 2001 characters and writes nothing", async () => {
    const deps = seam();
    await expect(createFeedback({ ...base, text: "a".repeat(2001) }, deps)).rejects.toBeInstanceOf(FeedbackValidationError);
    expect(deps.insert).not.toHaveBeenCalled();
  });

  it("measures the limit on the trimmed value", async () => {
    const deps = seam();
    await createFeedback({ ...base, text: `  ${"a".repeat(2000)}  ` }, deps);
    expect(deps.insert).toHaveBeenCalledOnce();
  });

  it("rejects blank text and writes nothing", async () => {
    const deps = seam();
    await expect(createFeedback({ ...base, text: "  \n " }, deps)).rejects.toBeInstanceOf(FeedbackValidationError);
    expect(deps.insert).not.toHaveBeenCalled();
  });

  it("rejects an unknown category and writes nothing", async () => {
    const deps = seam();
    await expect(createFeedback({ ...base, category: "spam" as never }, deps)).rejects.toBeInstanceOf(FeedbackValidationError);
    expect(deps.insert).not.toHaveBeenCalled();
  });
});

describe("listOwnFeedback", () => {
  const row = (id: string, createdAt: string): FeedbackRow => ({
    id,
    userId: "u1",
    username: "jperez",
    role: "tecnico",
    category: "bug",
    text: id,
    route: "/kanban",
    screenLabel: "Órdenes en curso",
    createdAt: new Date(createdAt),
    deliveredAt: null,
    attempts: 0,
    nextAttemptAt: new Date(createdAt),
    lastError: null,
  });

  it("asks the seam for that user only", async () => {
    const select = vi.fn(async (_userId: string) => []);
    await listOwnFeedback("u1", { select });
    expect(select).toHaveBeenCalledWith("u1");
  });

  it("returns newest first", async () => {
    const select = async () => [row("old", "2026-01-01"), row("new", "2026-03-01"), row("mid", "2026-02-01")];
    expect((await listOwnFeedback("u1", { select })).map((r) => r.id)).toEqual(["new", "mid", "old"]);
  });
});
