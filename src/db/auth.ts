import { randomUUID } from "node:crypto";
import { getDatabase } from "./database";

export type AuthUser = {
  id: string;
  username: string;
  apiToken: string;
  role: UserRole;
  enabled: boolean;
  mustChangePassword: boolean;
};

export type UserRole = "admin" | "manager" | "readonly";

type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  api_token: string;
  role: UserRole;
  enabled: number;
  must_change_password: number;
};

type SessionRow = {
  session_id: string;
  user_id: string;
  username: string;
  api_token: string;
  role: UserRole;
  enabled: number;
  must_change_password: number;
};

type LoginIpLockRow = {
  ip_address: string;
  failed_attempts: number;
  locked_until: string | null;
};

const db = getDatabase();
const sessionDays = 7;
const defaultUsername = "admin";
const defaultPassword = "admin";

const getUserByUsernameQuery = db.query(`
  SELECT id, username, password_hash, api_token, role, enabled, must_change_password
  FROM users
  WHERE username = $username
`);

const getUserByIdQuery = db.query(`
  SELECT id, username, password_hash, api_token, role, enabled, must_change_password
  FROM users
  WHERE id = $id
`);

const insertUserQuery = db.query(`
  INSERT INTO users (id, username, password_hash, api_token, role, enabled, must_change_password)
  VALUES ($id, $username, $passwordHash, $apiToken, $role, 1, $mustChangePassword)
`);

const listUsersQuery = db.query(`
  SELECT id, username, password_hash, api_token, role, enabled, must_change_password
  FROM users
  ORDER BY
    CASE role WHEN 'admin' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END,
    username COLLATE NOCASE
`);

const deleteUserQuery = db.query(`
  DELETE FROM users
  WHERE id = $id
`);

const updateUserEnabledQuery = db.query(`
  UPDATE users
  SET enabled = $enabled,
      updated_at = datetime('now')
  WHERE id = $id
`);

const updatePasswordQuery = db.query(`
  UPDATE users
  SET password_hash = $passwordHash,
      must_change_password = 0,
      updated_at = datetime('now')
  WHERE id = $id
`);

const updateApiTokenQuery = db.query(`
  UPDATE users
  SET api_token = $apiToken,
      updated_at = datetime('now')
  WHERE id = $id
`);

const insertSessionQuery = db.query(`
  INSERT INTO sessions (id, user_id, expires_at)
  VALUES ($id, $userId, datetime('now', '+${sessionDays} days'))
`);

const getSessionQuery = db.query(`
  SELECT sessions.id AS session_id, users.id AS user_id, users.username, users.api_token, users.role, users.enabled, users.must_change_password
  FROM sessions
  JOIN users ON users.id = sessions.user_id
  WHERE sessions.id = $sessionId
    AND sessions.expires_at > datetime('now')
`);

const deleteSessionQuery = db.query(`
  DELETE FROM sessions
  WHERE id = $sessionId
`);

const deleteExpiredSessionsQuery = db.query(`
  DELETE FROM sessions
  WHERE expires_at <= datetime('now')
`);

const getUserByApiTokenQuery = db.query(`
  SELECT id, username, password_hash, api_token, role, enabled, must_change_password
  FROM users
  WHERE api_token = $apiToken
`);

const getLoginIpLockQuery = db.query(`
  SELECT ip_address, failed_attempts, locked_until
  FROM login_ip_locks
  WHERE ip_address = $ipAddress
`);

const clearLoginIpLockQuery = db.query(`
  DELETE FROM login_ip_locks
  WHERE ip_address = $ipAddress
`);

const upsertFailedLoginIpQuery = db.query(`
  INSERT INTO login_ip_locks (ip_address, failed_attempts, locked_until, last_failed_at, updated_at)
  VALUES ($ipAddress, 1, NULL, datetime('now'), datetime('now'))
  ON CONFLICT(ip_address) DO UPDATE SET
    failed_attempts = CASE
      WHEN login_ip_locks.locked_until IS NOT NULL AND login_ip_locks.locked_until > datetime('now') THEN login_ip_locks.failed_attempts
      WHEN login_ip_locks.last_failed_at <= datetime('now', '-1 hour') THEN 1
      ELSE login_ip_locks.failed_attempts + 1
    END,
    locked_until = CASE
      WHEN login_ip_locks.locked_until IS NOT NULL AND login_ip_locks.locked_until > datetime('now') THEN login_ip_locks.locked_until
      WHEN (
        CASE
          WHEN login_ip_locks.last_failed_at <= datetime('now', '-1 hour') THEN 1
          ELSE login_ip_locks.failed_attempts + 1
        END
      ) >= 10 THEN datetime('now', '+1 hour')
      ELSE NULL
    END,
    last_failed_at = datetime('now'),
    updated_at = datetime('now')
`);

