import { Database } from "bun:sqlite";
import { accessSync, constants, existsSync, mkdirSync } from "node:fs";
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
  const databaseDirectory = dirname(resolvedDatabasePath);
  databaseFileExistedBeforeOpen = existsSync(resolvedDatabasePath);
  mkdirSync(databaseDirectory, { recursive: true });

  try {
    accessSync(databaseDirectory, constants.W_OK);
  } catch (cause) {
    throw new Error(
      `${databasePathEnvName} directory is not writable: ${databaseDirectory}. ` +
        "If this runs in Docker with a bind mount, make the host directory writable by the container user or use the named volume from docker-compose.yaml.",
      { cause },
    );
  }

  try {
    database = new Database(resolvedDatabasePath, {
      create: true,
      strict: true,
    });
  } catch (cause) {
    throw new Error(`Could not open SQLite database at ${resolvedDatabasePath}. Check file and directory permissions.`, {
      cause,
    });
  }

  database.run("PRAGMA foreign_keys = ON;");
  database.run("PRAGMA journal_mode = WAL;");
  database.run(schema);
  ensureAssetConversionColumns(database);
  ensureAuthTables(database);
  ensureUserColumns(database);

  return database;
}

function ensureUserColumns(db: Database) {
  const columns = db.query("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  const names = new Set(columns.map(column => column.name));

  if (!names.has("api_token")) {
    db.run("ALTER TABLE users ADD COLUMN api_token TEXT NOT NULL DEFAULT '';");
    const users = db.query("SELECT id FROM users").all() as Array<{ id: string }>;
    const updateToken = db.query("UPDATE users SET api_token = $apiToken WHERE id = $id");
    for (const user of users) {
      updateToken.run({ id: user.id, apiToken: `login_tok_${crypto.randomUUID().replaceAll("-", "")}` });
    }
    db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_api_token ON users(api_token);");
  }
  if (!names.has("role")) {
    db.run("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'readonly';");
    db.run("UPDATE users SET role = 'admin' WHERE username = 'admin';");
  }
  if (!names.has("enabled")) {
    db.run("ALTER TABLE users ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;");
  }
}

function ensureAssetConversionColumns(db: Database) {
  const columns = db.query("PRAGMA table_info(assets)").all() as Array<{ name: string }>;
  const names = new Set(columns.map(column => column.name));

  if (!names.has("conversion_status")) {
    db.run("ALTER TABLE assets ADD COLUMN conversion_status TEXT NOT NULL DEFAULT 'ready';");
  }
  if (!names.has("asset_key")) {
    db.run("ALTER TABLE assets ADD COLUMN asset_key TEXT NOT NULL DEFAULT '';");
  }
  if (!names.has("conversion_progress")) {
    db.run("ALTER TABLE assets ADD COLUMN conversion_progress INTEGER NOT NULL DEFAULT 100;");
  }
  if (!names.has("conversion_error")) {
    db.run("ALTER TABLE assets ADD COLUMN conversion_error TEXT NOT NULL DEFAULT '';");
  }
  db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_asset_key ON assets(asset_key) WHERE asset_key <> '';");
}

function ensureAuthTables(db: Database) {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      api_token TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'readonly',
      enabled INTEGER NOT NULL DEFAULT 1,
      must_change_password INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);");
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
