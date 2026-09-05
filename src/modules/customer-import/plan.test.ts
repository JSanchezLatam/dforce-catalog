import { describe, expect, it } from "vitest";

import type { MappedCustomer, MappedRow, SkippedCustomer } from "./mapper";
import { planImport, type LocalCustomer } from "./plan";

function customer(overrides: Partial<MappedCustomer> = {}): MappedCustomer {
  return {
    kind: "customer",
    externalId: "1042",
    name: "Rosa Martínez",
    phone: "6123-4567",
    email: "rosa@example.com",
    ...overrides,
  };
}

function skip(overrides: Partial<SkippedCustomer> = {}): SkippedCustomer {
  return {
    kind: "skip",
    reason: "missing_phone",
    externalId: "1042",
    name: "Rosa Martínez",
    ...overrides,
  };
}

function local(overrides: Partial<LocalCustomer> = {}): LocalCustomer {
  return { id: "local-1", externalId: null, ...overrides };
}

describe("planImport — matches on externalId only (D3)", () => {
  it("plans two separate results for two rows sharing one phone but holding different external ids", () => {
    const rows: MappedRow[] = [
      customer({ externalId: "1042", phone: "6123-4567" }),
      customer({ externalId: "2099", phone: "6123-4567" }),
    ];

    const plan = planImport(rows, []);

    expect(plan).toHaveLength(2);
    expect(plan[0]).toMatchObject({ kind: "insert" });
    expect(plan[1]).toMatchObject({ kind: "insert" });
    expect((plan[0] as { externalId: string }).externalId).toBe("1042");
    expect((plan[1] as { externalId: string }).externalId).toBe("2099");
  });

  it("never matches a local customer whose externalId is null, even against the same phone", () => {
    const existing = [local({ id: "app-created-1", externalId: null })];
    const rows: MappedRow[] = [customer({ externalId: "1042" })];

    const plan = planImport(rows, existing);

    expect(plan).toEqual([
      {
        kind: "insert",
        externalId: "1042",
        data: { name: "Rosa Martínez", phone: "6123-4567", email: "rosa@example.com" },
      },
    ]);
  });

  it("matches a local customer by externalId for an UPDATE", () => {
    const existing = [local({ id: "app-created-1", externalId: "1042" })];
    const rows: MappedRow[] = [customer({ externalId: "1042" })];

    const plan = planImport(rows, existing);

    expect(plan).toEqual([
      {
        kind: "update",
        id: "app-created-1",
        externalId: "1042",
        patch: { name: "Rosa Martínez", phone: "6123-4567", email: "rosa@example.com" },
      },
    ]);
  });
});

describe("planImport — a skip stays a skip", () => {
  it("carries the skip through with its reason and identity, untouched", () => {
    const skipped = skip({ reason: "missing_phone", externalId: "1042", name: "Rosa Martínez" });
    const rows: MappedRow[] = [skipped];

    const plan = planImport(rows, []);

    expect(plan).toEqual([skipped]);
  });

  it("carries a skip through even when its identity is null (no external id, no name)", () => {
    const skipped = skip({ reason: "missing_external_id", externalId: null, name: null });
    const rows: MappedRow[] = [skipped];

    const plan = planImport(rows, [local({ externalId: null })]);

    expect(plan).toEqual([skipped]);
  });
});

describe("planImport — an UPDATE carries only fields Interfuerza owns", () => {
  it("emits a patch with EXACTLY name, phone and email — nothing this app owns", () => {
    const existing = [local({ id: "app-created-1", externalId: "1042" })];
    const rows: MappedRow[] = [
      customer({ externalId: "1042", name: "Rosa M.", phone: "6111-2222", email: "rosa@new.com" }),
    ];

    const plan = planImport(rows, existing);
    const planned = plan[0];

    expect(planned.kind).toBe("update");
    if (planned.kind !== "update") throw new Error("expected an update");

    // Exact key check, not `toMatchObject` — `toMatchObject` would pass even
    // if the patch also carried `whatsappOptOut`, `deactivatedAt`, or a
    // vehicle list. That extra field is exactly the bug this test exists to
    // catch: a re-import silently resurrecting a deactivated customer or
    // reversing a consent choice.
    expect(Object.keys(planned.patch).sort()).toEqual(["email", "name", "phone"]);
    expect(planned.patch).toEqual({ name: "Rosa M.", phone: "6111-2222", email: "rosa@new.com" });
  });

  it("never lets whatsappOptOut, emailOptOut, deactivatedAt or vehicles ride along on the plan object itself", () => {
    const existing = [local({ id: "app-created-1", externalId: "1042" })];
    const rows: MappedRow[] = [customer({ externalId: "1042" })];

    const plan = planImport(rows, existing);
    const planned = plan[0];

    const serialized = JSON.stringify(planned);
    expect(serialized).not.toContain("whatsappOptOut");
    expect(serialized).not.toContain("emailOptOut");
    expect(serialized).not.toContain("deactivatedAt");
    expect(serialized).not.toContain("vehicle");
  });
});

describe("planImport — insert vs update selection", () => {
  it("inserts a row whose external id is not present locally", () => {
    const rows: MappedRow[] = [customer({ externalId: "9999" })];

    const plan = planImport(rows, [local({ id: "someone-else", externalId: "1042" })]);

    expect(plan).toEqual([
      {
        kind: "insert",
        externalId: "9999",
        data: { name: "Rosa Martínez", phone: "6123-4567", email: "rosa@example.com" },
      },
    ]);
  });
});
