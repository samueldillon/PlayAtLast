import { replayDailyChallenge } from "../../src/engine/dailyChallenge";
import { loadDictionary } from "../../src/engine/dictionary";
import { verifyAppCheckToken } from "./appCheck";
import { createDocument, runTransaction, findOneByField } from "./firestore";
import type { ServiceAccount } from "./googleAuth";
import type { DailyResultClaim } from "../../src/engine/types";

export interface Env {
  FIREBASE_PROJECT_ID: string;
  FIREBASE_PROJECT_NUMBER: string;
  FIREBASE_SERVICE_ACCOUNT_JSON: string;
  DICTIONARY_URL: string; // e.g. https://playatlast.com/dictionary.txt
  ALLOWED_ORIGIN: string; // e.g. https://playatlast.com
}

const HISTOGRAM_BUCKET_SIZE = 5; // net-score buckets of width 5, e.g. [0,5), [5,10)...
const MAX_MOVES_PER_SUBMISSION = 60; // sanity ceiling - a real game can't exceed this

let dictionaryReady: Promise<void> | null = null;
async function ensureDictionary(env: Env): Promise<void> {
  if (!dictionaryReady) {
    dictionaryReady = (async () => {
      const res = await fetch(env.DICTIONARY_URL);
      if (!res.ok) throw new Error(`Failed to fetch dictionary: ${res.status}`);
      const text = await res.text();
      loadDictionary(text.split("\n").map((w) => w.trim()).filter(Boolean));
    })();
  }
  return dictionaryReady;
}

function bucketFor(netScore: number): string {
  return String(Math.floor(netScore / HISTOGRAM_BUCKET_SIZE) * HISTOGRAM_BUCKET_SIZE);
}

async function hashDeviceId(deviceId: string, date: string): Promise<string> {
  const enc = new TextEncoder().encode(`${deviceId}:${date}:playatlast-salt-v1`);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function corsHeaders(env: Env): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Firebase-AppCheck",
  };
}

function json(data: unknown, status: number, env: Env): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(env) },
  });
}

async function handleSubmitDailyResult(req: Request, env: Env): Promise<Response> {
  const appCheckToken = req.headers.get("X-Firebase-AppCheck");
  if (!appCheckToken || !(await verifyAppCheckToken(appCheckToken, env.FIREBASE_PROJECT_NUMBER))) {
    return json({ error: "App Check verification failed" }, 401, env);
  }

  let body: { claim: DailyResultClaim; deviceId: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, env);
  }

  const { claim, deviceId } = body;
  if (!claim?.date || !Array.isArray(claim.moves) || typeof deviceId !== "string" || deviceId.length < 8) {
    return json({ error: "Malformed submission" }, 400, env);
  }
  if (claim.moves.length > MAX_MOVES_PER_SUBMISSION) {
    return json({ error: "Too many moves in submission" }, 400, env);
  }
  const today = new Date().toISOString().slice(0, 10);
  if (claim.date !== today) {
    return json({ error: "Submission is not for today's challenge" }, 400, env);
  }

  await ensureDictionary(env);
  const sa: ServiceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const projectId = env.FIREBASE_PROJECT_ID;

  const deviceHash = await hashDeviceId(deviceId, claim.date);

  // Idempotency: has this device already submitted today?
  const already = await findOneByField(sa, projectId, "daily_results", "deviceHash", deviceHash);
  if (already) {
    return json({ error: "Already submitted for today", netScore: already.netScore }, 409, env);
  }

  const result = replayDailyChallenge(claim);
  if (!result.valid) {
    return json({ error: "Submission failed validation", reason: result.reason }, 422, env);
  }

  await createDocument(sa, projectId, "daily_results", {
    date: claim.date,
    netScore: result.netScore,
    humanScore: result.humanScore,
    cpuScore: result.cpuScore,
    longestWord: result.longestWord,
    deviceHash,
    createdAt: new Date().toISOString(),
  });

  let percentile = 50;
  let totalToday = 1;
  const targetBucket = Number(bucketFor(result.netScore));

  await runTransaction(sa, projectId, `daily_stats/${claim.date}`, (current) => {
    const buckets: Record<string, number> = (current?.buckets as Record<string, number>) ?? {};
    const key = String(targetBucket);
    buckets[key] = (buckets[key] ?? 0) + 1;

    const total = Object.values(buckets).reduce((a, b) => a + b, 0);
    const below = Object.entries(buckets)
      .filter(([k]) => Number(k) < targetBucket)
      .reduce((a, [, v]) => a + v, 0);
    percentile = Math.round((below / total) * 100);
    totalToday = total;

    return { date: claim.date, buckets, total };
  });

  return json({
    ok: true,
    netScore: result.netScore,
    humanScore: result.humanScore,
    cpuScore: result.cpuScore,
    longestWord: result.longestWord,
    percentile,
    totalPlayersToday: totalToday,
  }, 200, env);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(env) });
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname === "/submitDailyResult") {
      return handleSubmitDailyResult(req, env);
    }
    return json({ error: "Not found" }, 404, env);
  },
};
