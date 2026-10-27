import { cn } from "@/lib/utils";

export type TabKey = "todas" | "agendadas" | "vencidas";

const TABS: { key: TabKey; label: string }[] = [
  { key: "todas", label: "Todas" },
  { key: "agendadas", label: "Agendadas" },
  { key: "vencidas", label: "Vencidas" },
];

/** Client-state tabs: a button each, no link, so switching never touches the URL. */
export function AgendaTabs({ tab, agendadas, vencidas, onTab }: { tab: TabKey; agendadas: number; vencidas: number; onTab: (tab: TabKey) => void }) {
  const badge: Record<TabKey, number> = { todas: 0, agendadas, vencidas };
  return (
    <div role="tablist" aria-label="Citas" className="flex gap-2 border-b text-sm max-md:overflow-x-auto max-md:border-b-0">
      {TABS.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={key === tab}
          onClick={() => onTab(key)}
          className={cn("-mb-px flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 max-md:mb-0 max-md:rounded-full max-md:border", key === tab ? "border-foreground font-semibold max-md:bg-foreground max-md:text-background" : "border-transparent text-muted-foreground")}
        >
          {label}
          {badge[key] > 0 ? (
            <span className={cn("rounded-full px-1.5 text-[11px] font-semibold", key === "vencidas" ? "bg-destructive text-white" : "bg-muted text-foreground")}>{badge[key]}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
