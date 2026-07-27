/**
 * reminders/providers/whatsapp.ts — Kapso WhatsApp Cloud API SDK wrapper
 * (ADR-3). Sends reminders via an approved **template** message
 * (`client.messages.sendTemplate`), NEVER `sendText` — free-text requires an
 * active 24-hour customer-initiated session window, and reminders are
 * proactive/out-of-window by definition (see the `integrate-whatsapp` skill:
 * "For outbound notifications outside the window, use templates.").
 *
 * SDK shape confirmed directly against the installed
 * `@kapso/whatsapp-cloud-api@0.2.3` type declarations (`WhatsAppClient`,
 * `messages.sendTemplate({ phoneNumberId, to, template: { name, language:
 * { code }, components } })`) — matches the skill's documented example
 * exactly, no adaptation needed.
 *
 * Graceful degradation: this app must boot and the reminder worker must run
 * fine with zero Kapso credentials configured. If `KAPSO_API_KEY`/
 * `KAPSO_PHONE_NUMBER_ID` are missing, `sendWhatsAppTemplate` returns
 * `{ ok: false, reason }` instead of throwing — no client is constructed. A
 * real SDK failure (the SDK's `GraphApiError` extends `Error` and is thrown)
 * is caught here and likewise reported as `{ ok: false, reason }`, never
 * left as an unhandled rejection — callers (reminders/job.ts's dispatch
 * wiring) decide whether a `{ ok: false }` result should become a throw (so
 * pg-boss retries) or a terminal `failed`/`skipped` status.
 *
 * `to` is expected to already be E.164 (customers/validation.ts's
 * `normalizePhone` enforces this on write — not re-implemented here).
 */
import { WhatsAppClient } from "@kapso/whatsapp-cloud-api";

import { env } from "@/shared/config/env";

export type TemplateBodyParam = { parameterName: string; text: string };

export type SendWhatsAppTemplateInput = {
  to: string;
  templateName: string;
  /** BCP-47 template language code — defaults to "es" (this shop's operating language). */
  languageCode?: string;
  /** NAMED body params (ADR-3 — `parameter_format: "NAMED"` preferred over positional). */
  bodyParams?: TemplateBodyParam[];
};

export type SendWhatsAppTemplateResult = { ok: true } | { ok: false; reason: string };

/** Minimal shape this module actually calls on the Kapso SDK — DI seam for tests (no real network calls). */
export type WhatsAppClientLike = {
  messages: {
    sendTemplate: (input: {
      phoneNumberId: string;
      to: string;
      template: {
        name: string;
        language: { code: string };
        components?: Array<{
          type: "body";
          parameters: Array<{ type: "text"; parameterName: string; text: string }>;
        }>;
      };
    }) => Promise<unknown>;
  };
};

export type SendWhatsAppTemplateDeps = {
  /** Override for `env.KAPSO_API_KEY` — pass `""` in tests to force the not-configured path deterministically, regardless of the ambient shell env. */
  apiKey?: string;
  /** Override for `env.KAPSO_PHONE_NUMBER_ID`. */
  phoneNumberId?: string;
  /** Override the real Kapso client (tests inject a fake — no real network calls). */
  client?: WhatsAppClientLike;
};

/** ADR-3 — sends one reminder via an approved WhatsApp template. Never throws; always resolves to a result. */
export async function sendWhatsAppTemplate(
  input: SendWhatsAppTemplateInput,
  deps: SendWhatsAppTemplateDeps = {},
): Promise<SendWhatsAppTemplateResult> {
  const apiKey = deps.apiKey ?? env.KAPSO_API_KEY;
  const phoneNumberId = deps.phoneNumberId ?? env.KAPSO_PHONE_NUMBER_ID;

  if (!apiKey || !phoneNumberId) {
    return { ok: false, reason: "KAPSO_API_KEY/KAPSO_PHONE_NUMBER_ID not configured" };
  }

  const client =
    deps.client ??
    (new WhatsAppClient({
      baseUrl: "https://api.kapso.ai/meta/whatsapp",
      kapsoApiKey: apiKey,
    }) as unknown as WhatsAppClientLike);

  try {
    await client.messages.sendTemplate({
      phoneNumberId,
      to: input.to,
      template: {
        name: input.templateName,
        language: { code: input.languageCode ?? "es" },
        ...(input.bodyParams && input.bodyParams.length > 0
          ? {
              components: [
                {
                  type: "body" as const,
                  parameters: input.bodyParams.map((param) => ({
                    type: "text" as const,
                    parameterName: param.parameterName,
                    text: param.text,
                  })),
                },
              ],
            }
          : {}),
      },
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
