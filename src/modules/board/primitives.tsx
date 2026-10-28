/**
 * board/primitives.tsx - presentational pieces shared by the kanban board and the read-only TV
 * boards. No state, no hooks, no client directive and no button or link, so a TV board that renders
 * them stays control-free (`WorkshopBoard.test.tsx` pins that). Status is always icon + text, red is
 * only the Urgente flag, amber is only `AlertStrip`. Visual contract: kanban-board `mockup/index.html`.
 */
import { CalendarDays, CircleCheck, Clock, Eye, Flame, Inbox, Lock, Pause, Search, TriangleAlert, UserPlus, Wrench, Tag } from "lucide-react";
import type { CSSProperties, ReactNode, Ref } from "react";
import type { LucideIcon } from "lucide-react";

import { categoriaLabel, type ServiceCategory } from "@/modules/service-orders/categories";
import type { OrderStatus } from "@/modules/service-orders/transitions";
import { cn } from "@/lib/utils";
import type { CardAlert } from "./alerts";

/** One hue per column (mockup `ST`). `h`/`s` feed `--h`/`--s` for the `.board-hue-*` classes in globals.css. */
export const STATUS_HUE: Record<Exclude<OrderStatus, "cancelled">, { h: number; s: string; icon: LucideIcon }> = {
  booked: { h: 188, s: "70%", icon: CalendarDays },
  open: { h: 221, s: "70%", icon: Inbox },
  diagnosing: { h: 262, s: "60%", icon: Search },
  in_progress: { h: 290, s: "50%", icon: Wrench },
  on_hold: { h: 220, s: "14%", icon: Pause },
  ready_for_review: { h: 168, s: "60%", icon: Eye },
  done: { h: 142, s: "55%", icon: CircleCheck },
};

const hueStyle = (h: number | string, s?: string) => ({ "--h": String(h), ...(s ? { "--s": s } : {}) }) as CSSProperties;

/** A status column: icon, title, count, and its cards as a list. Render `CardShell`s as children. */
export function ColumnShell({
  status,
  label,
  count,
  empty,
  className,
  rootRef,
  dropState,
  tv,
  more,
  children,
}: {
  status: Exclude<OrderStatus, "cancelled">;
  label: string;
  count: number;
  /** Shown only while `count` is 0. */
  empty?: string;
  className?: string;
  /** The kanban's drop target. */
  rootRef?: Ref<HTMLElement>;
  /** During a drag: `legal` lights the column in its own hue, `illegal` dims it and says why. */
  dropState?: "legal" | "illegal";
  /** Read-only TV scale: bigger type, tile and gaps. */
  tv?: boolean;
  /** TV overflow line ("+3 más") under the list. */
  more?: string;
  children?: ReactNode;
}) {
  const { h, s, icon: Icon } = STATUS_HUE[status];
  return (
    <section
      ref={rootRef}
      aria-label={label}
      className={cn(
        "relative flex flex-col overflow-hidden rounded-2xl bg-board-col",
        tv ? "gap-3 p-3 pt-4" : "gap-2.5 p-2.5 pt-3.5",
        dropState === "legal" && "board-hue-ring",
        dropState === "illegal" && "[&>:not([data-hint])]:opacity-40 [&>:not([data-hint])]:grayscale",
        className,
      )}
      style={hueStyle(h, s)}
    >
      {dropState === "illegal" && (
        <div data-hint className="absolute inset-x-3 top-16 z-10 flex items-center justify-center gap-1.5 rounded-lg bg-foreground px-3 py-2 text-xs font-semibold text-background shadow-lg">
          <Lock aria-hidden="true" className="size-3.5" />
          No se puede mover acá
        </div>
      )}
      <span aria-hidden="true" className={cn("board-hue-bar absolute inset-x-0 top-0", tv ? "h-1.5" : "h-1")} />
      <div className={cn("flex items-center gap-2 px-1", tv && "pb-1")}>
        <span className={cn("board-hue-tile grid shrink-0 place-items-center rounded-lg", tv ? "size-10" : "size-8")}>
          <Icon aria-hidden="true" className={tv ? "size-5" : "size-4"} />
        </span>
        <h2 className={cn("min-w-0 flex-1 font-bold", tv ? "text-xl leading-6" : "truncate text-sm")}>{label}</h2>
        <span className={cn("rounded-full bg-background py-0.5 font-bold tabular-nums ring-1 ring-border", tv ? "px-3 text-xl" : "px-2 text-xs")}>{count}</span>
      </div>
      {count > 0 ? (
        <ul className={cn("flex flex-col", tv ? "gap-3" : "gap-2.5")}>{children}</ul>
      ) : (
        empty && (
          <div className="grid min-h-24 place-items-center rounded-xl border border-dashed border-border px-3 text-center text-xs text-muted-foreground">
            {empty}
          </div>
        )
      )}
      {more && <p className="px-1 text-xl text-muted-foreground">{more}</p>}
    </section>
  );
}

/**
 * One card (a list item). `plate`/`make`/`model` null read "Sin placa"/"Sin vehículo"; the caller
 * passes null for a missing vehicle, because `BoardRow.plate` already holds the TV's "Sin vehículo".
 */
