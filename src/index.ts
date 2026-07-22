import express from "express";
import cors from "cors";
import metricsRouter from "./metrics";
import { runAllSyncs } from "./sync/jobs";
import db from "./db";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ─── Health Check ──────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── Metrics API ───────────────────────────────
app.use("/metrics", metricsRouter);

// ─── Manual Sync Trigger ────────────────────────
app.post("/sync/trigger", async (_req, res) => {
  console.log("Manual sync triggered via API...");
  // Run in background, respond immediately
  runAllSyncs().catch(console.error);
  res.json({ status: "sync_started", message: "Sync running in background. Check server logs for progress." });
});

// ─── Sync Status ────────────────────────────────
app.get("/sync/status", async (_req, res) => {
  try {
    const states = await db("sync_state").select("*");
    res.json({ sync_state: states });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Records Overview ───────────────────────────
app.get("/records", async (req, res) => {
  try {
    const source = req.query.source as string;
    let query = db("unified_records").select("id", "source", "type", "name", "email", "event_date", "updated_at");
    if (source) query = query.where({ source });
    const records = await query.orderBy("updated_at", "desc").limit(50);
    res.json({ count: records.length, records });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Transactions Overview ──────────────────────
app.get("/transactions", async (_req, res) => {
  try {
    const txns = await db("transactions")
      .select("id", "source", "status", "original_status", "amount_cents", "currency", "transaction_date")
      .orderBy("transaction_date", "desc")
      .limit(50);
    res.json({ count: txns.length, transactions: txns });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Start Server ───────────────────────────────
async function start() {
  try {
    await db.migrate.latest();
    console.log("✓ Migrations complete.");
  } catch (err: any) {
    // This error occurs when dev (ts-node) and prod (compiled js) share the same DB.
    // Dev records the migration as ".ts", prod looks for ".js" — Knex sees a mismatch.
    // Since our migration uses hasTable guards, the tables always exist safely.
    if (err.message?.includes("migration directory is corrupt")) {
      console.warn("⚠ Migration file extension mismatch (.ts vs .js). Verifying tables...");
      const tablesExist = await db.schema.hasTable("sync_state");
      if (tablesExist) {
        console.log("✓ Tables already exist. Skipping migration check.");
      } else {
        // Tables genuinely don't exist — re-throw so we don't start with no DB
        throw err;
      }
    } else {
      throw err;
    }
  }

  app.listen(PORT, () => {
    console.log(`\n🚀 Server running on http://localhost:${PORT}`);
    console.log(`   POST /sync/trigger      — trigger a sync`);
    console.log(`   GET  /sync/status       — see last sync cursors`);
    console.log(`   GET  /records           — view synced records`);
    console.log(`   GET  /transactions      — view synced transactions`);
    console.log(`   GET  /metrics/total     — total collected revenue`);
    console.log(`   GET  /metrics/breakdown — day-by-day revenue\n`);

    // Auto-sync on startup
    runAllSyncs().catch(console.error);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
