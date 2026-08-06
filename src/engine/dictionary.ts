// Deliberately holds NO word data itself - both the browser and the Worker
// load public/dictionary.txt (one word per line) from wherever makes sense
// for their runtime, then hand it to this module. Keeps the engine free of
// any embedded multi-hundred-KB string, and keeps client/server validating
// against the literal same file.

let dictionary: Set<string> | null = null;

export function loadDictionary(words: string[]): void {
  dictionary = new Set(words.map((w) => w.toUpperCase()));
}

export function isValidWord(word: string): boolean {
  if (!dictionary) throw new Error("Dictionary not loaded - call loadDictionary() first.");
  if (!word || word.length < 3 || word.length > 8) return false;
  return dictionary.has(word.toUpperCase());
}

export function isDictionaryLoaded(): boolean {
  return dictionary !== null;
}

/** Exposes the loaded word set for callers (like the AI planner) that need
 *  to iterate all words rather than just check membership. */
export function getDictionaryWords(): Set<string> {
  if (!dictionary) throw new Error("Dictionary not loaded - call loadDictionary() first.");
  return dictionary;
}
