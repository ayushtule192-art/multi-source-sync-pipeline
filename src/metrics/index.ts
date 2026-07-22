import db from "../db";
import { format, parseISO } from "date-fns";
import express from "express";

const metricsRouter = express.Router();

/**
 * Problem 2 Requirements:
 * - Single canonical definition of "collected"
 * - Allow-list of statuses, not an exclusion list
 * - Single underlying query/logic for all views so they never drift
 */

// The canonical allow-list for collected revenue.
// By using this constant everywhere, we ensure no drift if a new status is added.
const COLLECTED_STATUSES = ["collected"]; 

interface MetricsQueryOpts {
  startDate?: string;
  endDate?: string;
  groupByDay?: boolean;
}

// Single Source of Truth for fetching valid transactions
async function getCollectedRevenueBaseQuery(opts: MetricsQueryOpts) {
  let query = db("transactions")
    .whereIn("status", COLLECTED_STATUSES);
    
  if (opts.startDate) {
    query = query.andWhere("transaction_date", ">=", opts.startDate);
  }
  if (opts.endDate) {
    query = query.andWhere("transaction_date", "<=", opts.endDate);
  }

  return query;
}

metricsRouter.get("/total", async (req, res) => {
  try {
    const opts: MetricsQueryOpts = {
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
    };

    const query = await getCollectedRevenueBaseQuery(opts);
    
    // Calculate total from the canonical set
    const totalCents = query.reduce((sum: number, tx: any) => sum + tx.amount_cents, 0);
    
    res.json({
      collected_revenue_cents: totalCents,
      collected_revenue_usd: totalCents / 100
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to compute total metrics" });
  }
});

metricsRouter.get("/breakdown", async (req, res) => {
  try {
    const opts: MetricsQueryOpts = {
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
    };

    // Use exactly the same base query to ensure no drift
    const query = await getCollectedRevenueBaseQuery(opts);

    // Group by day in JS to remain DB agnostic (SQLite vs Postgres date grouping syntax varies)
    const breakdown: Record<string, number> = {};
    
    for (const tx of query) {
      // Create a local date string (YYYY-MM-DD)
      const dateStr = tx.transaction_date instanceof Date ? tx.transaction_date.toISOString() : tx.transaction_date;
      const day = dateStr.split("T")[0]; 
      
      if (!breakdown[day]) {
        breakdown[day] = 0;
      }
      breakdown[day] += tx.amount_cents;
    }

    // Format the response
    const results = Object.keys(breakdown).sort().map(date => ({
      date,
      collected_revenue_cents: breakdown[date],
      collected_revenue_usd: breakdown[date] / 100
    }));

    res.json({ breakdown: results });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to compute breakdown metrics" });
  }
});

export default metricsRouter;
