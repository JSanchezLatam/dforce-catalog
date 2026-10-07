"use client";

import { useEffect, useId, useRef } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FIELD_ERROR } from "@/shared/ui/styles";

/**
 * The administrator's re-authentication for a correction on a closed order
 * (closed-order-lock). Controlled and stateless on purpose: the owner keeps the
 * value only while its dialog is open and clears it on close, so a password is
 * never retained and is asked again on every save. `useId`, not
 * `crypto.randomUUID`: the LAN deployment is an insecure context.
 */
export function CorrectionPasswordField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const inputRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  // The field sits at the bottom of a long correction form: focus it and scroll
  // the error text into view instead of leaving only a red border below the fold.
  useEffect(() => {
    if (!error) return;
    inputRef.current?.focus({ preventScroll: true });
    // Optional call: jsdom has no scrollIntoView.
    errorRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [error]);
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>Tu contraseña</Label>
      <Input
        ref={inputRef}
        id={id}
        type="password"
        autoComplete="current-password"
        required
        className="min-h-11"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      {error && (
        <p ref={errorRef} id={errorId} role="alert" className={FIELD_ERROR}>
          {error}
        </p>
      )}
    </div>
  );
}
