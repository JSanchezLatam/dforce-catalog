import { fold } from "@/shared/text";

import type { NavGroup, NavLink, NavParent } from "./nav-items";

const matches = (label: string, q: string): boolean => fold(label).includes(q);

function filterItem(item: NavLink | NavParent, q: string): NavLink | NavParent | null {
  if (item.kind === "link") return matches(item.label, q) ? item : null;
  if (matches(item.label, q)) return item;
  const children = item.children.filter((c) => matches(c.label, q));
  return children.length > 0 ? { ...item, children } : null;
}

/**
 * Filters only the groups it is given (already permission-filtered), so it can
 * never widen access. Group labels are not matched; a blank query returns the input.
 */
export function filterNavGroups(groups: NavGroup[], query: string): NavGroup[] {
  const q = fold(query).trim();
  if (!q) return groups;
  const result: NavGroup[] = [];
  for (const group of groups) {
    const items = group.items.map((i) => filterItem(i, q)).filter((i): i is NavLink | NavParent => i !== null);
    if (items.length > 0) result.push({ ...group, items });
  }
  return result;
}

/** The first link in display order, descending into a parent's first child. */
export function firstHref(groups: NavGroup[]): string | undefined {
  const first = groups[0]?.items[0];
  if (!first) return undefined;
  return first.kind === "link" ? first.href : first.children[0]?.href;
}

/**
 * Splits `label` around the first match. The folded index maps 1:1 onto the
 * original because each precomposed Spanish letter folds to one character.
 */
export function highlight(label: string, query: string): { before: string; match: string; after: string } | null {
  const q = fold(query).trim();
  if (!q) return null;
  const at = fold(label).indexOf(q);
  if (at < 0) return null;
  return { before: label.slice(0, at), match: label.slice(at, at + q.length), after: label.slice(at + q.length) };
}
