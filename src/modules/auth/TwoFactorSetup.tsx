"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RecoveryCodes } from "@/modules/account/RecoveryCodes";
import { FIELD_ERROR } from "@/shared/ui/styles";
import { useToast } from "@/shared/ui/ToastProvider";

type View =
  | { kind: "starting" }
  | { kind: "unavailable" }
  | { kind: "failed"; message: string; retry: boolean }
  | { kind: "ready"; secret: string; qrDataUrl: string }
  | { kind: "codes"; codes: string[]; redirect: string };

const UNAVAILABLE = "La verificación en dos pasos no está disponible. Avisá al administrador.";
const INPUT = "h-11 rounded-xl bg-background/70 px-3 shadow-inner placeholder:text-muted-foreground";
const BRAND_BUTTON =
  "h-11 w-full rounded-xl bg-[var(--login-brand,var(--primary))] font-semibold text-[var(--login-brand-foreground,white)] shadow-[0_1px_2px_rgb(0_0_0_/_0.15),0_6px_16px_rgb(220_38_38_/_0.28)] hover:bg-[var(--login-brand-hover,var(--primary-hover))]";

function errorText(error: unknown): string {
  if (error === "invalid_code") return "Código incorrecto. Revisá la app e intentá de nuevo.";
  // The route's `no_pending_session`, or the proxy's own 401 once the 30 minutes ran out.
  if (error === "no_pending_session" || error === "Unauthorized") return "La configuración venció. Volvé a iniciar sesión.";
  if (error === "unavailable") return UNAVAILABLE;
  return "No se pudo completar. Intentá de nuevo.";
}

async function post(path: string, body?: object): Promise<{ ok: boolean; json: Record<string, unknown> }> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { ok: res.ok, json: await res.json().catch(() => ({})) };
  } catch {
    return { ok: false, json: {} };
  }
}

/**
 * The mandatory 2FA setup (T8b, mockup `s3`): an `administrador` or
 * `jefe_taller` without 2FA reaches nothing else until this is done (S2).
 */
export function TwoFactorSetup({ roleLabel, available }: { roleLabel: string; available: boolean }) {
  const [view, setView] = useState<View>(available ? { kind: "starting" } : { kind: "unavailable" });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  const { addToast } = useToast();

  async function start() {
    setView({ kind: "starting" });
    const result = await post("/api/two-factor/setup/start");
    if (result.ok) {
      setView({ kind: "ready", secret: String(result.json.secret), qrDataUrl: String(result.json.qrDataUrl) });
    } else if (result.json.error === "unavailable") {
      // A missing key cannot fix itself, so this view offers no retry.
      setView({ kind: "unavailable" });
    } else {
      const message = errorText(result.json.error);
      // An expired setup needs a new login, not another start.
      setView({ kind: "failed", message, retry: message === errorText(undefined) });
    }
  }

  // Once per mount, even under Strict Mode's double effect: each start replaces
  // the secret, so a second one would leave the QR on screen out of date.
  useEffect(() => {
    if (!available || started.current) return;
    started.current = true;
    void start();
  }, [available]);

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await post("/api/two-factor/setup/confirm", { code });
    setBusy(false);
    if (!result.ok) {
      setError(errorText(result.json.error));
      return;
    }
    // The page is left with a full navigation on "Ya los guardé", so no refresh here.
    addToast("success", "Verificación en dos pasos activada");
    setView({ kind: "codes", codes: result.json.codes as string[], redirect: String(result.json.redirect) });
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" }).catch(() => null);
    window.location.assign("/login");
  }

  const logoutButton = (
    <Button type="button" variant="link" className="h-auto min-h-11 px-2 text-sm text-muted-foreground" onClick={logout}>
      Cerrar sesión
    </Button>
  );

  if (view.kind === "codes") {
    return (
      <div className="flex w-full flex-col gap-4">
        <h1 className="text-center text-2xl font-bold tracking-tight text-foreground">Verificación en dos pasos</h1>
        <RecoveryCodes
          codes={view.codes}
          onDone={() => window.location.assign(view.redirect)}
          buttonClassName="h-11 min-w-11 rounded-xl"
        />
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Configurá la verificación en dos pasos</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Tu rol de <b className="text-foreground">{roleLabel}</b> la requiere. Te toma un minuto.
        </p>
      </div>

      {view.kind === "unavailable" && (
        <p role="alert" className={FIELD_ERROR}>
          {UNAVAILABLE}
        </p>
      )}
      {view.kind === "failed" && (
        <p role="alert" className={FIELD_ERROR}>
          {view.message}
        </p>
      )}

      {(view.kind === "starting" || view.kind === "ready") && (
        <>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Instalá una app de autenticación (Google Authenticator, Microsoft Authenticator o similar).</li>
            <li>Escaneá este código con la app.</li>
            <li>Escribí el código de 6 dígitos que te muestra.</li>
          </ol>
          {view.kind === "starting" ? (
            <div aria-hidden="true" className="size-48 self-center rounded-md bg-muted" />
          ) : (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- a data URL, nothing for next/image to optimize */}
              <img
                src={view.qrDataUrl}
                alt="Código QR para la app de autenticación"
                width={240}
                height={240}
                className="size-48 self-center rounded-md bg-white"
              />
              <div className="flex flex-col gap-1 text-center">
                <p className="text-sm text-muted-foreground">¿No podés escanear? Escribí esta clave en la app:</p>
                <p className="font-mono text-sm tracking-wider text-foreground">{view.secret}</p>
              </div>
              <form onSubmit={confirm} className="flex flex-col gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="two-factor-setup-code" className="text-[13px] font-semibold text-foreground">
                    Código de la app
                  </Label>
                  <Input
                    id="two-factor-setup-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="\d{6}"
                    maxLength={6}
                    placeholder="000000"
                    required
                    className={`${INPUT} text-center text-lg tracking-[0.4em]`}
                  />
                </div>
                {error && (
                  <p role="alert" className={FIELD_ERROR}>
                    {error}
                  </p>
                )}
                <Button type="submit" disabled={busy || !code} className={BRAND_BUTTON}>
                  Activar y continuar
                </Button>
              </form>
            </>
          )}
        </>
      )}

      <div className="flex justify-center gap-2">
        {view.kind === "failed" && view.retry && (
          <Button type="button" variant="outline" className="h-11 min-h-11 min-w-11 rounded-xl" onClick={() => void start()}>
            Reintentar
          </Button>
        )}
        {logoutButton}
      </div>
    </div>
  );
}
