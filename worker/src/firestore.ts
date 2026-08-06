// Minimal Firestore REST wrapper - just enough to read/write the two
// collections the Worker owns. Deliberately not a full ORM; the Worker's
// job is narrow, so this stays small and auditable.

import { getAccessToken, type ServiceAccount } from "./googleAuth";

const BASE = (projectId: string) =>
  `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

type FsValue =
  | { stringValue: string }
  | { integerValue: string }
  | { booleanValue: boolean }
  | { arrayValue: { values: FsValue[] } }
  | { mapValue: { fields: Record<string, FsValue> } }
  | { nullValue: null };

function toFsValue(v: unknown): FsValue {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "number") return { integerValue: String(Math.trunc(v)) };
  if (typeof v === "boolean") return { booleanValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFsValue) } };
  if (typeof v === "object") {
    const fields: Record<string, FsValue> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) fields[k] = toFsValue(val);
    return { mapValue: { fields } };
  }
  throw new Error(`Unsupported Firestore value type: ${typeof v}`);
}

function fromFsValue(v: FsValue): unknown {
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values ?? []).map(fromFsValue);
  if ("mapValue" in v) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v.mapValue.fields ?? {})) out[k] = fromFsValue(val);
    return out;
  }
  return null;
}

export function docToObject(doc: { fields: Record<string, FsValue> }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc.fields ?? {})) out[k] = fromFsValue(v);
  return out;
}

async function authedFetch(sa: ServiceAccount, url: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken(sa);
  return fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
}

export async function createDocument(
  sa: ServiceAccount,
  projectId: string,
  collection: string,
  data: Record<string, unknown>
): Promise<void> {
  const fields: Record<string, FsValue> = {};
  for (const [k, v] of Object.entries(data)) fields[k] = toFsValue(v);
  const res = await authedFetch(sa, `${BASE(projectId)}/${collection}`, {
    method: "POST",
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`Firestore create failed: ${res.status} ${await res.text()}`);
}

export async function getDocument(
  sa: ServiceAccount,
  projectId: string,
  path: string
): Promise<Record<string, unknown> | null> {
  const res = await authedFetch(sa, `${BASE(projectId)}/${path}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore get failed: ${res.status} ${await res.text()}`);
  return docToObject(await res.json());
}

/**
 * Transactionally read-modify-write a single document by path, retrying on
 * contention. Used for the daily_stats/{date} aggregate so concurrent
 * submissions never lose a write to a race.
 */
export async function runTransaction(
  sa: ServiceAccount,
  projectId: string,
  docPath: string,
  mutate: (current: Record<string, unknown> | null) => Record<string, unknown>,
  maxAttempts = 5
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const current = await getDocument(sa, projectId, docPath);
    const next = mutate(current);
    const fields: Record<string, FsValue> = {};
    for (const [k, v] of Object.entries(next)) fields[k] = toFsValue(v);

    const res = await authedFetch(sa, `${BASE(projectId)}/${docPath}`, {
      method: "PATCH",
      body: JSON.stringify({ fields }),
    });
    if (res.ok) return;
    if (res.status === 409 || res.status === 412) continue; // contention - retry
    throw new Error(`Firestore transaction write failed: ${res.status} ${await res.text()}`);
  }
  throw new Error("Firestore transaction: exceeded retry attempts under contention");
}

/** Finds a single document in `collection` whose `field` equals `value`,
 *  or null if none exists. Used for the daily-submission idempotency check. */
export async function findOneByField(
  sa: ServiceAccount,
  projectId: string,
  collection: string,
  field: string,
  value: string
): Promise<Record<string, unknown> | null> {
  const res = await authedFetch(sa, `${BASE(projectId)}:runQuery`, {
    method: "POST",
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: collection }],
        where: {
          fieldFilter: {
            field: { fieldPath: field },
            op: "EQUAL",
            value: { stringValue: value },
          },
        },
        limit: 1,
      },
    }),
  });
  if (!res.ok) throw new Error(`Firestore query failed: ${res.status} ${await res.text()}`);
  const rows = await res.json<Array<{ document?: { fields: Record<string, FsValue> } }>>();
  const match = rows.find((r) => r.document);
  return match?.document ? docToObject(match.document) : null;
}
