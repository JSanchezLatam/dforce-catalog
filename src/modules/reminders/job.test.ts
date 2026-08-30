import type { PgBoss } from "pg-boss";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { db } from "@/shared/db/client";
import type { Cliente, OrdenServicio, Reminder } from "@/shared/db/schema";
import {
  cancelReminder,
  cancelRemindersForOrder,
  REMINDER_DLQ,
  REMINDER_SEND_JOB,
  registerReminderWorker,
  runReminder,
  scheduleReminder,
} from "./job";
import { sendEmail } from "./providers/email";
import { sendWhatsAppTemplate } from "./providers/whatsapp";

// Phase 7 — job.ts's real default `sendViaChannel` dispatches to these two
// provider modules; mock them here (no real network calls) so these tests
// exercise ONLY the routing/content-building wiring in job.ts, not the
// providers themselves (covered by providers/email.test.ts and
// providers/whatsapp.test.ts).
vi.mock("./providers/email", () => ({ sendEmail: vi.fn() }));
vi.mock("./providers/whatsapp", () => ({ sendWhatsAppTemplate: vi.fn() }));

const NOW = new Date("2026-07-26T12:00:00.000Z");

function makeReminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: "reminder-1",
    ordenId: "orden-1",
    clienteId: "cliente-1",
    type: "appointment",
    channel: "whatsapp",
    status: "scheduled",
    scheduledFor: new Date("2026-07-27T10:00:00.000Z"),
    sentAt: null,
    jobId: null,
    error: null,
    createdAt: NOW,
    ...overrides,
  } as Reminder;
}

function makeOrden(overrides: Partial<OrdenServicio> = {}): OrdenServicio {
  return {
    id: "orden-1",
    clienteId: "cliente-1",
    status: "open",
    description: null,
    appointmentAt: new Date("2026-07-27T10:00:00.000Z"),
    completedAt: null,
    createdBy: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as OrdenServicio;
}

function makeCliente(overrides: Partial<Cliente> = {}): Cliente {
  return {
    id: "cliente-1",
    name: "Juan Perez",
    phone: "+5491122334455",
    email: "juan@example.com",
    whatsappOptOut: false,
    emailOptOut: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as Cliente;
}

/** Minimal fake `db` — supports the exact chain shapes job.ts calls (select/update/insert). */
function makeFakeDb(state: { reminder: Reminder; orden: OrdenServicio; cliente: Cliente }) {
  const updateCalls: Array<{ table: string; patch: Record<string, unknown> }> = [];

  const fakeDb = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => {
            // Distinguish which table by object identity isn't available here,
            // so job.ts's loadReminderContext calls select().from(reminder)/
            // .from(ordenServicio)/.from(cliente) in that literal order — the
            // fake tracks a per-call cursor via a WeakMap-free counter below.
            return selectQueue.shift() ?? [];
          },
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: async () => {
          updateCalls.push({ table: String(table), patch });
          Object.assign(state.reminder, patch);
          return [state.reminder];
        },
      }),
    }),
  };

  // select() call order in loadReminderContext: reminder row, then orden row, then cliente row.
  const selectQueue: unknown[][] = [[state.reminder], [state.orden], [state.cliente]];

  return { fakeDb, updateCalls, refillSelectQueue: () => selectQueue.splice(0, selectQueue.length, [state.reminder], [state.orden], [state.cliente]) };
}

describe("scheduleReminder", () => {
  it("calls sendAfter with a concrete Date and the retry/DLQ options, and persists the returned jobId", async () => {
    const sendAfter = vi.fn().mockResolvedValue("job-123");
    const createQueue = vi.fn().mockResolvedValue(undefined);
    const boss = { sendAfter, createQueue } as unknown as PgBoss;

    const row = makeReminder({ scheduledFor: new Date("2026-08-01T10:00:00.000Z") });
    const updateCalls: Array<Record<string, unknown>> = [];
    const fakeDb = {
      update: () => ({
        set: (patch: Record<string, unknown>) => ({
          where: async () => {
            updateCalls.push(patch);
          },
        }),
      }),
    };

    const jobId = await scheduleReminder(row, {
      getBoss: async () => boss,
      db: fakeDb as unknown as typeof db,
    });

    expect(createQueue).toHaveBeenCalledWith(REMINDER_DLQ);
    expect(createQueue).toHaveBeenCalledWith(REMINDER_SEND_JOB, expect.objectContaining({ deadLetter: REMINDER_DLQ }));
    expect(sendAfter).toHaveBeenCalledWith(
      REMINDER_SEND_JOB,
      { reminderId: row.id },
      expect.objectContaining({ retryLimit: 3, retryDelay: 60, retryBackoff: true, deadLetter: REMINDER_DLQ }),
      row.scheduledFor,
    );
    expect(jobId).toBe("job-123");
    expect(updateCalls).toEqual([{ jobId: "job-123" }]);
  });
});

