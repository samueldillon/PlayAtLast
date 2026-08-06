import type { Card, Player } from "./types";

/** 1 point per remaining hand card, +5 per remaining Wildcard. */
export function remainingHandPoints(p: Pick<Player, "hand" | "wildcards">): number {
  return p.hand.length + p.wildcards.length * 5;
}

/** 1 point per non-core letter card played (wildcards never score). */
export function wordPoints(playedCards: Card[]): number {
  return playedCards.filter((c) => c.kind === "letter").length;
}

export function bonusDrawAmount(wordLength: number): number {
  if (wordLength >= 5) return 2;
  if (wordLength === 4) return 1;
  return 0;
}
