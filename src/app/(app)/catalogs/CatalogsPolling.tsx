"use client";

import { useEffect, useRef } from "react";

const NON_TERMINAL = new Set(["pending", "uploading", "running"]);

export function CatalogsPolling({
  children,
  hasActive,
}: {
  children: React.ReactNode;
  hasActive: boolean;
}) {
  const ref = useRef(hasActive);

  useEffect(() => {
    ref.current = hasActive;
  }, [hasActive]);

  useEffect(() => {
    if (!hasActive) return;

    const id = setInterval(() => {
      if (ref.current) {
        location.reload();
      }
    }, 5000);

    return () => clearInterval(id);
  }, [hasActive]);

  return <>{children}</>;
}
