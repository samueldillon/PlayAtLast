import type { Card } from "./types";
import { type RNG, mulberry32, dailySeed } from "./rng";

const LETTER_DISTRIBUTION: Record<string, number> = {
  E: 14, A: 10, I: 8, O: 8, N: 7, T: 6, R: 6, L: 4, S: 4, U: 4, D: 4, G: 3,
  B: 1, C: 1, M: 1, P: 1, F: 1, H: 1, V: 1, W: 1, Y: 1, K: 1, J: 1, X: 1, Q: 1, Z: 1,
};

function baseDeck(): Card[] {
  const cards: Card[] = [];
  let id = 0;
  for (const letter of Object.keys(LETTER_DISTRIBUTION)) {
    for (let i = 0; i < LETTER_DISTRIBUTION[letter]; i++) {
      cards.push({ id: id++, kind: "letter", letter });
    }
  }
  return cards;
}

export function shuffle<T>(arr: T[], rng: RNG): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Builds and shuffles a fresh deck. Pass a seeded RNG for Daily Challenge;
 *  omit it for ordinary (non-deterministic) local/online games. */
export function buildDeck(rng?: RNG): Card[] {
  return shuffle(baseDeck(), rng ?? Math.random);
}

export function makeWildcard(id: number): Card {
  return { id, kind: "wildcard", assignedLetter: null };
}

/** The exact same deck order the client deals from on a given calendar date. */
export function dailyDeckFor(dateStr: string): Card[] {
  return buildDeck(mulberry32(dailySeed(dateStr)));
}
