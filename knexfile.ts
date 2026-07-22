import type { Knex } from "knex";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const config: { [key: string]: Knex.Config } = {
  development: {
    client: process.env.DATABASE_URL ? "pg" : "sqlite3",
    connection: process.env.DATABASE_URL || {
      filename: path.join(__dirname, "dev.sqlite3")
    },
    useNullAsDefault: true,
    migrations: {
      directory: path.join(__dirname, "src/db/migrations"),
    }
  },
  production: {
    client: "pg",
    connection: process.env.DATABASE_URL,
    migrations: {
      directory: path.join(__dirname, "src/db/migrations"),
    }
  }
};

export default config;
