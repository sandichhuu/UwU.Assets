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

  return database;
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
