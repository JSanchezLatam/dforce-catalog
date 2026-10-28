"use client";

import { DndContext, DragOverlay, MouseSensor, TouchSensor, pointerWithin, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { createContext, useContext, useState, useSyncExternalStore, type ComponentProps, type ReactNode } from "react";

import { ColumnShell } from "@/modules/board/primitives";
import type { OrderStatus } from "@/modules/service-orders/transitions";
import { legalTargets } from "./plan";
import type { KanbanCard } from "./shape";

/** The card being dragged, for the columns to light up or dim. Null outside a drag, and outside a `DndBoard`. */
const Dragged = createContext<KanbanCard | null>(null);
const subscribeNever = () => () => {};
const quiet = () => undefined;
// Pointer-only drag, so no screen reader can use it: the ⋯ menu is the accessible path. The defaults would read English
// text naming the order id.
const SILENT = { onDragStart: quiet, onDragOver: quiet, onDragEnd: quiet, onDragCancel: quiet };

/**
 * Drag and drop for the board. A drop calls `onDrop`, which is the menu's own path (`planMove`, dialogs, `moveOrder`).
 * Until the page has hydrated this renders only `children`: the same markup the server sent (D11a).
 */
export function DndBoard({ cards, columns, onDrop, overlay, children }: {
  cards: readonly KanbanCard[];
  columns: readonly OrderStatus[];
  onDrop: (card: KanbanCard, target: OrderStatus) => void;
  overlay: (card: KanbanCard) => ReactNode;
  children: ReactNode;
}) {
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);
  const [dragged, setDragged] = useState<KanbanCard | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );
  if (!mounted) return children;
  const find = (id: string | number) => cards.find((c) => c.id === id) ?? null;
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      accessibility={{ announcements: SILENT }}
      onDragStart={({ active }) => setDragged(find(active.id))}
      onDragCancel={() => setDragged(null)}
      onDragEnd={({ active, over }) => {
        setDragged(null);
        const card = find(active.id);
        const target = columns.find((c) => c === over?.id);
        if (card && target) onDrop(card, target);
      }}
    >
      <Dragged.Provider value={dragged}>{children}</Dragged.Provider>
      {/* No drop animation: the board already shows the optimistic result, and an illegal drop has nothing to show. */}
      <DragOverlay dropAnimation={null}>{dragged && overlay(dragged)}</DragOverlay>
    </DndContext>
  );
}

/** A `ColumnShell` that is a drop target and shows, mid-drag, whether the dragged card may land here. */
export function DropColumn(props: ComponentProps<typeof ColumnShell>) {
  const { setNodeRef } = useDroppable({ id: props.status });
  const dragged = useContext(Dragged);
  const dropState = !dragged || dragged.status === props.status ? undefined : legalTargets(dragged.status).includes(props.status) ? "legal" : "illegal";
  return <ColumnShell {...props} rootRef={setNodeRef} dropState={dropState} />;
}
