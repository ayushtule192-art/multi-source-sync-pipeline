import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Sync state tracking
  await knex.schema.createTable("sync_state", (table) => {
    table.string("source").primary();
    table.string("cursor").nullable(); // Can be a timestamp or a specific token
    table.timestamp("last_synced_at").defaultTo(knex.fn.now());
  });

  // Unified schema for everything if needed, but since problem 2 asks for transactions
  // we will have a generic unified_records and a specific transactions table
  await knex.schema.createTable("unified_records", (table) => {
    table.string("id").primary(); // Composite or UUID
    table.string("source").notNullable();
    table.string("source_id").notNullable();
    table.string("type").notNullable(); // e.g., 'contact', 'event', 'payment'
    table.json("raw_data").notNullable();
    
    // Normalized fields
    table.string("email").nullable();
    table.string("name").nullable();
    table.timestamp("event_date").nullable();

    table.unique(["source", "source_id"]); // For idempotency
    table.timestamp("created_at").defaultTo(knex.fn.now());
    table.timestamp("updated_at").defaultTo(knex.fn.now());
  });

  // Transactions specifically for the metrics service (Problem 2)
  await knex.schema.createTable("transactions", (table) => {
    table.string("id").primary();
    table.string("source").notNullable();
    table.string("source_id").notNullable();
    
    // Normalized fields
    table.integer("amount_cents").notNullable();
    table.string("currency").defaultTo("USD");
    table.string("status").notNullable(); // Mapped to canonical status
    table.string("original_status").notNullable();
    table.timestamp("transaction_date").notNullable();

    table.unique(["source", "source_id"]); // Idempotency
    table.timestamp("created_at").defaultTo(knex.fn.now());
    table.timestamp("updated_at").defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("transactions");
  await knex.schema.dropTableIfExists("unified_records");
  await knex.schema.dropTableIfExists("sync_state");
}