describe("runReminder — ADR-8 idempotency against pg-boss retries", () => {
  it("does NOT call the provider dispatch a second time when the row is already sent", async () => {
    const state = {
      reminder: makeReminder({ status: "sent", sentAt: NOW }),
      orden: makeOrden(),
      cliente: makeCliente(),
    };
    const { fakeDb, refillSelectQueue } = makeFakeDb(state);
    const sendViaChannel = vi.fn().mockResolvedValue(undefined);

    refillSelectQueue();
    await runReminder("reminder-1", { db: fakeDb as unknown as typeof db, now: () => NOW, sendViaChannel });

    expect(sendViaChannel).not.toHaveBeenCalled();
  });

  it("does not re-dispatch on a second call after the first call already flipped status to sent", async () => {
    const state = {
      reminder: makeReminder({ status: "scheduled" }),
      orden: makeOrden(),
      cliente: makeCliente(),
    };
    const { fakeDb, refillSelectQueue } = makeFakeDb(state);
    const sendViaChannel = vi.fn().mockResolvedValue(undefined);

    refillSelectQueue();
    await runReminder("reminder-1", { db: fakeDb as unknown as typeof db, now: () => NOW, sendViaChannel });
    expect(sendViaChannel).toHaveBeenCalledTimes(1);
    expect(state.reminder.status).toBe("sent");

    // Simulate pg-boss retrying the same job after a partial failure.
    refillSelectQueue();
    await runReminder("reminder-1", { db: fakeDb as unknown as typeof db, now: () => NOW, sendViaChannel });

    expect(sendViaChannel).toHaveBeenCalledTimes(1);
  });
});

describe("runReminder — R23/R26 re-check at fire time", () => {
  it("skips (does not dispatch) when the order is cancelled", async () => {
    const state = {
      reminder: makeReminder({ status: "scheduled" }),
      orden: makeOrden({ status: "cancelled" }),
      cliente: makeCliente(),
    };
    const { fakeDb, refillSelectQueue } = makeFakeDb(state);
    const sendViaChannel = vi.fn();

    refillSelectQueue();
    await runReminder("reminder-1", { db: fakeDb as unknown as typeof db, now: () => NOW, sendViaChannel });

    expect(sendViaChannel).not.toHaveBeenCalled();
    expect(state.reminder.status).toBe("skipped");
  });

  it("skips when the appointment reminder's order no longer has a future appointmentAt (stale)", async () => {
    const state = {
      reminder: makeReminder({ status: "scheduled", type: "appointment" }),
      orden: makeOrden({ appointmentAt: new Date("2026-07-01T00:00:00.000Z") }), // in the past relative to NOW
      cliente: makeCliente(),
    };
    const { fakeDb, refillSelectQueue } = makeFakeDb(state);
    const sendViaChannel = vi.fn();

    refillSelectQueue();
    await runReminder("reminder-1", { db: fakeDb as unknown as typeof db, now: () => NOW, sendViaChannel });

    expect(sendViaChannel).not.toHaveBeenCalled();
    expect(state.reminder.status).toBe("skipped");
  });

  it("records opted_out (distinct from skipped) for a whatsapp reminder when the cliente has whatsappOptOut=true", async () => {
    const state = {
      reminder: makeReminder({ status: "scheduled", channel: "whatsapp" }),
      orden: makeOrden(),
      cliente: makeCliente({ whatsappOptOut: true }),
    };
    const { fakeDb, refillSelectQueue } = makeFakeDb(state);
    const sendViaChannel = vi.fn();

    refillSelectQueue();
    await runReminder("reminder-1", { db: fakeDb as unknown as typeof db, now: () => NOW, sendViaChannel });

    expect(sendViaChannel).not.toHaveBeenCalled();
    expect(state.reminder.status).toBe("opted_out");
  });

  it("records opted_out (distinct from skipped) for an email reminder when the cliente has emailOptOut=true, independent of whatsappOptOut", async () => {
    const state = {
      reminder: makeReminder({ status: "scheduled", channel: "email" }),
      orden: makeOrden(),
      cliente: makeCliente({ emailOptOut: true, whatsappOptOut: false }),
    };
    const { fakeDb, refillSelectQueue } = makeFakeDb(state);
    const sendViaChannel = vi.fn();

    refillSelectQueue();
    await runReminder("reminder-1", { db: fakeDb as unknown as typeof db, now: () => NOW, sendViaChannel });

    expect(sendViaChannel).not.toHaveBeenCalled();
    expect(state.reminder.status).toBe("opted_out");
  });

  it("dispatches and marks sent when nothing blocks delivery", async () => {
    const state = {
      reminder: makeReminder({ status: "scheduled" }),
      orden: makeOrden(),
      cliente: makeCliente(),
    };
    const { fakeDb, refillSelectQueue } = makeFakeDb(state);
    const sendViaChannel = vi.fn().mockResolvedValue(undefined);

    refillSelectQueue();
    await runReminder("reminder-1", { db: fakeDb as unknown as typeof db, now: () => NOW, sendViaChannel });

    expect(sendViaChannel).toHaveBeenCalledTimes(1);
    expect(state.reminder.status).toBe("sent");
    expect(state.reminder.sentAt).toEqual(NOW);
  });

  it("marks failed with the error detail and rethrows on a provider error (so pg-boss retries, R25)", async () => {
    const state = {
      reminder: makeReminder({ status: "scheduled" }),
      orden: makeOrden(),
      cliente: makeCliente(),
    };
    const { fakeDb, refillSelectQueue } = makeFakeDb(state);
    const sendViaChannel = vi.fn().mockRejectedValue(new Error("Kapso 500"));

    refillSelectQueue();
    await expect(
      runReminder("reminder-1", { db: fakeDb as unknown as typeof db, now: () => NOW, sendViaChannel }),
    ).rejects.toThrow("Kapso 500");

    expect(state.reminder.status).toBe("failed");
    expect(state.reminder.error).toContain("Kapso 500");
  });
});

