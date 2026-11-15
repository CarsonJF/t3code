/** Cards remember whether they were opened for as long as this client stays open. */
const expandedByCard = new Map<string, boolean>();

export function changedFilesCardExpanded(cardKey: string): boolean | undefined {
  return expandedByCard.get(cardKey);
}

export function rememberChangedFilesCardExpanded(cardKey: string, expanded: boolean): void {
  expandedByCard.set(cardKey, expanded);
}
