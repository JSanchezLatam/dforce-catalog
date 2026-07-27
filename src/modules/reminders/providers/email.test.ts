import { describe, expect, it, vi } from "vitest";

import type { ResendLike } from "./email";
import { sendEmail } from "./email";

describe("sendEmail — ADR-4 (Resend SDK, in-process)", () => {
  it("sends via the injected Resend-shaped client with from/to/subject/html", async () => {
    const send = vi.fn().mockResolvedValue({ data: { id: "email-1" }, error: null });
    const client: ResendLike = { emails: { send } };

    const result = await sendEmail(
      { to: "juan@example.com", subject: "Recordatorio", html: "<p>Hola</p>" },
      { apiKey: "re_test_key", from: "Taller <no-reply@taller.example>", client },
    );

    expect(send).toHaveBeenCalledWith({
      from: "Taller <no-reply@taller.example>",
      to: "juan@example.com",
      subject: "Recordatorio",
      html: "<p>Hola</p>",
    });
    expect(result).toEqual({ ok: true });
  });

  it("returns ok:false with the Resend error message when the SDK reports an error (no throw)", async () => {
    const send = vi.fn().mockResolvedValue({ data: null, error: { message: "invalid_from_address", statusCode: 422, name: "invalid_from_address" } });
    const client: ResendLike = { emails: { send } };

    const result = await sendEmail(
      { to: "juan@example.com", subject: "Recordatorio", html: "<p>Hola</p>" },
      { apiKey: "re_test_key", from: "bad", client },
    );

    expect(result).toEqual({ ok: false, reason: "invalid_from_address" });
  });

  it("no-ops gracefully (ok:false, does not throw, never constructs a client) when RESEND_API_KEY is absent", async () => {
    const client: ResendLike = { emails: { send: vi.fn() } };

    const result = await sendEmail(
      { to: "juan@example.com", subject: "Recordatorio", html: "<p>Hola</p>" },
      { apiKey: "", from: "Taller <no-reply@taller.example>", client },
    );

    expect(result).toEqual({ ok: false, reason: "RESEND_API_KEY/RESEND_FROM not configured" });
    expect(client.emails.send).not.toHaveBeenCalled();
  });

  it("no-ops gracefully when RESEND_FROM is absent even if RESEND_API_KEY is set", async () => {
    const client: ResendLike = { emails: { send: vi.fn() } };

    const result = await sendEmail(
      { to: "juan@example.com", subject: "Recordatorio", html: "<p>Hola</p>" },
      { apiKey: "re_test_key", from: "", client },
    );

    expect(result).toEqual({ ok: false, reason: "RESEND_API_KEY/RESEND_FROM not configured" });
    expect(client.emails.send).not.toHaveBeenCalled();
  });
});
