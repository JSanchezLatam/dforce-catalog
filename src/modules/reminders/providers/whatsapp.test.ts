import { describe, expect, it, vi } from "vitest";

import type { WhatsAppClientLike } from "./whatsapp";
import { sendWhatsAppTemplate, toE164 } from "./whatsapp";

describe("sendWhatsAppTemplate — ADR-3 (Kapso template send, not sendText)", () => {
  it("sends a template message via the injected Kapso-shaped client (phoneNumberId/to/template.name/template.language/components)", async () => {
    const sendTemplate = vi.fn().mockResolvedValue({ messages: [{ id: "wamid.1" }] });
    const client: WhatsAppClientLike = { messages: { sendTemplate } };

    const result = await sendWhatsAppTemplate(
      {
        to: "+5491122334455",
        templateName: "appointment_reminder",
        bodyParams: [{ parameterName: "customer_name", text: "Juan Perez" }],
      },
      { apiKey: "kapso_test_key", phoneNumberId: "phone-123", client },
    );

    expect(sendTemplate).toHaveBeenCalledWith({
      phoneNumberId: "phone-123",
      to: "+5491122334455",
      template: {
        name: "appointment_reminder",
        language: { code: "es" },
        components: [
          {
            type: "body",
            parameters: [{ type: "text", parameterName: "customer_name", text: "Juan Perez" }],
          },
        ],
      },
    });
    expect(result).toEqual({ ok: true });
  });

  it("returns ok:false with the SDK error message when the client throws (no unhandled rejection)", async () => {
    const sendTemplate = vi.fn().mockRejectedValue(new Error("Kapso 500"));
    const client: WhatsAppClientLike = { messages: { sendTemplate } };

    const result = await sendWhatsAppTemplate(
      { to: "+5491122334455", templateName: "appointment_reminder" },
      { apiKey: "kapso_test_key", phoneNumberId: "phone-123", client },
    );

    expect(result).toEqual({ ok: false, reason: "Kapso 500" });
  });

  it("no-ops gracefully (ok:false, does not throw, never constructs a client) when KAPSO_API_KEY is absent", async () => {
    const client: WhatsAppClientLike = { messages: { sendTemplate: vi.fn() } };

    const result = await sendWhatsAppTemplate(
      { to: "+5491122334455", templateName: "appointment_reminder" },
      { apiKey: "", phoneNumberId: "phone-123", client },
    );

    expect(result).toEqual({ ok: false, reason: "KAPSO_API_KEY/KAPSO_PHONE_NUMBER_ID not configured" });
    expect(client.messages.sendTemplate).not.toHaveBeenCalled();
  });

  it("no-ops gracefully when KAPSO_PHONE_NUMBER_ID is absent even if KAPSO_API_KEY is set", async () => {
    const client: WhatsAppClientLike = { messages: { sendTemplate: vi.fn() } };

    const result = await sendWhatsAppTemplate(
      { to: "+5491122334455", templateName: "appointment_reminder" },
      { apiKey: "kapso_test_key", phoneNumberId: "", client },
    );

    expect(result).toEqual({ ok: false, reason: "KAPSO_API_KEY/KAPSO_PHONE_NUMBER_ID not configured" });
    expect(client.messages.sendTemplate).not.toHaveBeenCalled();
  });
});

/**
 * Both this module's docstring and `reminders/job.ts:163` claimed `to` was
 * "already E.164 — `normalizePhone` enforces this on write". It does not:
 * `customers/validation.ts`'s `normalizePhone` strips non-digits and keeps a
 * leading `+`, nothing more. R17 accepts "optional leading +, 7-15 digits", so
 * a Panama number typed the normal way — `6111-1111` — is stored, and was
 * sent, as `61111111`.
 *
 * That predates the customer import. The import only makes it 353 at once.
 *
 * Converted HERE and not on write, deliberately: the owner chose to import
 * phones raw, and that decision is about STORAGE — which also feeds search,
 * duplicate detection and `0016`. The wire format is this provider's concern.
 */
describe("toE164 — the wire format is the provider's problem, not the operator's", () => {
  it("gives a bare Panama national number its country code", () => {
    expect(toE164("6111-1111")).toEqual({ ok: true, value: "+50761111111" });
  });

  it("leaves a number the operator already qualified alone", () => {
    expect(toE164("+52 55 1234 5678")).toEqual({ ok: true, value: "+525512345678" });
  });

  it("accepts a Panama number already carrying its country code without a plus", () => {
    expect(toE164("50761111111")).toEqual({ ok: true, value: "+50761111111" });
  });

  // Never invent a phone number: this repo's standing rule, and the reason
  // migration 0016 hard-fails rather than coercing.
  it("REFUSES a shape it cannot place, naming it, instead of guessing a country", () => {
    const result = toE164("611111");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("611111");
  });

  it("refuses an empty phone rather than sending a bare plus", () => {
    expect(toE164("   ").ok).toBe(false);
  });
});

describe("sendWhatsAppTemplate — what actually reaches Kapso", () => {
  it("sends the E.164 form, not the stored one", async () => {
    const sendTemplate = vi.fn().mockResolvedValue(undefined);
    const result = await sendWhatsAppTemplate(
      { to: "6111-1111", templateName: "recordatorio" },
      { apiKey: "k", phoneNumberId: "p", client: { messages: { sendTemplate } } },
    );

    expect(result).toEqual({ ok: true });
    expect(sendTemplate).toHaveBeenCalledWith(expect.objectContaining({ to: "+50761111111" }));
  });

  it("does not call Kapso at all with a number it cannot place", async () => {
    const sendTemplate = vi.fn();
    const result = await sendWhatsAppTemplate(
      { to: "611111", templateName: "recordatorio" },
      { apiKey: "k", phoneNumberId: "p", client: { messages: { sendTemplate } } },
    );

    expect(result.ok).toBe(false);
    expect(sendTemplate).not.toHaveBeenCalled();
  });
});
