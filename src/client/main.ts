import { ensureDictionaryLoaded } from "./dictionary";
import { isValidWord } from "../engine/dictionary";

// TEMPORARY entry point. This exists so the build/deploy pipeline can be
// verified end-to-end (dictionary asset loads, engine imports resolve,
// Vite build succeeds, Cloudflare Pages serves it) BEFORE the full
// screen-by-screen UI port from the prototype lands here.
//
// Everything below this comment gets replaced by the real game UI.

async function main() {
  const app = document.getElementById("app")!;
  app.textContent = "Loading dictionary…";

  await ensureDictionaryLoaded();

  const sanityCheck = isValidWord("EXAMPLE");
  app.textContent = sanityCheck
    ? "At Last — engine + dictionary loaded OK. UI port in progress."
    : "Dictionary loaded but sanity check failed — check public/dictionary.txt";
}

main().catch((err) => {
  console.error(err);
  const app = document.getElementById("app");
  if (app) app.textContent = "Failed to initialize: " + (err as Error).message;
});
