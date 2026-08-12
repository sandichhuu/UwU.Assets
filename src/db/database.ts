import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { schema } from "./schema";

const databasePathEnvName = "SQLITE_DATABASE_PATH";

let database: Database | null = null;
let databaseFileExistedBeforeOpen = false;
let resolvedDatabasePath: string | null = null;

export function getDatabase() {
  if (database) return database;

  const databasePath = Bun.env[databasePathEnvName]?.trim();
  if (!databasePath) {
    throw new Error(`${databasePathEnvName} must be set to a file path before starting the server.`);
  }

  if (databasePath === ":memory:" || databasePath === "") {
    throw new Error(`${databasePathEnvName} must point to a SQLite database file, not an in-memory database.`);
  }

  resolvedDatabasePath = resolve(databasePath);
  databaseFileExistedBeforeOpen = existsSync(resolvedDatabasePath);
  mkdirSync(dirname(resolvedDatabasePath), { recursive: true });

  database = new Database(resolvedDatabasePath, {
    create: true,
    strict: true,
  });

  database.run("PRAGMA foreign_keys = ON;");
  database.run("PRAGMA journal_mode = WAL;");
  database.run(schema);
  ensureAssetConversionColumns(database);

  return database;
}

function ensureAssetConversionColumns(db: Database) {
  const columns = db.query("PRAGMA table_info(assets)").all() as Array<{ name: string }>;
  const names = new Set(columns.map(column => column.name));

  if (!names.has("conversion_status")) {
    db.run("ALTER TABLE assets ADD COLUMN conversion_status TEXT NOT NULL DEFAULT 'ready';");
  }
  if (!names.has("conversion_progress")) {
    db.run("ALTER TABLE assets ADD COLUMN conversion_progress INTEGER NOT NULL DEFAULT 100;");
  }
  if (!names.has("conversion_error")) {
    db.run("ALTER TABLE assets ADD COLUMN conversion_error TEXT NOT NULL DEFAULT '';");
  }
}

export function isFirstDatabaseLaunch() {
  getDatabase();
  return !databaseFileExistedBeforeOpen;
}

export function getDatabasePath() {
  getDatabase();
  if (!resolvedDatabasePath) {
    throw new Error(`${databasePathEnvName} could not be resolved.`);
  }
  return resolvedDatabasePath;
}

export function closeDatabase() {
  database?.close(true);
  database = null;
  databaseFileExistedBeforeOpen = false;
  resolvedDatabasePath = null;
}
