const db = require('../utils/database');
const crypto = require('crypto');
const log = require('../utils/log');
const { API_KEY_STATUS } = require('../constants/index');

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key_hash TEXT NOT NULL UNIQUE,
    key_prefix TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    status TEXT NOT NULL DEFAULT 'active',
    created_by TEXT,
    metadata TEXT,
    expires_at INTEGER,
    last_used_at INTEGER,
    deprecated_at INTEGER,
    revoked_at INTEGER,
    created_at INTEGER NOT NULL,
    rate_limit INTEGER,
    rate_limit_window_seconds INTEGER
  )
`;

async function initializeApiKeysTable() {
  await db.run(CREATE_TABLE_SQL);
}

async function createApiKey({ name, role = 'user', expiresInDays, createdBy, metadata = {}, rateLimit = null, rateLimitWindowSeconds = null }) {
  await initializeApiKeysTable();
  const rawKey = crypto.randomBytes(32).toString('hex');
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.substring(0, 8);
  const now = Date.now();
  const expiresAt = expiresInDays ? now + expiresInDays * 24 * 60 * 60 * 1000 : null;

  const result = await db.run(
    `INSERT INTO api_keys (key_hash, key_prefix, name, role, status, created_by, metadata, expires_at, created_at, rate_limit, rate_limit_window_seconds)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
    [keyHash, keyPrefix, name, role, createdBy || null, JSON.stringify(metadata), expiresAt, now, rateLimit, rateLimitWindowSeconds]
  );

  return {
    id: result.id,
    key: rawKey,
    keyPrefix,
    name,
    role,
    status: API_KEY_STATUS.ACTIVE,
    createdAt: new Date(now).toISOString(),
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    rateLimit,
    rateLimitWindowSeconds,
  };
}

async function validateApiKey(rawKey) {
  await initializeApiKeysTable();
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const now = Date.now();

  const row = await db.get(
    `SELECT * FROM api_keys WHERE key_hash = ?`,
    [keyHash]
  );

  if (!row) return null;
  if (row.status === API_KEY_STATUS.REVOKED) return null;
  if (row.expires_at && row.expires_at < now) return null;

  // Update last_used_at
  await db.run('UPDATE api_keys SET last_used_at = ? WHERE id = ?', [now, row.id]);

  return {
    id: row.id,
    keyPrefix: row.key_prefix,
    name: row.name,
    role: row.role,
    status: row.status,
    isDeprecated: row.status === API_KEY_STATUS.DEPRECATED,
    last_used_at: now,
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
    rateLimit: row.rate_limit || null,
    rateLimitWindowSeconds: row.rate_limit_window_seconds || null,
  };
}

// Alias used by apiKey.js middleware
const validateKey = validateApiKey;

async function listApiKeys(filters = {}) {
  await initializeApiKeysTable();
  let sql = 'SELECT * FROM api_keys WHERE 1=1';
  const params = [];
  if (filters.status) { sql += ' AND status = ?'; params.push(filters.status); }
  if (filters.role) { sql += ' AND role = ?'; params.push(filters.role); }
  sql += ' ORDER BY created_at DESC';

  const rows = await db.all(sql, params);
  return rows.map(row => ({
    id: row.id,
    keyPrefix: row.key_prefix,
    name: row.name,
    role: row.role,
    status: row.status,
    isDeprecated: row.status === API_KEY_STATUS.DEPRECATED,
    last_used_at: row.last_used_at,
    created_at: row.created_at,
    expires_at: row.expires_at,
    deprecated_at: row.deprecated_at,
    revoked_at: row.revoked_at,
  }));
}

async function deprecateApiKey(id) {
  await initializeApiKeysTable();
  const result = await db.run(
    `UPDATE api_keys SET status = 'deprecated', deprecated_at = ? WHERE id = ? AND status = 'active'`,
    [Date.now(), id]
  );
  return result.changes > 0;
}

async function revokeApiKey(id) {
  await initializeApiKeysTable();
  const result = await db.run(
    `UPDATE api_keys SET status = 'revoked', revoked_at = ? WHERE id = ? AND status != 'revoked'`,
    [Date.now(), id]
  );
  return result.changes > 0;
}

async function updateApiKey(id, { rateLimit, rateLimitWindowSeconds }) {
  await initializeApiKeysTable();
  const result = await db.run(
    `UPDATE api_keys SET rate_limit = ?, rate_limit_window_seconds = ? WHERE id = ? AND status != 'revoked'`,
    [rateLimit ?? null, rateLimitWindowSeconds ?? null, id]
  );
  return result.changes > 0;
}

async function cleanupOldKeys(retentionDays = 90) {
  await initializeApiKeysTable();
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const result = await db.run(
    `DELETE FROM api_keys WHERE status = 'revoked' AND revoked_at < ?`,
    [cutoff]
  );
  return result.changes;
}

module.exports = {
  initializeApiKeysTable,
  createApiKey,
  validateApiKey,
  validateKey,
  listApiKeys,
  deprecateApiKey,
  revokeApiKey,
  updateApiKey,
  cleanupOldKeys,
};
