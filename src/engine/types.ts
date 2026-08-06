export type CardKind = "letter" | "wildcard";

export interface Card {
  id: number;
  kind: CardKind;
  letter?: string;                 // present when kind === "letter"
  assignedLetter?: string | null;  // set on a wildcard once a player picks a display letter
}

export interface Player {
  name: string;
  hand: Card[];
  wildcards: Card[];
  score: number;
  isCPU: boolean;
}

export interface WordLogEntry {
  type: "word" | "wildcard" | "roundBonus" | "eliminated" | "eliminationWin";
  word?: string;
  by: string;
  points?: number;
}

export interface DailyMove {
  // One entry per turn the human player took during a Daily Challenge game.
  // This is the CLAIM the Worker replays and verifies - never trusted as-is.
  word: string;
  wildcardAssignments: string[]; // letters assigned to wildcards used in this word
  drewWildcard: boolean;         // true if this "move" was drawing a wildcard instead of playing
}

export interface DailyResultClaim {
  date: string;       // "YYYY-MM-DD"
  moves: DailyMove[]; // full replayable history of the human player's turns
}

export interface ReplayResult {
  valid: boolean;
  reason?: string;
  humanScore: number;
  cpuScore: number;
  netScore: number;
  longestWord: string;
  eightLetterWordCount: number;
}
