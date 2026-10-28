"use client";

import { CalendarDays, ChevronLeft, ChevronRight, CircleCheck, Clock, Eye, Flame, Pause, User, Wrench, type LucideIcon } from "lucide-react";
import { createElement, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { compareInColumn } from "@/modules/board/sort";
import { ColumnShell, STATUS_HUE } from "@/modules/board/primitives";
import { StaleBanner } from "@/modules/board/StaleBanner";
import { useBoardSnapshot } from "@/modules/board/useBoardSnapshot";
import { ORDER_STATUS_LABEL } from "@/modules/service-orders/statuses";
import type { OrderStatus } from "@/modules/service-orders/transitions";
import { PAGE_HEADING } from "@/shared/ui/styles";
import { deriveBoard, filterCards, type KanbanFilter } from "./derive";
import { KanbanCardView } from "./KanbanCard";
import type { KanbanSnapshot } from "./shape";

// Spec order. `cancelled` never gets a column.
const COLUMNS = ["booked", "open", "diagnosing", "in_progress", "on_hold", "ready_for_review", "done"] as const satisfies readonly OrderStatus[];
const KPIS: { key: keyof ReturnType<typeof deriveBoard>["kpis"]; label: string; icon: LucideIcon; tone: string }[] = [
  { key: "inShop", label: "En el taller", icon: Wrench, tone: "bg-muted text-foreground" },
  { key: "urgent", label: "Urgentes", icon: Flame, tone: "bg-urgent text-white" },
  { key: "onHold", label: "En espera", icon: Pause, tone: "bg-muted text-foreground" },
  { key: "doneToday", label: "Completadas hoy", icon: CircleCheck, tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  { key: "bookedToday", label: "Agendadas hoy", icon: CalendarDays, tone: "bg-muted text-foreground" },
  { key: "overdue", label: "Citas vencidas", icon: Clock, tone: "border border-board-warn-border bg-board-warn-bg text-board-warn-fg" },
];
const CHIPS: { filter: KanbanFilter; label: string; icon?: LucideIcon }[] = [
  { filter: "all", label: "Todas" },
  { filter: "mine", label: "Mis órdenes", icon: User },
  { filter: "urgent", label: "Urgentes", icon: Flame },
  { filter: "on_hold", label: "En espera", icon: Pause },
];
/** Distance between two neighbouring columns, whatever the gap and the column width are. */
const step = (el: HTMLElement) => (el.children[1] as HTMLElement).offsetLeft - (el.children[0] as HTMLElement).offsetLeft;
const ARROWS = [
  { label: "Columnas anteriores", dir: -1, icon: ChevronLeft },
  { label: "Columnas siguientes", dir: 1, icon: ChevronRight },
];
const control = "grid size-11 place-items-center";

/** Read-only board: the server paints `initial`, `/api/kanban` keeps it live. Props are plain serializable data. */
export function KanbanBoard({ initial, canMove }: { initial: KanbanSnapshot; canMove: boolean }) {
  const { snapshot, lastOkAt, now } = useBoardSnapshot("/api/kanban", initial);
  const [filter, setFilter] = useState<KanbanFilter>("all");
  const [active, setActive] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);

  const rows = snapshot.rows.filter((c) => (COLUMNS as readonly string[]).includes(c.status));
  const { kpis, counts } = deriveBoard(rows, snapshot.generatedAt);
  const shown = filterCards(rows, filter);
  const byStatus = (s: OrderStatus) => shown.filter((c) => c.status === s).sort(compareInColumn);
  // Healthy: polls land every 30 s. The hook ticks `now` only while failing and render may not read Date.now().
  const updated = now === null ? "menos de 30 s" : `${Math.floor((now - lastOkAt) / 1000)} s`;

  const goTo = (i: number) => (setActive(i), scroller.current?.scrollTo({ left: i * step(scroller.current), behavior: "smooth" }));

  return (
    <div className="flex min-w-0 flex-col gap-5 bg-board-canvas p-4 sm:p-6">
      <StaleBanner lastOkAt={lastOkAt} now={now} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className={cn("flex items-center gap-3", PAGE_HEADING)}>
            Kanban
            {!canMove && (
              <span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
                <Eye aria-hidden="true" className="size-3.5" />Solo lectura
              </span>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">{`Estado de las órdenes del taller.${canMove ? "" : " Los cambios de estado los hace el jefe de taller."}`}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <span aria-hidden="true" className="size-2 rounded-full bg-emerald-500" />
            {`Actualizado hace ${updated}`}
          </span>
          <div className="flex divide-x rounded-lg border bg-card max-md:hidden">
            {ARROWS.map(({ label, dir, icon: Icon }) => (
              <button key={label} type="button" aria-label={label} className={control} onClick={() => scroller.current?.scrollBy({ left: dir * step(scroller.current), behavior: "smooth" })}>
                <Icon aria-hidden="true" className="size-4.5" />
              </button>
            ))}
          </div>
        </div>
      </div>

      <div role="group" aria-label="Indicadores" className="-mx-4 flex gap-3 overflow-x-auto px-4 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 xl:grid-cols-6">
        {KPIS.map(({ key, label, icon: Icon, tone }) => (
          <div key={key} className="flex shrink-0 items-center gap-3 rounded-xl border bg-card px-3 py-2 sm:p-3.5">
            <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl sm:size-11", tone)}><Icon aria-hidden="true" className="size-5" /></span>
            <div>
              <div className="text-xs font-medium text-muted-foreground">{label}</div>
              <div className={cn("text-xl font-bold tabular-nums sm:text-[26px] sm:leading-8", key === "urgent" && "text-urgent")}>{kpis[key]}</div>
            </div>
          </div>
        ))}
      </div>

      <div role="group" aria-label="Filtros" className="-mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {CHIPS.filter((c) => c.filter !== "mine" || snapshot.onRoster).map(({ filter: f, label, icon: Icon }) => (
          <button
            key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
            className={cn("inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium", filter === f ? "border-foreground bg-foreground text-background" : "bg-card")}
          >
            {Icon && <Icon aria-hidden="true" className="size-4" />}{label}
            <span className={cn("rounded-full px-1.5 text-xs font-bold tabular-nums", f === "urgent" ? "bg-urgent text-white" : "bg-muted text-muted-foreground")}>{counts[f]}</span>
          </button>
        ))}
      </div>

      <div role="group" aria-label="Estados" className="-mx-4 flex gap-1 overflow-x-auto border-b px-4 md:hidden">
        {COLUMNS.map((s, i) => (
          <button
            key={s} type="button" aria-pressed={active === i} onClick={() => goTo(i)}
            className={cn("-mb-px flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-sm", active === i ? "border-foreground font-semibold" : "border-transparent text-muted-foreground")}
          >
            {createElement(STATUS_HUE[s].icon, { "aria-hidden": true, className: "size-4" })}
            {ORDER_STATUS_LABEL[s]}
            <span className="rounded-full bg-muted px-1.5 text-xs font-bold">{byStatus(s).length}</span>
          </button>
        ))}
      </div>
      <p className="-mt-3 text-xs text-muted-foreground md:hidden">{`${active + 1} de ${COLUMNS.length} · deslizá para cambiar de estado`}</p>

      <div ref={scroller} onScroll={(e) => setActive(Math.round(e.currentTarget.scrollLeft / (step(e.currentTarget) || 1)))} className="relative flex snap-x snap-mandatory gap-3 overflow-x-auto pb-3">
        {COLUMNS.map((s) => {
          const cards = byStatus(s);
          return (
            <ColumnShell key={s} status={s} label={ORDER_STATUS_LABEL[s]} count={cards.length} className="w-70 shrink-0 snap-start max-md:w-full"
              empty={filter === "mine" ? "Ninguna orden tuya en este estado" : "Sin órdenes"}>
              {cards.map((c) => <KanbanCardView key={c.id} card={c} generatedAt={snapshot.generatedAt} />)}
            </ColumnShell>
          );
        })}
      </div>
    </div>
  );
}
