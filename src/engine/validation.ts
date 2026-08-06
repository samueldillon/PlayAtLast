import { isValidWord } from "./dictionary";

export function displayLetter(card: { kind: string; letter?: string; assignedLetter?: string | null }): string {
  if (card.kind === "letter") return card.letter ?? "?";
  return card.assignedLetter ?? "?";
}

/** True if `word` is a legal play following `coreLetter` - in dictionary,
 *  3-8 letters, and contains the core letter at least once. */
export function isLegalPlay(word: string, coreLetter: string): boolean {
  if (!isValidWord(word)) return false;
  return word.toUpperCase().includes(coreLetter.toUpperCase());
}
