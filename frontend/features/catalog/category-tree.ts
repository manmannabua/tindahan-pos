import type { Category } from "@/types/api-admin";

export interface CategoryNode {
  category: Category;
  depth: number;
  path: string;
}

/** Flatten categories into display order (parents before children, sorted), with depth + path. */
export function flattenCategories(categories: Category[]): CategoryNode[] {
  const children = new Map<string | null, Category[]>();
  for (const c of categories) {
    const key = c.parent_id ?? null;
    children.set(key, [...(children.get(key) ?? []), c]);
  }
  for (const list of children.values()) {
    list.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  }
  const result: CategoryNode[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number, prefix: string) => {
    for (const c of children.get(parent) ?? []) {
      if (seen.has(c.id)) continue; // guard against cycles in bad data
      seen.add(c.id);
      const path = prefix ? `${prefix} › ${c.name}` : c.name;
      result.push({ category: c, depth, path });
      walk(c.id, depth + 1, path);
    }
  };
  walk(null, 0, "");
  // Orphans (parent missing) are listed at the root.
  for (const c of categories) if (!seen.has(c.id)) result.push({ category: c, depth: 0, path: c.name });
  return result;
}

/** Ids of `id` and all its descendants (a category cannot move under these). */
export function descendantIds(categories: Category[], id: string): Set<string> {
  const result = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of categories) {
      if (c.parent_id && result.has(c.parent_id) && !result.has(c.id)) {
        result.add(c.id);
        grew = true;
      }
    }
  }
  return result;
}
