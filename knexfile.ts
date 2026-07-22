import type { Knex } from "knex";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

// In production (dist/), __dirname = dist/ so migrations are at dist/src/db/migrations
// In development (ts-node), __dirname = project root so migrations are at src/db/migrations
const migrationsDir = path.join(__dirname, "src/db/migrations");

const config: { [key: string]: Knex.Config } = {
  development: {
    client: process.env.DATABASE_URL ? "pg" : "sqlite3",
    connection: process.env.DATABASE_URL || {
      filename: path.join(__dirname, "dev.sqlite3")
    },
    useNullAsDefault: true,
    migrations: {
      directory: migrationsDir,
      loadExtensions: [".ts", ".js"],
    }
  },
  production: {
    client: "pg",
    connection: {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    },
    migrations: {
      directory: migrationsDir,
      loadExtensions: [".js"],
    }
  }
};

export default config;