describe("runReminder — Phase 7 real provider wiring (default sendViaChannel, no override injected)", () => {
  beforeEach(() => {
    vi.mocked(sendEmail).mockReset();
    vi.mocked(sendWhatsAppTemplate).mockReset();
  });

  it("dispatches an email-channel reminder to sendEmail using the cliente's email address", async () => {
    vi.mocked(sendEmail).mockResolvedValue({ ok: true });
    const state = {
      reminder: makeReminder({ status: "scheduled", channel: "email" }),
      orden: makeOrden(),
      cliente: makeCliente(),
    };
    const { fakeDb, refillSelectQueue } = makeFakeDb(state);

    refillSelectQueue();
    await runReminder("reminder-1", { db: fakeDb as unknown as typeof db, now: () => NOW });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: state.cliente.email, subject: expect.any(String), html: expect.any(String) }),
    );
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled();
    expect(state.reminder.status).toBe("sent");
  });

  it("dispatches a whatsapp-channel reminder to sendWhatsAppTemplate using the cliente's phone and the type-specific template name", async () => {
    vi.mocked(sendWhatsAppTemplate).mockReset().mockResolvedValue({ ok: true });
    const state = {
      reminder: makeReminder({ status: "scheduled", channel: "whatsapp", type: "appointment" }),
      orden: makeOrden(),
      cliente: makeCliente(),
    };
    const { fakeDb, refillSelectQueue } = makeFakeDb(state);

    refillSelectQueue();
    await runReminder("reminder-1", {
      db: fakeDb as unknown as typeof db,
      now: () => NOW,
      kapsoTemplates: { appointment: "appointment_reminder", service_due: "service_due_reminder" },
    });

    expect(sendWhatsAppTemplate).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ to: state.cliente.phone, templateName: "appointment_reminder" }),
    );
    expect(sendEmail).not.toHaveBeenCalled();
    expect(state.reminder.status).toBe("sent");
  });

  it("uses the service_due template name for a service_due-type whatsapp reminder", async () => {
    vi.mocked(sendWhatsAppTemplate).mockReset().mockResolvedValue({ ok: true });
    const state = {
      reminder: makeReminder({ status: "scheduled", channel: "whatsapp", type: "service_due" }),
      orden: makeOrden({ completedAt: NOW }),
      cliente: makeCliente(),
    };
    const { fakeDb, refillSelectQueue } = makeFakeDb(state);

    refillSelectQueue();
    await runReminder("reminder-1", {
      db: fakeDb as unknown as typeof db,
      now: () => NOW,
      kapsoTemplates: { appointment: "appointment_reminder", service_due: "service_due_reminder" },
    });

    expect(sendWhatsAppTemplate).toHaveBeenCalledWith(expect.objectContaining({ templateName: "service_due_reminder" }));
  });

  it("marks failed and rethrows (so pg-boss retries) when the email provider reports ok:false", async () => {
    vi.mocked(sendEmail).mockReset().mockResolvedValue({ ok: false, reason: "RESEND_API_KEY/RESEND_FROM not configured" });
    const state = {
      reminder: makeReminder({ status: "scheduled", channel: "email" }),
      orden: makeOrden(),
      cliente: makeCliente(),
    };
    const { fakeDb, refillSelectQueue } = makeFakeDb(state);

    refillSelectQueue();
    await expect(
      runReminder("reminder-1", { db: fakeDb as unknown as typeof db, now: () => NOW }),
    ).rejects.toThrow(/not configured/);

    expect(state.reminder.status).toBe("failed");
    expect(state.reminder.error).toContain("not configured");
  });

  it("marks failed and rethrows when the whatsapp provider reports ok:false", async () => {
    vi.mocked(sendWhatsAppTemplate).mockReset().mockResolvedValue({ ok: false, reason: "KAPSO_API_KEY/KAPSO_PHONE_NUMBER_ID not configured" });
    const state = {
      reminder: makeReminder({ status: "scheduled", channel: "whatsapp" }),
      orden: makeOrden(),
      cliente: makeCliente(),
    };
    const { fakeDb, refillSelectQueue } = makeFakeDb(state);

    refillSelectQueue();
    await expect(
      runReminder("reminder-1", {
        db: fakeDb as unknown as typeof db,
        now: () => NOW,
        kapsoTemplates: { appointment: "appointment_reminder", service_due: "service_due_reminder" },
      }),
    ).rejects.toThrow(/not configured/);

    expect(state.reminder.status).toBe("failed");
  });

  it("marks failed and rethrows when no Kapso template is configured for the reminder's type", async () => {
    const state = {
      reminder: makeReminder({ status: "scheduled", channel: "whatsapp", type: "appointment" }),
      orden: makeOrden(),
      cliente: makeCliente(),
    };
    const { fakeDb, refillSelectQueue } = makeFakeDb(state);

    refillSelectQueue();
    await expect(
      runReminder("reminder-1", { db: fakeDb as unknown as typeof db, now: () => NOW, kapsoTemplates: {} }),
    ).rejects.toThrow(/no Kapso template configured/);

    expect(state.reminder.status).toBe("failed");
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled();
  });
});

