import { Client as HubSpotClient } from "@hubspot/api-client";
import Stripe from "stripe";
import { google } from "googleapis";
import { getSyncState, setSyncState, upsertUnifiedRecord, upsertTransaction } from "./db-utils";
import path from "path";
import fs from "fs";

// ─────────────────────────────────────────────
// Canonical status allow-list for "collected"
// ─────────────────────────────────────────────
const STATUS_MAP: Record<string, string> = {
  succeeded: "collected",
  paid: "collected",
  completed: "collected",
  failed: "failed",
  pending: "pending",
  voided: "voided",
  refunded: "refunded",
};

// ─────────────────────────────────────────────
// HubSpot Sync
// ─────────────────────────────────────────────
export async function syncHubSpot() {
  const source = "hubspot";
  const client = new HubSpotClient({ accessToken: process.env.HUBSPOT_ACCESS_TOKEN });
  let cursor = await getSyncState(source);

  try {
    console.log(`[HubSpot] Starting sync. Cursor: ${cursor || "none (full fetch)"}`);

    // HubSpot uses "after" for pagination cursor
    const response = await client.crm.contacts.basicApi.getPage(
      100,                          // limit
      cursor || undefined,          // after cursor
      ["email", "firstname", "lastname", "hs_lastmodifieddate"],
      undefined,
      undefined,
      false
    );

    for (const contact of response.results) {
      const props = contact.properties;
      await upsertUnifiedRecord({
        id: `hs_${contact.id}`,
        source,
        source_id: contact.id,
        type: "contact",
        raw_data: JSON.stringify(contact),
        email: props.email || null,
        name: `${props.firstname || ""} ${props.lastname || ""}`.trim() || null,
        event_date: null,
      });
    }

    // Save next cursor if available
    const nextCursor = response.paging?.next?.after;
    await setSyncState(source, nextCursor || cursor);
    console.log(`[HubSpot] ✓ Synced ${response.results.length} contacts.`);
  } catch (error: any) {
    const status = error?.response?.status || error?.code;
    if (status === 410) {
      console.warn(`[HubSpot] ⚠ Cursor expired (410). Clearing cursor and retrying full fetch...`);
      await setSyncState(source, null);
      return syncHubSpot();
    }
    console.error(`[HubSpot] ✗ Sync failed:`, error?.message || error);
    throw error;
  }
}

// ─────────────────────────────────────────────
// Google Calendar Sync
// ─────────────────────────────────────────────
export async function syncGoogleCalendar() {
  const source = "gcal";
  const calendarId = process.env.GOOGLE_CALENDAR_ID!;
  // Support credentials as a JSON string env var (for Render/cloud deployments)
  // or as a file path for local development
  let credentials: any;
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
  } else {
    const credentialsPath = path.resolve(process.env.GOOGLE_CREDENTIALS_PATH || "./google-credentials.json");
    if (!fs.existsSync(credentialsPath)) {
      console.warn(`[GCal] ⚠ No credentials found (set GOOGLE_CREDENTIALS_JSON or GOOGLE_CREDENTIALS_PATH). Skipping.`);
      return;
    }
    credentials = JSON.parse(fs.readFileSync(credentialsPath, "utf-8"));
  }
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
  });

  const calendar = google.calendar({ version: "v3", auth });
  let syncToken = await getSyncState(source);

  try {
    console.log(`[GCal] Starting sync. SyncToken: ${syncToken ? "exists" : "none (full fetch)"}`);

    const params: any = {
      calendarId,
      maxResults: 250,
      singleEvents: true,
    };
    if (syncToken) {
      params.syncToken = syncToken;
    } else {
      // Full fetch: get all events from 1 year ago
      params.timeMin = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    }

    const response = await calendar.events.list(params);
    const items = response.data.items || [];

    for (const event of items) {
      if (!event.id) continue;
      await upsertUnifiedRecord({
        id: `gcal_${event.id}`,
        source,
        source_id: event.id,
        type: "event",
        raw_data: JSON.stringify(event),
        name: event.summary || null,
        email: null,
        event_date: event.start?.dateTime || event.start?.date || null,
      });
    }

    // Save next sync token
    const nextSyncToken = response.data.nextSyncToken;
    await setSyncState(source, nextSyncToken || null);
    console.log(`[GCal] ✓ Synced ${items.length} events.`);
  } catch (error: any) {
    const status = error?.response?.status || error?.code;
    if (status === 410) {
      console.warn(`[GCal] ⚠ Sync token expired (410). Clearing token and retrying full fetch...`);
      await setSyncState(source, null);
      return syncGoogleCalendar();
    }
    console.error(`[GCal] ✗ Sync failed:`, error?.message || error);
    throw error;
  }
}

// ─────────────────────────────────────────────
// Stripe Sync
// ─────────────────────────────────────────────
export async function syncStripe() {
  const source = "stripe";
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2026-06-24.dahlia" as any });
  let cursor = await getSyncState(source);

  try {
    console.log(`[Stripe] Starting sync. Cursor: ${cursor || "none (full fetch)"}`);

    const params: Stripe.ChargeListParams = { limit: 100 };
    if (cursor) {
      params.starting_after = cursor;
    }

    const response = await stripe.charges.list(params);

    for (const charge of response.data) {
      const canonicalStatus = STATUS_MAP[charge.status] || "unknown";

      await upsertTransaction({
        id: `stripe_${charge.id}`,
        source,
        source_id: charge.id,
        amount_cents: charge.amount,
        currency: charge.currency,
        status: canonicalStatus,
        original_status: charge.status,
        transaction_date: new Date(charge.created * 1000).toISOString(),
      });
    }

    // Save cursor (last charge ID for next incremental fetch)
    if (response.data.length > 0) {
      const lastId = response.data[response.data.length - 1].id;
      await setSyncState(source, lastId);
    }

    console.log(`[Stripe] ✓ Synced ${response.data.length} charges.`);
  } catch (error: any) {
    const status = error?.statusCode || error?.response?.status;
    if (status === 410) {
      console.warn(`[Stripe] ⚠ Cursor expired (410). Clearing cursor and retrying full fetch...`);
      await setSyncState(source, null);
      return syncStripe();
    }
    console.error(`[Stripe] ✗ Sync failed:`, error?.message || error);
    throw error;
  }
}

// ─────────────────────────────────────────────
// Coordinator — runs all 3 jobs in parallel
// One failing never blocks the others
// ─────────────────────────────────────────────
export async function runAllSyncs() {
  const SOURCE_NAMES = ["HubSpot", "Google Calendar", "Stripe"];
  console.log("\n═══════════════════════════════════════════");
  console.log("   Sync Pipeline Starting...");
  console.log("═══════════════════════════════════════════\n");

  const results = await Promise.allSettled([
    syncHubSpot(),
    syncGoogleCalendar(),
    syncStripe(),
  ]);

  console.log("\n─── Sync Summary ───────────────────────────");
  results.forEach((result, idx) => {
    if (result.status === "fulfilled") {
      console.log(`  ✓ ${SOURCE_NAMES[idx]}: SUCCESS`);
    } else {
      console.error(`  ✗ ${SOURCE_NAMES[idx]}: FAILED — ${result.reason?.message || result.reason}`);
    }
  });
  console.log("────────────────────────────────────────────\n");
}
