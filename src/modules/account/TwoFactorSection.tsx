"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CONNECTION_ERROR } from "@/shared/ui/messages";
import { StatusBadge } from "@/shared/ui/StatusBadge";
import { FIELD_ERROR } from "@/shared/ui/styles";
import { useToast } from "@/shared/ui/ToastProvider";

/** Data only across the Server Component boundary: the date arrives formatted, `mandatory` as a boolean. */
type Props = { enabled: boolean; enabledOn: string | null; codesLeft: number; mandatory: boolean };

type View = { kind: "status" } | { kind: "enrolling"; secret: string; qrDataUrl: string } | { kind: "codes"; codes: string[] };

const BASE = "/api/account/two-factor";

function errorText(error: unknown): string {
  if (error === "invalid_code") return "Código incorrecto. Revisá la app e intentá de nuevo.";
  if (error === "locked") return "Demasiados códigos incorrectos. Por seguridad, el acceso quedó bloqueado por un rato.";
  if (error === "unavailable") return "La verificación en dos pasos no está disponible. Avisá al administrador.";
  return "No se pudo completar. Recargá la página e intentá de nuevo.";
}

/** POSTs to one of the four routes; the parsed body, or the inline message to show. */
async function post(path: string, body?: object): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; message: string }> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { ok: false, message: CONNECTION_ERROR };
  }
  const json = await res.json().catch(() => ({}));
  return res.ok ? { ok: true, body: json } : { ok: false, message: errorText(json?.error) };
}

/** S12: one field, numeric keypad, and the phone's code autofill. */
function CodeField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>Código de la app</Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        placeholder="000000"
        required
        className="max-w-40 text-center tracking-[0.3em]"
      />
    </div>
  );
}

function InlineError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className={FIELD_ERROR}>
      {message}
    </p>
  );
}

