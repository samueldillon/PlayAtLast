import { getDailyMoves } from "./dailyMoves";
import { getAppCheckToken } from "./firebaseClient";

export interface DailyResultResponse {
  ok: boolean;
  netScore: number;
  humanScore: number;
  cpuScore: number;
  longestWord: string;
  percentile: number;
  totalPlayersToday: number;
}

function getDeviceId(): string {
  const key = "atlast_device_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

/** Posts the human player's full move history for verification and returns
 *  the server-computed score + percentile + histogram inputs in one
 *  response - no separate Firestore read needed on the client at all. */
export async function submitDailyResult(dateStr: string): Promise<DailyResultResponse> {
  const appCheckToken = await getAppCheckToken();
  const res = await fetch(`${import.meta.env.VITE_WORKER_URL}/submitDailyResult`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Firebase-AppCheck": appCheckToken,
    },
    body: JSON.stringify({
      deviceId: getDeviceId(),
      claim: { date: dateStr, moves: getDailyMoves() },
    }),
  });
  if (res.status === 409) {
    // Already submitted today - treat as informational, not an error toast
    const data = await res.json();
    throw Object.assign(new Error("Already played today"), { alreadyPlayed: true, data });
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`submitDailyResult failed: ${res.status} ${body.reason ?? ""}`);
  }
  return res.json();
}
