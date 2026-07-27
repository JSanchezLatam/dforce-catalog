import { describe, expect, it, vi } from "vitest";

import type { WhatsAppClientLike } from "./whatsapp";
import { sendWhatsAppTemplate } from "./whatsapp";

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