/** Re-authentication before regenerate or disable (L29): a current app code, asked in a dialog. */
function CodeDialog(props: {
  trigger: string;
  title: string;
  text: string;
  submit: string;
  path: string;
  destructive?: boolean;
  onDone: (body: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await post(props.path, { code });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setOpen(false);
    setCode("");
    props.onDone(result.body);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setError(null);
          setCode("");
        }
      }}
    >
      <DialogTrigger render={<Button type="button" variant={props.destructive ? "destructive" : "outline"} />}>
        {props.trigger}
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{props.title}</DialogTitle>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <p>{props.text}</p>
            <CodeField id={`${props.path}-code`} value={code} onChange={setCode} />
            <InlineError message={error} />
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={busy} />}>Cancelar</DialogClose>
            <Button type="submit" variant={props.destructive ? "destructive" : "default"} disabled={busy || !code}>
              {props.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Blob plus `a[download]`: works over plain HTTP, unlike the clipboard (AGENTS.md). */
function downloadCodes(codes: string[]) {
  const text = `Códigos de recuperación. Cada uno sirve una sola vez.\n\n${codes.join("\n")}\n`;
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "codigos-de-recuperacion.txt";
  link.click();
  URL.revokeObjectURL(url);
}

/** Mi cuenta → "Verificación en dos pasos" (T8a), mockup screen `s4`. */
export function TwoFactorSection({ enabled, enabledOn, codesLeft, mandatory }: Props) {
  // Local state wins over the props: the codes are shown once and must survive the refresh behind them.
  const [view, setView] = useState<View>({ kind: "status" });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const { addToast } = useToast();

  async function start() {
    setBusy(true);
    setError(null);
    const result = await post("start");
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setCode("");
    setView({ kind: "enrolling", secret: String(result.body.secret), qrDataUrl: String(result.body.qrDataUrl) });
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await post("confirm", { code });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    showCodes(result.body, "Verificación en dos pasos activada");
  }

  // The toast ABOVE the refresh, both after the request settled (AGENTS.md).
  function showCodes(body: Record<string, unknown>, toast: string) {
    setView({ kind: "codes", codes: body.codes as string[] });
    addToast("success", toast);
    router.refresh();
  }

  function cancel() {
    setView({ kind: "status" });
    setError(null);
  }

  const on = enabled || view.kind === "codes";

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold text-foreground">Verificación en dos pasos</h2>
            {view.kind === "status" && !on && (
              <p className="text-sm text-muted-foreground">
                Agregá un código de tu teléfono al iniciar sesión. {mandatory ? "Tu rol la requiere." : "Es opcional para tu rol."}
              </p>
            )}
            {view.kind === "status" && on && (
              <p className="text-sm text-muted-foreground">
                Activada el {enabledOn}. Te quedan <b className="text-foreground">{codesLeft} de 10</b> códigos de recuperación.
              </p>
            )}
          </div>
          {/* The success chip, as Gestión de usuarios' "Activo": the red primary would read as an alarm. */}
          {on ? (
            <StatusBadge status="completed" label="Activada" className="shrink-0" />
          ) : (
            <Badge variant="outline" className="shrink-0">
              Desactivada
            </Badge>
          )}
        </div>

        {view.kind === "status" && !on && (
          <>
            <InlineError message={error} />
            <Button type="button" className="self-start" disabled={busy} onClick={start}>
              Activar
            </Button>
          </>
        )}

        {view.kind === "enrolling" && (
          <form onSubmit={confirm} className="flex flex-col gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- a data URL, nothing for next/image to optimize */}
            <img
              src={view.qrDataUrl}
              alt="Código QR para la app de autenticación"
              width={240}
              height={240}
              className="size-48 self-start rounded-md bg-white"
            />
            <div className="flex flex-col gap-1">
              <p className="text-sm text-muted-foreground">¿No podés escanear? Escribí esta clave en la app:</p>
              <p className="font-mono text-sm tracking-wider text-foreground">{view.secret}</p>
            </div>
            <CodeField id="two-factor-code" value={code} onChange={setCode} />
            <InlineError message={error} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy || !code}>
                Verificar y activar
              </Button>
              <Button type="button" variant="outline" disabled={busy} onClick={cancel}>
                Cancelar
              </Button>
            </div>
          </form>
        )}

        {view.kind === "codes" && (
          <>
            <Alert>
              <p>
                <b className="text-foreground">Guardá tus códigos de recuperación.</b> Cada uno sirve una sola vez, si perdés el
                teléfono. Es la única vez que los verás.
              </p>
            </Alert>
            <ul aria-label="Códigos de recuperación" className="grid grid-cols-2 gap-2 font-mono text-sm sm:max-w-md">
              {view.codes.map((c) => (
                <li key={c} className="rounded-md border bg-muted px-3 py-2 text-center text-foreground">
                  {c}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => window.print()}>
                Imprimir
              </Button>
              <Button type="button" variant="outline" onClick={() => downloadCodes(view.codes)}>
                Descargar .txt
              </Button>
              <Button type="button" onClick={cancel}>
                Ya los guardé
              </Button>
            </div>
          </>
        )}

        {view.kind === "status" && on && (
          <div className="flex flex-wrap gap-2">
            <CodeDialog
              trigger="Generar códigos nuevos"
              title="¿Generar códigos nuevos?"
              text="Los 10 códigos de recuperación actuales dejan de servir. Escribí el código de la app para seguir."
              submit="Generar"
              path="recovery-codes"
              onDone={(body) => showCodes(body, "Códigos de recuperación generados")}
            />
            {!mandatory && (
              <CodeDialog
                trigger="Desactivar"
                title="¿Desactivar la verificación en dos pasos?"
                text="Al iniciar sesión ya no se va a pedir el código, y se cierran tus sesiones en los demás dispositivos. Escribí el código de la app para seguir."
                submit="Sí, desactivar"
                path="disable"
                destructive
                onDone={() => {
                  addToast("success", "Verificación en dos pasos desactivada");
                  router.refresh();
                }}
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
