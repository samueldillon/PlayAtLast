import type { Card } from "./types";

export interface WordPlan {
  word: string;
  coreLetter: string;
  usedHandCards: Card[];
  usedWildcards: Card[];
  wildAssignments: string[];
}

let wordsByLengthCache: Record<number, string[]> | null = null;

function getWordsByLength(allWords: Iterable<string>): Record<number, string[]> {
  if (wordsByLengthCache) return wordsByLengthCache;
  const map: Record<number, string[]> = {};
  for (const w of allWords) {
    (map[w.length] ??= []).push(w);
  }
  wordsByLengthCache = map;
  return map;
}

function tryPlanFixed(word: string, handLetterCards: Card[], wildCards: Card[], coreLetter: string): WordPlan | null {
  const counts: Record<string, number> = {};
  for (const l of word) counts[l] = (counts[l] || 0) + 1;
  if (!counts[coreLetter]) return null;
  counts[coreLetter]--;

  const availableHand = handLetterCards.slice();
  const usedHandCards: Card[] = [];
  for (const letter of Object.keys(counts)) {
    while (counts[letter] > 0) {
      const idx = availableHand.findIndex((c) => c.letter === letter);
      if (idx === -1) break;
      usedHandCards.push(availableHand[idx]);
      availableHand.splice(idx, 1);
      counts[letter]--;
    }
  }
  const remainingLetters: string[] = [];
  for (const l of Object.keys(counts)) for (let i = 0; i < counts[l]; i++) remainingLetters.push(l);
  if (remainingLetters.length > wildCards.length) return null;

  return {
    word,
    coreLetter,
    usedHandCards,
    usedWildcards: wildCards.slice(0, remainingLetters.length),
    wildAssignments: remainingLetters,
  };
}

/** Finds the longest word the CPU can legally play. Ties broken by
 *  dictionary iteration order - deterministic, which is what lets the
 *  Worker's replay reconstruct a specific game's CPU turns exactly. */
export function planAIMove(
  p: { hand: Card[]; wildcards: Card[] },
  core: { kind: string; letter?: string },
  dictionaryWords?: Iterable<string>
): WordPlan | null {
  const coreIsWild = core.kind !== "letter";
  const coreLetterFixed = coreIsWild ? null : (core.letter ?? "");
  const byLen = dictionaryWords ? getWordsByLength(dictionaryWords) : wordsByLengthCache;
  if (!byLen) throw new Error("planAIMove: dictionary word list not available");

  const maxLen = Math.min(p.hand.length + p.wildcards.length + 1, 8);
  for (let len = maxLen; len >= 3; len--) {
    const candidates = byLen[len];
    if (!candidates) continue;
    for (const word of candidates) {
      if (coreIsWild) {
        const distinctLetters = [...new Set(word.split(""))];
        for (const cl of distinctLetters) {
          const plan = tryPlanFixed(word, p.hand, p.wildcards, cl);
          if (plan) return plan;
        }
      } else {
        const plan = tryPlanFixed(word, p.hand, p.wildcards, coreLetterFixed!);
        if (plan) return plan;
      }
    }
  }
  return null;
}

/** Turns a plan into the actual card mutations a "play" requires, without
 *  touching any global/UI state - returns what changed so the caller
 *  (client store or Worker replay) applies it to its own state shape. */
export function assembleFromPlan(
  plan: WordPlan,
  core: Card
): { usedHand: Card[]; usedWild: Card[]; newCore: Card } {
  plan.usedWildcards.forEach((card, i) => {
    card.assignedLetter = plan.wildAssignments[i];
  });
  const lastChar = plan.word[plan.word.length - 1];
  const newCore: Card =
    plan.usedWildcards.find((c) => c.assignedLetter === lastChar) ??
    plan.usedHandCards.find((c) => c.letter === lastChar) ??
    (core.kind !== "letter" && plan.coreLetter === lastChar ? core : { id: -1, kind: "letter", letter: lastChar });
  return { usedHand: plan.usedHandCards, usedWild: plan.usedWildcards, newCore };
}