export function CardShell({
  plate,
  make,
  model,
  urgent,
  rootRef,
  grip,
  action,
  tags,
  alert,
  footer,
  tv,
  className,
}: {
  plate: string | null;
  make: string | null;
  model: string | null;
  urgent: boolean;
  /** The kanban's draggable node. */
  rootRef?: Ref<HTMLLIElement>;
  grip?: ReactNode;
  action?: ReactNode;
  tags?: ReactNode;
  alert?: ReactNode;
  footer: ReactNode;
  /** Read-only TV scale. */
  tv?: boolean;
  className?: string;
}) {
  const vehicle = [make, model].filter(Boolean).join(" ");
  return (
    <li ref={rootRef} className={cn("relative border bg-board-tile shadow-(--board-tile-shadow)", tv ? "rounded-2xl p-4" : "rounded-xl p-3", urgent && "border-urgent/45", className)}>
      {urgent && <span aria-hidden="true" className={cn("absolute left-0 rounded-r-full bg-urgent", tv ? "inset-y-4 w-1.5" : "inset-y-3 w-1")} />}
      <div className="flex items-start gap-1.5">
        {grip}
        <div className="min-w-0 flex-1">
          <div className={cn("truncate font-extrabold tracking-wider tabular-nums", tv ? "text-[28px] leading-8" : "text-[15px] leading-5")}>
            {plate ?? <span className="font-semibold tracking-normal text-muted-foreground italic">Sin placa</span>}
          </div>
          <div className={cn("mt-0.5 truncate text-muted-foreground", tv ? "text-lg leading-6" : "text-xs")}>{vehicle || "Sin vehículo"}</div>
        </div>
        {action}
      </div>
      {tags && <div className="mt-2 flex flex-wrap gap-1.5">{tags}</div>}
      {alert && <div className="mt-2">{alert}</div>}
      <div className={cn("flex items-center justify-between gap-2", tv ? "mt-3 flex-wrap" : "mt-2.5 border-t pt-2.5")}>{footer}</div>
    </li>
  );
}

/** Red badge: flame icon plus the word, never colour alone. */
export function UrgentBadge({ tv }: { tv?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full bg-urgent font-bold tracking-wide text-white uppercase", tv ? "px-3 py-1 text-base" : "px-2 py-0.5 text-[11px]")}>
      <Flame aria-hidden="true" className={tv ? "size-4" : "size-3"} />
      Urgente
    </span>
  );
}

/** Neutral time chip: never red or amber, whatever the elapsed time. */
export function TimeChip({ icon: Icon = Clock, tv, children }: { icon?: LucideIcon; tv?: boolean; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full bg-muted font-medium whitespace-nowrap text-muted-foreground", tv ? "px-3 py-1 text-base" : "px-2 py-0.5 text-[11px]")}>
      <Icon aria-hidden="true" className={tv ? "size-4" : "size-3"} />
      {children}
    </span>
  );
}

const ALERT_ICON: Record<CardAlert["kind"], LucideIcon> = { overdue: Clock, hold: Pause, missing: TriangleAlert };

/** The only amber on a card; `cardAlert` decides whether there is a reason to render it. */
export function AlertStrip({ alert, tv }: { alert: CardAlert; tv?: boolean }) {
  const Icon = ALERT_ICON[alert.kind];
  return (
    <div className={cn("flex items-center gap-2 rounded-lg border border-board-warn-border bg-board-warn-bg font-semibold text-board-warn-fg", tv ? "px-3 py-2 text-base" : "px-2.5 py-1.5 text-xs")}>
      <Icon aria-hidden="true" className={cn("shrink-0", tv ? "size-[18px]" : "size-3.5")} />
      <span>{alert.text}</span>
    </div>
  );
}

const MAX_AVATARS = 3;
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
/** Same name, same hue, on every render and every machine. */
const nameHue = (name: string) => [...name].reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) % 360, 7);

/** Initials are visual only; the full names are one sr-only span, e.g. "Ana, Beto". */
export function TechAvatars({ names, tv }: { names: string[]; tv?: boolean }) {
  if (names.length === 0) {
    return (
      <span className={cn("inline-flex items-center gap-1.5 text-muted-foreground", tv ? "text-base" : "text-xs")}>
        <span aria-hidden="true" className={cn("grid place-items-center rounded-full border border-dashed border-muted-foreground/60", tv ? "size-10" : "size-6.5")}>
          <UserPlus className={tv ? "size-5" : "size-3.5"} />
        </span>
        Sin técnico
      </span>
    );
  }
  const extra = names.length - MAX_AVATARS;
  const avatar = cn("board-av grid shrink-0 place-items-center rounded-full font-bold", tv ? "size-10 text-base" : "size-6.5 text-[10px]");
  return (
    <span className="flex -space-x-1">
      {names.slice(0, MAX_AVATARS).map((name, i) => (
        <span key={i} aria-hidden="true" className={avatar} style={hueStyle(nameHue(name))}>
          {initials(name)}
        </span>
      ))}
      {extra > 0 && (
        <span aria-hidden="true" className={cn(avatar, "bg-muted text-muted-foreground")}>
          +{extra}
        </span>
      )}
      <span className="sr-only">{names.join(", ")}</span>
    </span>
  );
}

/** Neutral category tag; nothing when the category is not set yet (the alert strip says so). */
export function CategoryTag({ categoria }: { categoria: ServiceCategory | null }) {
  if (categoria === null) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
      <Tag aria-hidden="true" className="size-3" />
      {categoriaLabel(categoria)}
    </span>
  );
}
