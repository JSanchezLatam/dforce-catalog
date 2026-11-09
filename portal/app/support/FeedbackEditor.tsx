"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { STATUS_LABELS, type Status } from "../../src/support/format";

/** Props are plain strings: this crosses the Server Component boundary, so no functions. */
export function FeedbackEditor({ id, status, note }: { id: string; status: string; note: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState(note);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async (patch: { status?: Status; note?: string }, message: string) => {
    setBusy(true);
    setError(false);
    setSaved("");
    try {
      const res = await fetch(`/api/support/feedback/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      // `refresh()` sits below, not inside: one that throws must not be reported as a failed save.
      setError(true);
      return;
    } finally {
      setBusy(false);
    }
    // ABOVE the refresh, BELOW the try/catch: a refresh that throws must not retract the only confirmation.
    setSaved(message);
    router.refresh();
  };

  return (
    <>
      <div className="psel">
        <span>Estado</span>
        <div className="pseg" role="group" aria-label="Estado">
          {(Object.keys(STATUS_LABELS) as Status[]).map((s) => (
            <button key={s} type="button" disabled={busy} aria-pressed={status === s} onClick={() => save({ status: s }, "Estado actualizado.")}>
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>
      <div className="psel">
        <label htmlFor="note">Nota interna</label>
        <textarea id="note" className="input" maxLength={2000} placeholder="Solo la ves vos. No llega al taller." value={draft} onChange={(e) => setDraft(e.target.value)} />
        <div className="saverow">
          <button type="button" className="btn ghost" disabled={busy} onClick={() => save({ note: draft }, "Nota guardada.")}>
            Guardar nota
          </button>
          <span className="saved" role="status">
            {saved}
          </span>
        </div>
        {error && (
          <p className="error" role="alert">
            No se pudo guardar. Probá de nuevo.
          </p>
        )}
      </div>
    </>
  );
}
