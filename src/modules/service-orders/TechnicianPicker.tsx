"use client";

/**
 * Who works on a new order: a native checkbox list, zero or more. Native on
 * purpose (design D-UI): a full-row `<label>` is the 44px hit target, and no
 * base-ui popup is needed for a roster of a dozen. The caller passes ACTIVE
 * technicians only (`listTecnicos()`'s default); nothing is filtered here.
 */
export function TechnicianPicker({
  tecnicos,
  selected,
  onChange,
}: {
  tecnicos: { id: string; nombre: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  if (tecnicos.length === 0) return <p className="text-sm text-muted-foreground">No hay técnicos activos.</p>;

  return (
    <div role="group" aria-label="Técnicos" className="grid gap-1">
      {tecnicos.map((t) => (
        <label key={t.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-input px-3 text-sm">
          <input
            type="checkbox"
            className="size-5 shrink-0 accent-primary"
            checked={selected.includes(t.id)}
            onChange={(event) => onChange(event.target.checked ? [...selected, t.id] : selected.filter((id) => id !== t.id))}
          />
          {t.nombre}
        </label>
      ))}
    </div>
  );
}
