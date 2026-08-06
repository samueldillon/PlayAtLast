import type { Card, DailyMove } from "../engine/types";

let moves: DailyMove[] = [];

export function resetDailyMoves(): void {
  moves = [];
}

/** Call from commitWord(), right where the prototype pushes onto
 *  state.wordLog - but only when state.mode === "daily" and the player is
 *  the human. `usedFromHand` is the same array commitWord() already
 *  computes (state.builder filtered to exclude the card that becomes the
 *  new core). */
export function recordWordMove(word: string, usedFromHand: Card[]): void {
  const wildcardAssignments = usedFromHand
    .filter((c) => c.kind !== "letter")
    .map((c) => (c.assignedLetter ?? "").toUpperCase());
  moves.push({ word: word.toUpperCase(), wildcardAssignments, drewWildcard: false });
}

/** Call from drawCard(), same daily+human gating as above. */
export function recordWildcardDraw(): void {
  moves.push({ word: "", wildcardAssignments: [], drewWildcard: true });
}

export function getDailyMoves(): DailyMove[] {
  return moves.slice();
}
