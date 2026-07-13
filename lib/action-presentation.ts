export interface PresentableLegalAction {
  kind: string;
  action?: {
    type: string;
    cardId?: string;
  };
}

export function presentLegalActions<T extends PresentableLegalAction>(
  legalActions: T[],
  ownedCardIds: Iterable<string>,
  selectedCardIds: Iterable<string>,
) {
  const exact = legalActions.filter((entry) => entry.kind === "exact" && entry.action);
  const owned = new Set(ownedCardIds);
  const selected = new Set(selectedCardIds);
  const passiveExact = exact.filter((entry) => entry.action?.type === "pass" || entry.action?.type === "endTurn");
  const selectedExact = exact.filter((entry) => {
    if (entry.action?.type === "pass" || entry.action?.type === "endTurn") return false;
    return Boolean(entry.action?.cardId && owned.has(entry.action.cardId) && selected.has(entry.action.cardId));
  });
  const contextExact = exact.filter((entry) => {
    if (entry.action?.type === "pass" || entry.action?.type === "endTurn") return false;
    return !entry.action?.cardId || !owned.has(entry.action.cardId);
  });
  return { exact, passiveExact, selectedExact, contextExact };
}
