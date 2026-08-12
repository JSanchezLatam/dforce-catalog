"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type TreeItem = {
  value: string;
  label: string;
  children?: TreeItem[];
};

export function TreeSelect({
  items,
  selected,
  onSelectionChange,
  placeholder = "Select categories...",
}: {
  items: TreeItem[];
  selected: string[];
  onSelectionChange: (selected: string[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const id = useId();

  /**
   * Closing IS discarding the transient search and expansion — one action, so
   * one function. It used to be an effect watching `open` go false, which ran
   * a render late and fired on the initial mount too.
   */
  function close() {
    setOpen(false);
    setSearchQuery("");
    setExpanded(new Set());
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const sel = useMemo(() => new Set(selected), [selected]);

  const filteredItems = useMemo(
    () =>
      items
        .map((item) => ({
          ...item,
          children: item.children?.filter(
            (c) => !searchQuery || c.label.toLowerCase().includes(searchQuery.toLowerCase()),
          ),
        }))
        .filter(
          (item) =>
            !searchQuery ||
            item.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (item.children && item.children.length > 0),
        ),
    [items, searchQuery],
  );

  const allFlat = useMemo(() => {
    const flat: { value: string; label: string }[] = [];
    for (const item of items) {
      flat.push({ value: item.value, label: item.label });
      if (item.children) {
        for (const child of item.children) {
          flat.push({ value: child.value, label: child.label });
        }
      }
    }
    return flat;
  }, [items]);

  const selectedCount = allFlat.filter((f) => sel.has(f.value)).length;

  function toggleCollapse(value: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  function isFullySelected(children: TreeItem[]): boolean {
    return children.every((c) => sel.has(c.value));
  }

  function toggleL1(item: TreeItem) {
    if (!item.children || item.children.length === 0) {
      onSelectionChange(
        sel.has(item.value) ? selected.filter((v) => v !== item.value) : [...selected, item.value],
      );
      return;
    }
    const allSelected = isFullySelected(item.children);
    const childValues = item.children.map((c) => c.value);
    if (allSelected) {
      onSelectionChange(selected.filter((v) => v !== item.value && !childValues.includes(v)));
    } else {
      const next = new Set(selected);
      next.add(item.value);
      for (const cv of childValues) next.add(cv);
      onSelectionChange([...next]);
    }
  }

  function toggleL2(value: string) {
    onSelectionChange(sel.has(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        className={cn(
          "flex h-9 w-full items-center justify-between rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-xs",
          "focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring",
          "disabled:cursor-not-allowed disabled:opacity-50",
          open && "border-ring ring-[3px] ring-ring/50",
        )}
      >
        <span className={cn(selectedCount === 0 && "text-muted-foreground")}>
          {selectedCount > 0
            ? `${selectedCount} categor${selectedCount === 1 ? "y" : "ies"} selected`
            : placeholder}
        </span>
        <svg
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg">
          <div className="border-b border-border p-2">
            <Input
              type="search"
              placeholder="Search categories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 text-xs"
              autoFocus
            />
          </div>
          <div className="max-h-60 overflow-auto p-1">
            {filteredItems.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">No categories found</p>
            )}
            <ul className="space-y-0.5">
              {filteredItems.map((item) => {
                const hasChildren = item.children && item.children.length > 0;
                const childValues = item.children?.map((c) => c.value) ?? [];
                const childSelectedCount = childValues.filter((v) => sel.has(v)).length;
                const allSelected = hasChildren && isFullySelected(item.children!);
                const someSelected = hasChildren && childSelectedCount > 0 && !allSelected;
                const isExpanded = expanded.has(item.value) || searchQuery.length > 0;

                return (
                  <li key={item.value}>
                    <div className="flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-accent group">
                      {hasChildren && (
                        <button
                          type="button"
                          onClick={() => toggleCollapse(item.value)}
                          className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-accent-foreground/10"
                          aria-label={isExpanded ? "Collapse" : "Expand"}
                        >
                          <ChevronRight
                            className={cn("size-3.5 text-muted-foreground transition-transform", isExpanded && "rotate-90")}
                          />
                        </button>
                      )}
                      {!hasChildren && <span className="size-5" />}
                      <label
                        htmlFor={`${id}-${item.value}`}
                        className="flex flex-1 items-center gap-2 text-sm cursor-pointer"
                      >
                        <Checkbox
                          id={`${id}-${item.value}`}
                          checked={allSelected || sel.has(item.value)}
                          onCheckedChange={() => toggleL1(item)}
                        />
                        <span className="truncate font-medium">{item.label}</span>
                        {hasChildren && (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {childSelectedCount}/{item.children!.length}
                          </span>
                        )}
                      </label>
                    </div>
                    {hasChildren && isExpanded && (
                      <ul className="ml-5 border-l border-border pl-2">
                        {(item.children ?? []).map((child) => (
                          <li key={child.value}>
                            <label
                              htmlFor={`${id}-${child.value}`}
                              className="flex items-center gap-2 rounded-md px-2 py-1 text-sm cursor-pointer hover:bg-accent"
                            >
                              <Checkbox
                                id={`${id}-${child.value}`}
                                checked={sel.has(child.value)}
                                onCheckedChange={() => toggleL2(child.value)}
                              />
                              <span className="truncate">{child.label}</span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
