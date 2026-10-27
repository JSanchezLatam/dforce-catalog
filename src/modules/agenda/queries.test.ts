/**
 * DB-free. The value of these queries is a WHERE, a join and a bound; those are proved against a real
 * Postgres in `src/e2e/agenda-queries.e2e.test.ts`. What this file can pin is the surface (a scope is
 * mandatory) and the text of the two things that must never drift: the cancelled exclusion and the
 * absence of any zone logic in SQL.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, expectTypeOf, it } from "vitest";

import type { OrderScope } from "@/modules/service-orders/scope";

import { agendaInWorkshop, agendaOverdue, agendaRange, IN_WORKSHOP_STATUSES } from "./queries";

const source = fs.readFileSync(path.resolve(import.meta.dirname, "queries.ts"), "utf8");

describe("Range Query: scope required", () => {
  it("exports agendaRange and agendaOverdue as functions", () => {
    expect(agendaRange).toBeTypeOf("function");
    expect(agendaOverdue).toBeTypeOf("function");
  });

  it("takes the OrderScope as its first parameter and a cap that defaults (arity excludes it)", () => {
    // `length` stops at the first defaulted parameter: scope + range / scope + now.
    expect(agendaRange.length).toBe(2);
    expect(agendaOverdue.length).toBe(2);
    // Compile-time half (checked by `tsc --noEmit`): an optional scope would fail these.
    expectTypeOf(agendaRange).parameter(0).toEqualTypeOf<OrderScope>();
    expectTypeOf(agendaOverdue).parameter(0).toEqualTypeOf<OrderScope>();
  });
});

describe("Range Query: the SQL text", () => {
  it("excludes cancelled orders from the range", () => {
    expect(source).toMatch(/ne\(ordenServicio\.status,\s*"cancelled"\)/);
  });

  it("applies the caller's scope in the range, the in-workshop read and the predicate the overdue rows and count share", () => {
    expect(source.match(/scope\.where/g)).toHaveLength(3);
  });

  it("binds instants and never does zone logic in SQL or locale formatting", () => {
    expect(source).not.toMatch(/AT TIME ZONE/i);
    expect(source).not.toMatch(/toLocale/);
  });
});

describe("Combined: the in-workshop query lives in agenda/, never in board/", () => {
  it("agendaInWorkshop takes the OrderScope first, with a defaulted cap", () => {
    expect(agendaInWorkshop.length).toBe(1);
    expectTypeOf(agendaInWorkshop).parameter(0).toEqualTypeOf<OrderScope>();
  });

  it("In-workshop set: the five working statuses, booked excluded, built from the shared constant", () => {
    expect([...IN_WORKSHOP_STATUSES]).toEqual(["open", "diagnosing", "in_progress", "on_hold", "ready_for_review"]);
    expect(source).toMatch(/BACKLOG_STATUSES/);
  });

  it("the board query file still never names cliente", () => {
    const board = fs.readFileSync(path.resolve(import.meta.dirname, "../board/queries.ts"), "utf8");
    expect(board).not.toMatch(/\bcliente\b/);
  });
});
