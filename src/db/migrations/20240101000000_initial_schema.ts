import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Use hasTable checks so this migration is fully idempotent.
  // Safe to run multiple times — won't error if tables already exist.

  const hasSyncState = await knex.schema.hasTable("sync_state");
  if (!hasSyncState) {
    await knex.schema.createTable("sync_state", (table) => {
      table.string("source").primary();
      table.string("cursor").nullable();
      table.timestamp("last_synced_at").defaultTo(knex.fn.now());
    });
  }

  const hasUnifiedRecords = await knex.schema.hasTable("unified_records");
  if (!hasUnifiedRecords) {
    await knex.schema.createTable("unified_records", (table) => {
      table.string("id").primary();
      table.string("source").notNullable();
      table.string("source_id").notNullable();
      table.string("type").notNullable();
      table.json("raw_data").notNullable();
      table.string("email").nullable();
      table.string("name").nullable();
      table.timestamp("event_date").nullable();
      table.unique(["source", "source_id"]);
      table.timestamp("created_at").defaultTo(knex.fn.now());
      table.timestamp("updated_at").defaultTo(knex.fn.now());
    });
  }

  const hasTransactions = await knex.schema.hasTable("transactions");
  if (!hasTransactions) {
    await knex.schema.createTable("transactions", (table) => {
      table.string("id").primary();
      table.string("source").notNullable();
      table.string("source_id").notNullable();
      table.integer("amount_cents").notNullable();
      table.string("currency").defaultTo("USD");
      table.string("status").notNullable();
      table.string("original_status").notNullable();
      table.timestamp("transaction_date").notNullable();
      table.unique(["source", "source_id"]);
      table.timestamp("created_at").defaultTo(knex.fn.now());
      table.timestamp("updated_at").defaultTo(knex.fn.now());
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("transactions");
  await knex.schema.dropTableIfExists("unified_records");
  await knex.schema.dropTableIfExists("sync_state");
}
