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
 * `to` is converted to E.164 HERE, by `toE164` below. It used to say
 * `normalizePhone` enforced that on write; it does not, and never did —
 * `customers/validation.ts`'s `normalizePhone` strips non-digits and keeps a
 * leading `+`, nothing more. R17 accepts "optional leading +, 7-15 digits", so
 * a Panama number typed the way staff type them (`6111-1111`) reached Kapso as
 * `61111111`.
 *
 * Converted at this boundary and not on write, deliberately: the owner chose
 * to store imported phones raw, and that decision governs STORAGE — which also
 * feeds the phone search, duplicate detection and migration `0016`. A wire
 * format is a provider's concern, and this is the provider.
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

/**
 * Panama's numbering plan, verified against it rather than assumed
 * (https://en.wikipedia.org/wiki/Telephone_numbers_in_Panama): mobiles are
 * EIGHT digits and always start with `6`; landlines are SEVEN; there are no
 * area codes. The census of this shop's 361 phones matches — 353 of 8, 7 of 11
 * (a mobile carrying `507`), 1 of 7 (a landline).
 */
const PANAMA_COUNTRY_CODE = "507";
const PANAMA_MOBILE_LENGTH = 8;
const PANAMA_MOBILE_PREFIX = "6";
const PANAMA_LANDLINE_LENGTH = 7;

/** R17's own bounds ("optional leading +, 7-15 digits"), reused rather than re-invented. */
const MIN_E164_DIGITS = 7;
const MAX_E164_DIGITS = 15;

/**
 * Stored phone → E.164, or a refusal naming the value.
 *
 * The only thing it ADDS is Panama's country code, and only to a number it can
 * identify as a Panama mobile. Everything else keeps the digits the operator
 * stored, with the `+` E.164 wants — the shape Meta already accepted before
 * this function existed, so nothing that used to be delivered stops being.
 *
 * One deliberate refusal beyond a malformed length: a Panama LANDLINE. It is a
 * valid number; it simply cannot receive a WhatsApp template, because WhatsApp
 * is a mobile service. Sending it costs an API call and a retry cycle to learn
 * what the length already says.
 */
export function toE164(raw: string): { ok: true; value: string } | { ok: false; reason: string } {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/[^0-9]/g, "");
  const refuse = (why: string) => ({ ok: false as const, reason: `cannot place "${raw}" in E.164 — ${why}` });

  if (digits.length === 0) return refuse("no digits");
  if (digits.length < MIN_E164_DIGITS || digits.length > MAX_E164_DIGITS) {
    return refuse(`${digits.length} digits is outside E.164's ${MIN_E164_DIGITS}-${MAX_E164_DIGITS}`);
  }

  // Derived BEFORE any `+` short-circuit. The same landline typed `269-1234`
  // and `+507 269-1234` has to get the same answer — an earlier draft checked
  // the plus first, so one of those two forms sailed past the guard.
  //
  // A bare 7- or 8-digit number is Panama's, because this shop is in Panama and
  // the plan has no area codes. A longer one only counts as Panama if it
  // actually carries `507`, so a foreign number is never mangled into one.
  const national =
    digits.startsWith(PANAMA_COUNTRY_CODE) &&
    (digits.length === PANAMA_COUNTRY_CODE.length + PANAMA_MOBILE_LENGTH ||
      digits.length === PANAMA_COUNTRY_CODE.length + PANAMA_LANDLINE_LENGTH)
      ? digits.slice(PANAMA_COUNTRY_CODE.length)
      : !trimmed.startsWith("+") &&
          (digits.length === PANAMA_MOBILE_LENGTH || digits.length === PANAMA_LANDLINE_LENGTH)
        ? digits
        : null;

  if (national !== null) {
    if (national.length === PANAMA_LANDLINE_LENGTH) {
      return refuse("Panama landline, and WhatsApp is a mobile service");
    }
    if (national.startsWith(PANAMA_MOBILE_PREFIX)) {
      return { ok: true, value: `+${PANAMA_COUNTRY_CODE}${national}` };
    }
  }

  // Either the operator already said which country, or this is not a shape
  // identifiable as Panama. Either way the digits go through with the `+`
  // E.164 wants — the shape Meta already accepted before this function
  // existed. Guessing a country code is the one thing it must never do.
  return { ok: true, value: `+${digits}` };
}

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

  // Before the client is constructed: a number this app cannot place must cost
  // no network call at all, and the reason has to name the value so the
  // operator can go correct that one row.
  const e164 = toE164(input.to);
  if (!e164.ok) return e164;

  const client =
    deps.client ??
    (new WhatsAppClient({
      baseUrl: "https://api.kapso.ai/meta/whatsapp",
      kapsoApiKey: apiKey,
    }) as unknown as WhatsAppClientLike);

  try {
    await client.messages.sendTemplate({
      phoneNumberId,
      to: e164.value,
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
