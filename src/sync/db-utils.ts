import db from "../db";

export async function getSyncState(source: string): Promise<string | null> {
  const state = await db("sync_state").where({ source }).first();
  return state ? state.cursor : null;
}

export async function setSyncState(source: string, cursor: string | null): Promise<void> {
  await db("sync_state")
    .insert({ source, cursor, last_synced_at: db.fn.now() })
    .onConflict("source")
    .merge(["cursor", "last_synced_at"]);
}

export async function upsertUnifiedRecord(record: {
  id: string;
  source: string;
  source_id: string;
  type: string;
  raw_data: string;
  email?: string | null;
  name?: string | null;
  event_date?: string | null;
}) {
  await db("unified_records")
    .insert({ ...record, updated_at: db.fn.now() })
    .onConflict(["source", "source_id"])
    .merge(["type", "raw_data", "email", "name", "event_date", "updated_at"]);
}

export async function upsertTransaction(tx: {
  id: string;
  source: string;
  source_id: string;
  amount_cents: number;
  currency: string;
  status: string;
  original_status: string;
  transaction_date: string;
}) {
  await db("transactions")
    .insert({ ...tx, updated_at: db.fn.now() })
    .onConflict(["source", "source_id"])
    .merge(["amount_cents", "currency", "status", "original_status", "transaction_date", "updated_at"]);
}
