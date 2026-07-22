import type { Knex } from "knex";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

// When compiled to dist/, __dirname is dist/ so migrations are in dist/src/db/migrations
// When running via ts-node, __dirname is the project root, so migrations are in src/db/migrations
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
      // Use compiled .js files in production, .ts in development
      loadExtensions: [".js"],
    }
  },
  production: {
    client: "pg",
    connection: process.env.DATABASE_URL,
    migrations: {
      directory: migrationsDir,
      loadExtensions: [".js"],
    }
  }
};

export default config;
