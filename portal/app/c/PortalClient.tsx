"use client";

import { useEffect, useRef, useState } from "react";

import { TERMS_BANNER, TERMS_PARAGRAPHS, TERMS_VERSION } from "../../src/terms";
import { History, type Snapshot } from "./History";

type View =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "limited" }
  | { kind: "terms"; accepting: boolean; error: boolean }
  | { kind: "history"; snapshot: Snapshot }
  | { kind: "error"; retry: () => void };

const POST = (path: string, token: string) =>
  fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });

/** `await response.json()` is a claim: check the one shape the History reads. */
const asSnapshot = (body: unknown): Snapshot | null => {
  const s = (body as { snapshot?: Partial<Snapshot> } | null)?.snapshot;
  return s && Array.isArray(s.vehicles) && typeof s.generatedAt === "string" ? (s as Snapshot) : null;
};
const stateOf = (body: unknown) => (body as { state?: unknown } | null)?.state;

export function PortalClient() {
  const [view, setView] = useState<View>({ kind: "loading" });
  // The fragment is read ONCE and stripped, so it must outlive a StrictMode remount
  // (whose second effect run would find an empty hash). `undefined` = not read yet.
  const token = useRef<string | null | undefined>(undefined);

  const load = async () => {
    const t = token.current;
    if (!t) return setView({ kind: "invalid" });
    const fail = () => setView({ kind: "error", retry: () => void load() });
    setView({ kind: "loading" });
    try {
      const open = await POST("/api/c/open", t);
      if (open.status === 404) return setView({ kind: "invalid" });
      if (open.status === 429) return setView({ kind: "limited" });
      if (!open.ok) return fail();
      const state = stateOf(await open.json());
      if (state === "terms") return setView({ kind: "terms", accepting: false, error: false });
      if (state !== "accepted") return fail();

      const res = await POST("/api/c/snapshot", t);
      if (res.status === 404) return setView({ kind: "invalid" });
      if (res.status === 429) return setView({ kind: "limited" });
      const body = res.ok ? ((await res.json()) as unknown) : null;
      const snapshot = stateOf(body) === "accepted" ? asSnapshot(body) : null;
      if (snapshot) setView({ kind: "history", snapshot });
      else fail();
    } catch {
      fail();
    }
  };

  const accept = async () => {
    const t = token.current;
    if (!t) return;
    setView({ kind: "terms", accepting: true, error: false });
    try {
      const res = await POST("/api/c/accept", t);
      if (res.status === 404) return setView({ kind: "invalid" });
      if (res.status === 429) return setView({ kind: "limited" });
      const body = res.ok ? ((await res.json()) as unknown) : null;
      const snapshot = stateOf(body) === "accepted" ? asSnapshot(body) : null;
      if (snapshot) return setView({ kind: "history", snapshot });
    } catch {
      // falls through to the error below
    }
    setView({ kind: "terms", accepting: false, error: true });
  };

  useEffect(() => {
    if (token.current !== undefined) return;
    token.current = window.location.hash.slice(1) || null;
    // Before ANY request: the token must not outlive this line in the address bar.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once; `load` reads the token from a ref
  }, []);

  return (
    <div className="stage" key={view.kind}>
      {view.kind === "loading" && <p role="status" className="muted pulse">Cargando…</p>}
      {view.kind === "invalid" && <h1 className="title">Este enlace no es válido. Pedí uno nuevo en el taller.</h1>}
      {view.kind === "limited" && (
        <p role="alert" className="notice">Hiciste demasiados intentos seguidos. Esperá un minuto y volvé a probar.</p>
      )}
      {view.kind === "error" && (
        <>
          <p role="alert" className="notice">No pudimos cargar tu historial. Revisá tu conexión e intentá de nuevo.</p>
          <button type="button" className="btn" onClick={view.retry}>Reintentar</button>
        </>
      )}
      {view.kind === "terms" && (
        <>
          <h1 className="title">Antes de ver tu historial</h1>
          <p className="banner">{TERMS_BANNER}</p>
          {TERMS_PARAGRAPHS.map((p) => (
            <p key={p}>{p}</p>
          ))}
          <p className="muted small">Versión de los términos: {TERMS_VERSION}</p>
          {view.error && <p role="alert" className="notice">No pudimos registrar tu aceptación. Intentá de nuevo.</p>}
          <button type="button" className="btn" disabled={view.accepting} onClick={() => void accept()}>Acepto</button>
        </>
      )}
      {view.kind === "history" && <History snapshot={view.snapshot} />}
    </div>
  );
}
