import type { EnvironmentTot } from "@t3tools/client-runtime/tots";

/** Scopes a row to its host machine, so two machines' Tots with the same id stay distinct. */
export const totOrderKey = (entry: EnvironmentTot) => `${entry.environmentId}:${entry.tot.id}`;

/** The stored order first, then the rows it does not name in the order they arrived. */
export function orderTots(
  entries: ReadonlyArray<EnvironmentTot>,
  order: ReadonlyArray<string>,
): ReadonlyArray<EnvironmentTot> {
  if (order.length === 0) return entries;
  const indexByKey = new Map(order.map((key, index) => [key, index]));
  return [...entries].sort((left, right) => {
    const leftIndex = indexByKey.get(totOrderKey(left));
    const rightIndex = indexByKey.get(totOrderKey(right));
    if (leftIndex === undefined) return rightIndex === undefined ? 0 : 1;
    if (rightIndex === undefined) return -1;
    return leftIndex - rightIndex;
  });
}

/**
 * A stored order lives across reconnects, so a machine that is away keeps its
 * rows' place. Rows that arrived since the last write go after the ones it names.
 */
export function withVisibleTotKeys(
  order: ReadonlyArray<string>,
  visibleKeys: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const known = new Set(order);
  const missing = visibleKeys.filter((key) => !known.has(key));
  return missing.length === 0 ? order : [...order, ...missing];
}

/** Drops one key on one edge of another; the dragged row is not its own target. */
export function moveTotOrder(
  order: ReadonlyArray<string>,
  draggedKey: string,
  targetKey: string,
  edge: "before" | "after",
): ReadonlyArray<string> {
  if (draggedKey === targetKey) return order;
  const next = order.filter((key) => key !== draggedKey);
  const targetIndex = next.indexOf(targetKey);
  if (targetIndex < 0) return order;
  next.splice(edge === "before" ? targetIndex : targetIndex + 1, 0, draggedKey);
  return next;
}
