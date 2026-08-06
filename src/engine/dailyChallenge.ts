import type { Card, DailyMove, DailyResultClaim, ReplayResult } from "./types";
import { dailyDeckFor, makeWildcard } from "./deck";
import { isLegalPlay, displayLetter } from "./validation";
import { wordPoints, remainingHandPoints, bonusDrawAmount } from "./scoring";
import { planAIMove, assembleFromPlan } from "./ai";

const STARTING_HAND_SIZE = 7;
const STARTING_WILDCARDS = 2;

interface SimState {
  deck: Card[];
  discard: Card[];
  humanHand: Card[];
  humanWild: Card[];
  cpuHand: Card[];
  cpuWild: Card[];
  core: Card;
  humanScore: number;
  cpuScore: number;
  nextId: number;
}

function draw(state: SimState, n: number): Card[] {
  const out: Card[] = [];
  for (let i = 0; i < n; i++) {
    if (state.deck.length === 0) {
      if (state.discard.length === 0) break;
      state.deck = state.discard;
      state.discard = [];
    }
    const c = state.deck.shift();
    if (c) out.push(c);
  }
  return out;
}

function dealRound(fullDeck: Card[], nextId: number): SimState {
  const deck = fullDeck.slice();
  const humanHand = deck.splice(0, STARTING_HAND_SIZE);
  const cpuHand = deck.splice(0, STARTING_HAND_SIZE);
  const core = deck.shift();
  if (!core) throw new Error("Deck exhausted during deal - deck is too small.");
  return {
    deck,
    discard: [],
    humanHand,
    humanWild: [makeWildcard(nextId), makeWildcard(nextId + 1)],
    cpuHand,
    cpuWild: [makeWildcard(nextId + 2), makeWildcard(nextId + 3)],
    core,
    humanScore: 0,
    cpuScore: 0,
    nextId: nextId + 4,
  };
}

/** Attempts to build the exact card set the claimed move would require out
 *  of the human's *actual* current hand/wildcards - returns null if the
 *  claim isn't achievable with the cards they really hold, which is what
 *  catches a fabricated word using letters the player was never dealt. */
function resolveHumanMove(
  state: SimState,
  move: DailyMove
): { usedHand: Card[]; usedWild: Card[]; coreConsumed: boolean } | null {
  const word = move.word.toUpperCase();
  const coreLetter = displayLetter(state.core).toUpperCase();
  if (!isLegalPlay(word, coreLetter)) return null;

  const handPool = state.humanHand.slice();
  const wildPool = state.humanWild.slice();
  if (move.wildcardAssignments.length > wildPool.length) return null;

  // Assign the claimed wildcard letters to actual wildcard cards, in order.
  const assignedWild = wildPool.slice(0, move.wildcardAssignments.length).map((c, i) => ({
    ...c,
    assignedLetter: move.wildcardAssignments[i].toUpperCase(),
  }));

  const usedHand: Card[] = [];
  const usedWild: typeof assignedWild = [];
  let coreConsumed = false;
  const letters = word.split("");

  for (const ch of letters) {
    if (!coreConsumed && ch === coreLetter) {
      coreConsumed = true;
      continue; // core card fills this slot, doesn't come from hand
    }
    const handIdx = handPool.findIndex((c) => c.kind === "letter" && c.letter === ch && !usedHand.includes(c));
    if (handIdx !== -1) {
      usedHand.push(handPool[handIdx]);
      continue;
    }
    const wildIdx = assignedWild.findIndex((c) => c.assignedLetter === ch && !usedWild.includes(c));
    if (wildIdx !== -1) {
      usedWild.push(assignedWild[wildIdx]);
      continue;
    }
    return null; // claimed word isn't buildable from real hand + real wildcards
  }
  if (!coreConsumed) return null;
  return { usedHand, usedWild, coreConsumed };
}

/**
 * Replays a Daily Challenge from a claimed move history against a freshly,
 * independently derived deck for that date. This is the ONLY thing the
 * Worker trusts - never the client's self-reported score. Any move that
 * isn't legitimately buildable from the player's real hand fails the
 * whole claim rather than being silently skipped, since a partial replay
 * could still be used to inflate a score with one fabricated move buried
 * among real ones.
 */
