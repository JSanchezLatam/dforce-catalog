"use client";

import { useEffect } from "react";

/** A TV must never stay dead: reload after 60 s. `reset()` is not used, it does not reliably refetch a server segment. */
export default function BoardError() {
  useEffect(() => {
    const id = setTimeout(() => window.location.reload(), 60_000);
    return () => clearTimeout(id);
  }, []);
  return <p className="text-3xl text-muted-foreground">Sin conexión, reintentando…</p>;
}
