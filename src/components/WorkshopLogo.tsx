"use client";

import { GalleryVerticalEnd } from "lucide-react";
import { useState } from "react";

export function WorkshopLogo({ logoR2Key }: { logoR2Key: string | null }) {
  const [error, setError] = useState(false);

  if (!logoR2Key || error) {
    return (
      <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <GalleryVerticalEnd className="size-4" />
      </div>
    );
  }

  return (
    <img
      src={`/api/workshop-config/logo?v=${logoR2Key}`}
      alt="Logo del taller"
      className="size-8 rounded-lg object-contain"
      onError={() => setError(true)}
    />
  );
}