function createApiToken() {
  return `login_tok_${randomUUID().replaceAll("-", "")}`;
}

export async function ensureDefaultAdminUser() {
  const existing = getUserByUsername(defaultUsername);
  if (existing) return existing;

  const passwordHash = await Bun.password.hash(defaultPassword);
  insertUserQuery.run({
    id: `usr-${randomUUID()}`,
    username: defaultUsername,
    passwordHash,
    apiToken: createApiToken(),
    role: "admin",
    mustChangePassword: 1,
  });
  return getUserByUsername(defaultUsername);
}

export function listUsers() {
  return (listUsersQuery.all() as UserRow[]).map(mapUser);
}

export async function createUser(username: string, password: string, role: Exclude<UserRole, "admin">) {
  const passwordHash = await Bun.password.hash(password);
  insertUserQuery.run({
    id: `usr-${randomUUID()}`,
    username,
    passwordHash,
    apiToken: createApiToken(),
    role,
    mustChangePassword: 0,
  });
  return getUserByUsername(username);
}

export function getUserById(userId: string) {
  const row = getUserByIdQuery.get({ id: userId }) as UserRow | null;
  return row ? mapUser(row) : null;
}

export function deleteUser(userId: string) {
  return deleteUserQuery.run({ id: userId }).changes > 0;
}

export function updateUserEnabled(userId: string, enabled: boolean) {
  updateUserEnabledQuery.run({ id: userId, enabled: enabled ? 1 : 0 });
  return getUserById(userId);
}

export function getUserByUsername(username: string) {
  const row = getUserByUsernameQuery.get({ username }) as UserRow | null;
  return row ? mapUser(row) : null;
}

export function getUserByApiToken(apiToken: string) {
  const row = getUserByApiTokenQuery.get({ apiToken }) as UserRow | null;
  return row ? mapUser(row) : null;
}

export function getUserPasswordHash(userId: string) {
  const row = getUserByIdQuery.get({ id: userId }) as UserRow | null;
  return row?.password_hash ?? null;
}

export async function verifyUserPassword(username: string, password: string) {
  const row = getUserByUsernameQuery.get({ username }) as UserRow | null;
  if (!row) return null;
  if (!row.enabled) return null;
  const valid = await Bun.password.verify(password, row.password_hash);
  return valid ? mapUser(row) : null;
}

export function getLoginIpLock(ipAddress: string) {
  const row = getLoginIpLockQuery.get({ ipAddress }) as LoginIpLockRow | null;
  if (!row?.locked_until) return null;

  const lockedUntil = new Date(`${row.locked_until}Z`);
  if (Number.isNaN(lockedUntil.getTime()) || lockedUntil <= new Date()) {
    clearLoginIpLock(ipAddress);
    return null;
  }

  return {
    failedAttempts: row.failed_attempts,
    lockedUntil: lockedUntil.toISOString(),
  };
}

export function recordFailedLoginIp(ipAddress: string) {
  upsertFailedLoginIpQuery.run({ ipAddress });
  return getLoginIpLock(ipAddress);
}

export function clearLoginIpLock(ipAddress: string) {
  clearLoginIpLockQuery.run({ ipAddress });
}

export async function updateUserPassword(userId: string, password: string) {
  const passwordHash = await Bun.password.hash(password);
  updatePasswordQuery.run({ id: userId, passwordHash });
  const row = getUserByIdQuery.get({ id: userId }) as UserRow | null;
  return row ? mapUser(row) : null;
}

export function regenerateUserApiToken(userId: string) {
  updateApiTokenQuery.run({ id: userId, apiToken: createApiToken() });
  return getUserById(userId);
}

export function createSession(userId: string) {
  deleteExpiredSessionsQuery.run({});
  const id = `ses-${randomUUID()}`;
  insertSessionQuery.run({ id, userId });
  return id;
}

export function getSessionUser(sessionId: string) {
  const row = getSessionQuery.get({ sessionId }) as SessionRow | null;
  return row
    ? {
        id: row.user_id,
        username: row.username,
        apiToken: row.api_token,
        role: row.role,
        enabled: Boolean(row.enabled),
        mustChangePassword: Boolean(row.must_change_password),
      }
    : null;
}

export function deleteSession(sessionId: string) {
  return deleteSessionQuery.run({ sessionId }).changes > 0;
}

function mapUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    username: row.username,
    apiToken: row.api_token,
    role: row.role,
    enabled: Boolean(row.enabled),
    mustChangePassword: Boolean(row.must_change_password),
  };
}
