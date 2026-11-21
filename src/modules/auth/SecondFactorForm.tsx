"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FIELD_ERROR } from "@/shared/ui/styles";

type Mode = "totp" | "recovery";
type Failure =
  | { kind: "invalid" }
  | { kind: "locked"; minutes: number | null }
  | { kind: "expired" }
  | { kind: "unavailable" }
  | { kind: "network" };

const INPUT = "h-11 rounded-xl bg-background/70 px-3 shadow-inner placeholder:text-muted-foreground";
const LINK = "h-auto min-h-11 whitespace-normal px-2 text-sm";

/** Same wording as the password step's lock in `actions.ts`. */
function lockDetail(minutes: number | null): string {
  if (minutes === null) return "Por seguridad, el acceso quedó bloqueado. Pedí al administrador que te desbloquee.";
  return `Por seguridad, el acceso quedó bloqueado. Intentá de nuevo en ${minutes} ${minutes === 1 ? "minuto" : "minutos"} o pedí al administrador que te desbloquee.`;
}

async function failureOf(response: Response): Promise<Failure> {
  if (response.status === 429) {
    const seconds = Number(response.headers.get("Retry-After"));
    return { kind: "locked", minutes: seconds > 0 ? Math.ceil(seconds / 60) : null };
  }
  const body = await response.json().catch(() => null);
  if (body?.error === "invalid_code") return { kind: "invalid" };
  if (body?.error === "unavailable") return { kind: "unavailable" };
  // `no_pending_session` from the route, or the proxy's own 401 once the session expired.
  if (response.status === 401) return { kind: "expired" };
  return { kind: "network" };
}

/** The second step of a 2FA login (S12): one code field, or a recovery code. */
export function SecondFactorForm() {
  const [mode, setMode] = useState<Mode>("totp");
  const [value, setValue] = useState("");
  const [trust, setTrust] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  function switchTo(next: Mode) {
    setMode(next);
    setValue("");
    setFailure(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      const response = await fetch("/api/two-factor/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(mode === "totp" ? { code: value } : { recoveryCode: value }),
          ...(trust ? { trustDevice: true } : {}),
        }),
      });
      if (response.ok) {
        const body = await response.json();
        window.location.assign(body.redirect);
        return;
      }
      setFailure(await failureOf(response));
    } catch {
      setFailure({ kind: "network" });
    }
    setBusy(false);
  }

  async function backToLogin() {
    await fetch("/api/logout", { method: "POST" }).catch(() => null);
    window.location.assign("/login");
  }

  const totp = mode === "totp";

  return (
    <div className="flex w-full flex-col gap-4">
      <form onSubmit={submit} className="flex w-full flex-col gap-4">
        <div className="grid gap-2">
          <Label htmlFor="second-factor-code" className="text-[13px] font-semibold text-foreground">
            {totp ? "Código de verificación" : "Código de recuperación"}
          </Label>
          {totp ? (
            <>
              <p id="second-factor-hint" className="text-sm text-muted-foreground">
                Abrí tu app de autenticación y escribí el código de 6 dígitos.
              </p>
              <Input
                key="totp"
                id="second-factor-code"
                name="code"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                placeholder="000000"
                aria-describedby="second-factor-hint"
                required
                autoFocus
                className={`${INPUT} text-center text-lg tracking-[0.4em]`}
              />
            </>
          ) : (
            <Input
              key="recovery"
              id="second-factor-code"
              name="recoveryCode"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="XXXX-XXXX"
              required
              autoFocus
              className={`${INPUT} text-center text-lg tracking-widest`}
            />
          )}
        </div>
        <label className="flex min-h-11 items-center gap-3 text-sm text-foreground">
          <Checkbox checked={trust} onCheckedChange={(checked) => setTrust(checked === true)} />
          Confiar en este dispositivo por 30 días
        </label>
        {failure && <FailureMessage failure={failure} mode={mode} />}
        <Button
          type="submit"
          disabled={busy || !value}
          className="h-11 w-full rounded-xl bg-[var(--login-brand,var(--primary))] font-semibold text-[var(--login-brand-foreground,white)] shadow-[0_1px_2px_rgb(0_0_0_/_0.15),0_6px_16px_rgb(220_38_38_/_0.28)] hover:bg-[var(--login-brand-hover,var(--primary-hover))]"
        >
          {busy ? "Verificando…" : "Verificar"}
        </Button>
      </form>
      <div className="flex flex-col items-center">
        <Button type="button" variant="link" className={LINK} onClick={() => switchTo(totp ? "recovery" : "totp")}>
          {totp ? "¿Perdiste el teléfono? Usar un código de recuperación" : "Usar el código de la app"}
        </Button>
        <Button type="button" variant="link" className={`${LINK} text-muted-foreground`} onClick={backToLogin}>
          Volver al inicio de sesión
        </Button>
      </div>
    </div>
  );
}

function FailureMessage({ failure, mode }: { failure: Failure; mode: Mode }) {
  if (failure.kind === "locked") {
    return (
      <div role="alert" className="rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2.5 text-sm text-foreground">
        <p className="font-semibold">Demasiados intentos fallidos.</p>
        <p>{lockDetail(failure.minutes)}</p>
      </div>
    );
  }
  if (failure.kind === "expired") {
    return (
      <p role="alert" className={FIELD_ERROR}>
        La verificación venció.{" "}
        <a href="/login" className="link-accent">
          Volvé a iniciar sesión.
        </a>
      </p>
    );
  }
  const text = {
    invalid: mode === "totp" ? "Código incorrecto. Revisá la app e intentá de nuevo." : "Código de recuperación incorrecto.",
    unavailable: "La verificación en dos pasos no está disponible. Avisá al administrador.",
    network: "No se pudo verificar el código. Intentá de nuevo.",
  }[failure.kind];
  return (
    <p role="alert" className={FIELD_ERROR}>
      {text}
    </p>
  );
}
