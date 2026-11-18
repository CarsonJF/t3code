/** The narrowest a Tot card may get before the grid drops a column. */
const CARD_MIN_WIDTH = 152;
const CARD_GAP = 12;
const MAX_COLUMNS = 4;
/** Android's scroll content caps at 720dp; without the page padding that is all a row may use. */
export const TOT_GRID_MAX_WIDTH = 680;

/**
 * How many face cards fit side by side. Two on a phone, three unfolded on a Fold, four on a
 * tablet: the extra width becomes more Tots in view instead of a stretched phone column.
 */
export function totGridColumns(availableWidth: number): number {
  if (availableWidth <= 0) return 2;
  const fitting = Math.floor((availableWidth + CARD_GAP) / (CARD_MIN_WIDTH + CARD_GAP));
  return Math.min(MAX_COLUMNS, Math.max(2, fitting));
}

/** One card's width, whole dp so four of them and their gaps never spill past the row. */
export function totCardWidth(availableWidth: number, columns: number): number {
  if (columns <= 1 || availableWidth <= 0) return Math.max(0, availableWidth);
  return Math.max(0, Math.floor((availableWidth - CARD_GAP * (columns - 1)) / columns));
}

/**
 * Cards in rows the grid draws itself. Wrapping a flex row at an exact fit rounds the last card
 * onto a line of its own on a tablet, so each row is laid out instead.
 */
export function totGridRows<T>(items: ReadonlyArray<T>, columns: number): ReadonlyArray<T[]> {
  const perRow = Math.max(1, columns);
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += perRow) {
    rows.push(items.slice(index, index + perRow));
  }
  return rows;
}

export { CARD_GAP as TOT_GRID_GAP };
