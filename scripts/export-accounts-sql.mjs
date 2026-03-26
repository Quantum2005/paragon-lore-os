#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const INPUT_PATH = new URL('../accounts.json', import.meta.url);
const OUTPUT_PATH = new URL('./seed-accounts.sql', import.meta.url);

const decodeB64 = (value) => Buffer.from(String(value || ''), 'base64').toString('utf8');
const escapeSql = (value) => String(value).replace(/'/g, "''");
const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');

const payload = JSON.parse(await readFile(INPUT_PATH, 'utf8'));
const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];

const lines = [
  '-- Generated from accounts.json for Cloudflare D1 import',
  'CREATE TABLE IF NOT EXISTS accounts (',
  '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
  '  username TEXT NOT NULL UNIQUE,',
  '  password_hash TEXT NOT NULL,',
  "  role TEXT NOT NULL DEFAULT 'standard',",
  '  enabled INTEGER NOT NULL DEFAULT 1,',
  "  created_at TEXT NOT NULL DEFAULT (datetime('now'))",
  ');',
  ''
];

for (const account of accounts) {
  const username = decodeB64(account.username_b64).trim().toUpperCase();
  const password = decodeB64(account.password_b64);
  if (!username || !password) continue;

  const enabled = account.enabled === false ? 0 : 1;
  const role = String(account.role || 'standard').toLowerCase();
  const hash = sha256(password);

  lines.push(
    `INSERT INTO accounts (username, password_hash, role, enabled) VALUES ('${escapeSql(username)}', '${hash}', '${escapeSql(role)}', ${enabled}) ` +
    `ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash, role=excluded.role, enabled=excluded.enabled;`
  );
}

await writeFile(OUTPUT_PATH, `${lines.join('\n')}\n`, 'utf8');
console.log(`Wrote ${accounts.length} account record(s) to ${OUTPUT_PATH.pathname}`);
console.log('Run: npx wrangler d1 execute ars40_db --remote --file=./scripts/seed-accounts.sql');