export function replayDailyChallenge(claim: DailyResultClaim): ReplayResult {
  const fail = (reason: string): ReplayResult => ({
    valid: false, reason, humanScore: 0, cpuScore: 0, netScore: 0, longestWord: "", eightLetterWordCount: 0,
  });

  let state: SimState;
  try {
    state = dealRound(dailyDeckFor(claim.date), 0);
  } catch {
    return fail("could not derive daily deck");
  }

  let longestWord = "";
  let eightLetterWordCount = 0;
  let turn: "human" | "cpu" = "human";
  let roundOver = false;

  for (const move of claim.moves) {
    if (roundOver) return fail("moves submitted after round already ended");
    if (turn !== "human") return fail("move submitted out of turn order");

    if (move.drewWildcard) {
      if (state.humanWild.length >= STARTING_WILDCARDS) return fail("drew wildcard while already at cap");
      state.humanWild.push(makeWildcard(state.nextId++));
      turn = "cpu";
    } else {
      const resolved = resolveHumanMove(state, move);
      if (!resolved) return fail(`illegal or unbuildable word: ${move.word}`);

      const points = wordPoints(resolved.usedHand);
      state.humanScore += points;
      if (move.word.length > longestWord.length) longestWord = move.word.toUpperCase();
      if (move.word.length === 8) eightLetterWordCount++;

      state.humanHand = state.humanHand.filter((c) => !resolved.usedHand.includes(c));
      state.humanWild = state.humanWild.filter((c) => !resolved.usedWild.includes(c));
      resolved.usedHand.forEach((c) => state.discard.push(c));

      const lastChar = move.word[move.word.length - 1].toUpperCase();
      const newCore: Card =
        resolved.usedWild.find((c) => c.assignedLetter === lastChar) ??
        { id: state.nextId++, kind: "letter", letter: lastChar };
      state.core = newCore;

      if (state.humanHand.length === 0) {
        state.humanScore += remainingHandPoints({ hand: state.cpuHand, wildcards: state.cpuWild });
        roundOver = true;
        break;
      }

      const bonus = bonusDrawAmount(move.word.length);
      if (bonus > 0) state.humanHand.push(...draw(state, bonus));
      turn = "cpu";
    }
  }

  // Run the CPU's turns deterministically to completion using the same AI
  // the client uses, so a human stalling out or the round ending on a CPU
  // play is handled identically to how the client would have played it.
  let guard = 0;
  while (!roundOver && guard++ < 200) {
    if (turn === "cpu") {
      const plan = planAIMove({ hand: state.cpuHand, wildcards: state.cpuWild }, state.core);
      if (plan) {
        const assembled = assembleFromPlan(plan, state.core);
        const points = wordPoints(assembled.usedHand);
        state.cpuScore += points;
        state.cpuHand = state.cpuHand.filter((c) => !assembled.usedHand.includes(c));
        state.cpuWild = state.cpuWild.filter((c) => !assembled.usedWild.includes(c));
        assembled.usedHand.forEach((c) => state.discard.push(c));
        state.core = assembled.newCore;

        if (state.cpuHand.length === 0) {
          state.cpuScore += remainingHandPoints({ hand: state.humanHand, wildcards: state.humanWild });
          roundOver = true;
          break;
        }
        const bonus = bonusDrawAmount(plan.word.length);
        if (bonus > 0) state.cpuHand.push(...draw(state, bonus));
      } else if (state.cpuWild.length < STARTING_WILDCARDS) {
        state.cpuWild.push(makeWildcard(state.nextId++));
      } else {
        roundOver = true; // CPU genuinely stuck - round ends, no one hit empty hand
        break;
      }
      turn = "human";
    } else {
      // Human has no more claimed moves but the round isn't over - treat as
      // a forfeit of the rest of the round rather than trusting anything further.
      roundOver = true;
      break;
    }
  }

  return {
    valid: true,
    humanScore: state.humanScore,
    cpuScore: state.cpuScore,
    netScore: state.humanScore - state.cpuScore,
    longestWord,
    eightLetterWordCount,
  };
}
