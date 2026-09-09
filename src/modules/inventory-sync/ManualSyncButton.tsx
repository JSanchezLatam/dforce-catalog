"use client";

import { useEffect, useRef, useState } from "react";

import { StatusBadge } from "@/shared/ui/StatusBadge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/shared/ui/ToastProvider";

type SyncRunStatus = "running" | "completed" | "failed";

type SyncStatusResponse = {
  running: boolean;
  lastRun: { status: SyncRunStatus; productCount: number | null; finishedAt: string | null } | null;
};

function syncStatusLabel(status: SyncRunStatus): string {
  switch (status) {
    case "running":
      return "Sincronizando…";
    case "completed":
      return "Completada";
    case "failed":
      return "Fallida";
  }
}

/**
 * R2 — admin-only manual sync trigger, progress indicator, and completion
 * notification (CRITICAL fix: `requestManualSync()` existed since PR2/PR3 but
 * had no caller anywhere in `src/app/**`, per sdd-verify). Rendered only when
 * `can(user, "sync.manual")` is true (see app/inventory/page.tsx). Polling
 * only, same "Real-time" decision as the rest of this app (design.md).
 */
export function ManualSyncButton() {
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<SyncStatusResponse["lastRun"]>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { addToast } = useToast();

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  // Split from the fetch so the mount effect below can use a plain
  // `.then()` chain (same convention as CatalogBuilderForm's product-fetch
  // effect) instead of invoking an async function directly in the effect
  // body, which react-hooks/set-state-in-effect flags.
  function applyStatus(body: SyncStatusResponse) {
    setRunning(body.running);
    setLastRun(body.lastRun);
    if (!body.running) {
      stopPolling();
      if (body.lastRun?.status === "completed") {
        const when = body.lastRun.finishedAt ? new Date(body.lastRun.finishedAt).toLocaleString() : "una hora desconocida";
        addToast("success", `Sincronización completada: ${body.lastRun.productCount ?? 0} productos sincronizados a las ${when}.`);
      }
      if (body.lastRun?.status === "failed") {
        addToast("error", "La sincronización falló. Revisá los logs y volvé a intentar.");
      }
    }
  }

  async function pollStatus() {
    const res = await fetch("/api/inventory-sync/manual");
    if (res.ok) applyStatus(await res.json());
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/inventory-sync/manual") // reflects a sync another admin may already have started
      .then((res) => (res.ok ? res.json() : null))
      .then((body: SyncStatusResponse | null) => {
        if (!cancelled && body) applyStatus(body);
      });
    return () => {
      cancelled = true;
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleClick() {
    const res = await fetch("/api/inventory-sync/manual", { method: "POST" });

    if (res.status === 409) {
      const body = await res.json();
      addToast("info", body.error ?? "Ya hay una sincronización en curso.");
    } else if (!res.ok) {
      addToast("error", "No se pudo iniciar la sincronización. Volvé a intentar.");
      return;
    }

    setRunning(true); // R2.2/2.3 — show progress, disable the trigger.
    if (!pollRef.current) {
      pollRef.current = setInterval(pollStatus, 2000);
    }
  }

  return (
    <div className="mb-4 flex items-center gap-3">
      <Button type="button" onClick={handleClick} disabled={running}>
        {running ? "Sincronizando…" : "Sincronizar inventario"}
      </Button>
      {running ? (
        <StatusBadge status="running" label={syncStatusLabel("running")} />
      ) : (
        lastRun && <StatusBadge status={lastRun.status} label={syncStatusLabel(lastRun.status)} />
      )}
    </div>
  );
}