describe("cancelReminder", () => {
  it("flips the row to cancelled and removes the pending pg-boss job via the stored jobId", async () => {
    const deleteJob = vi.fn().mockResolvedValue(undefined);
    const boss = { deleteJob } as unknown as PgBoss;

    const row = makeReminder({ jobId: "job-123", status: "scheduled" });
    const updateCalls: Array<Record<string, unknown>> = [];
    const fakeDb = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [row] }) }) }),
      update: () => ({
        set: (patch: Record<string, unknown>) => ({
          where: async () => {
            updateCalls.push(patch);
          },
        }),
      }),
    };

    await cancelReminder("reminder-1", { db: fakeDb as unknown as typeof db, getBoss: async () => boss });

    expect(deleteJob).toHaveBeenCalledWith(REMINDER_SEND_JOB, "job-123");
    expect(updateCalls).toEqual([{ status: "cancelled" }]);
  });

  it("is a no-op when the reminder no longer exists", async () => {
    const deleteJob = vi.fn();
    const boss = { deleteJob } as unknown as PgBoss;
    const fakeDb = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    };

    await cancelReminder("missing", { db: fakeDb as unknown as typeof db, getBoss: async () => boss });

    expect(deleteJob).not.toHaveBeenCalled();
  });
});

describe("cancelRemindersForOrder", () => {
  it("cancels every scheduled reminder for the order, optionally filtered by type", async () => {
    const deleteJob = vi.fn().mockResolvedValue(undefined);
    const boss = { deleteJob } as unknown as PgBoss;

    const rows = [
      makeReminder({ id: "r1", type: "appointment", jobId: "job-1" }),
      makeReminder({ id: "r2", type: "appointment", jobId: "job-2" }),
    ];
    const updateCalls: string[] = [];
    const fakeDb = {
      select: () => ({ from: () => ({ where: async () => rows }) }),
      update: () => ({
        set: () => ({
          where: async () => {
            updateCalls.push("update");
          },
        }),
      }),
    };

    await cancelRemindersForOrder("orden-1", "appointment", {
      db: fakeDb as unknown as typeof db,
      getBoss: async () => boss,
    });

    expect(deleteJob).toHaveBeenCalledTimes(2);
    expect(updateCalls).toHaveLength(2);
  });
});

describe("registerReminderWorker", () => {
  it("mirrors registerInventorySyncWorker: ensures queues then registers a bounded-concurrency worker", async () => {
    const createQueue = vi.fn().mockResolvedValue(undefined);
    const work = vi.fn().mockResolvedValue(undefined);
    const boss = { createQueue, work } as unknown as PgBoss;

    await registerReminderWorker({ getBoss: async () => boss });

    expect(createQueue).toHaveBeenCalledWith(REMINDER_DLQ);
    expect(work).toHaveBeenCalledWith(REMINDER_SEND_JOB, { localConcurrency: 1 }, expect.any(Function));
  });
});
