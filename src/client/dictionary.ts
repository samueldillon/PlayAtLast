import { loadDictionary, isDictionaryLoaded } from "../engine/dictionary";

let loadPromise: Promise<void> | null = null;

/** Fetches the shared word list once and feeds it into the engine's
 *  dictionary module. Safe to call from multiple places - subsequent
 *  calls await the same in-flight fetch rather than re-downloading. */
export function ensureDictionaryLoaded(): Promise<void> {
  if (isDictionaryLoaded()) return Promise.resolve();
  if (!loadPromise) {
    loadPromise = fetch("/dictionary.txt")
      .then((res) => {
        if (!res.ok) throw new Error(`Dictionary fetch failed: ${res.status}`);
        return res.text();
      })
      .then((text) => {
        const words = text.split("\n").map((w) => w.trim()).filter(Boolean);
        loadDictionary(words);
      })
      .catch((err) => {
        loadPromise = null; // allow retry on next call
        throw err;
      });
  }
  return loadPromise;
}
