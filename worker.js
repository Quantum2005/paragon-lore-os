const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,x-ars40-user,x-ars40-role"
};

const ERROR_CODES = {
  BINDING_MISSING: "E_BINDING_MISSING",
  INVALID_FILENAME: "E_INVALID_FILENAME",
  FILE_NOT_FOUND: "E_FILE_NOT_FOUND",
  FILE_EXISTS: "E_FILE_EXISTS",
  INVALID_EXTERNAL_URL: "E_INVALID_EXTERNAL_URL",
  EXTERNAL_READONLY: "E_EXTERNAL_READONLY",
  FILE_LOCKED: "E_FILE_LOCKED",
  BAD_JSON: "E_BAD_JSON",
  UNSUPPORTED_ROUTE: "E_UNSUPPORTED_ROUTE"
};

const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    ...CORS_HEADERS
  }
});

const ensureFileTable = async (db) => {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL DEFAULT '',
      is_external INTEGER NOT NULL DEFAULT 0,
      external_url TEXT,
      is_locked INTEGER NOT NULL DEFAULT 0,
      lock_password TEXT,
      created_by TEXT NOT NULL DEFAULT 'SYSTEM',
      updated_by TEXT NOT NULL DEFAULT 'SYSTEM',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
  await db.prepare("ALTER TABLE files ADD COLUMN is_locked INTEGER NOT NULL DEFAULT 0").run().catch(() => {});
  await db.prepare("ALTER TABLE files ADD COLUMN lock_password TEXT").run().catch(() => {});
};


const ensureDemoFiles = async (db) => {
  await db.batch([
    db.prepare(`
      INSERT INTO files (filename, content, is_external, external_url, created_by, updated_by)
      VALUES ('youtube.mp4', '', 1, 'https://samplelib.com/lib/preview/mp4/sample-5s.mp4', 'SYSTEM', 'SYSTEM')
      ON CONFLICT(filename) DO NOTHING
    `),
    db.prepare(`
      INSERT INTO files (filename, content, is_external, external_url, created_by, updated_by)
      VALUES ('wikipedia.txt', '', 1, 'https://en.wikipedia.org/wiki/Main_Page', 'SYSTEM', 'SYSTEM')
      ON CONFLICT(filename) DO NOTHING
    `),
    db.prepare(`
      INSERT INTO files (filename, content, is_external, external_url, created_by, updated_by)
      VALUES ('gyazo.jpg', '', 1, 'https://gyazo.com/64cbbfe5734d5368d7317139bd438d6d', 'SYSTEM', 'SYSTEM')
      ON CONFLICT(filename) DO NOTHING
    `)
  ]);
};

const normalizeFilename = (value) => String(value || "").trim();

const validateFilename = (value) => /^[a-zA-Z0-9._-]{1,80}$/.test(value);

const parseBody = async (request) => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

const getActor = (request) => {
  const raw = request.headers.get("x-ars40-user") || "SYSTEM";
  return String(raw).trim().toUpperCase().slice(0, 40) || "SYSTEM";
};

const normalizeUrl = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return parsed.toString();
  } catch {
    return "";
  }
};

const routeApi = async (request, env, pathname) => {
  if (!env.ars40_db) {
    return json({ ok: false, code: ERROR_CODES.BINDING_MISSING, message: "D1 binding ars40_db is not configured." }, 500);
  }

  await ensureFileTable(env.ars40_db);
  await ensureDemoFiles(env.ars40_db);

  if (request.method === "GET" && pathname === "/api/files") {
    const rows = await env.ars40_db.prepare(`
      SELECT filename, is_external, external_url, is_locked, updated_at
      FROM files
      ORDER BY filename COLLATE NOCASE ASC
    `).all();

    return json({ ok: true, files: rows.results || [] });
  }

  if (request.method === "GET" && pathname === "/api/file") {
    const url = new URL(request.url);
    const filename = normalizeFilename(url.searchParams.get("name"));
    const filePassword = String(url.searchParams.get("password") || "").trim();

    if (!validateFilename(filename)) {
      return json({ ok: false, code: ERROR_CODES.INVALID_FILENAME, message: "Invalid filename." }, 400);
    }

    const record = await env.ars40_db.prepare(`
      SELECT filename, content, is_external, external_url, is_locked, lock_password, updated_at, updated_by
      FROM files
      WHERE filename = ?1
      LIMIT 1
    `).bind(filename).first();

    if (!record) {
      return json({ ok: false, code: ERROR_CODES.FILE_NOT_FOUND, message: "File not found." }, 404);
    }

    if (Number(record.is_locked) === 1 && filePassword !== String(record.lock_password || "")) {
      return json({ ok: false, code: ERROR_CODES.FILE_LOCKED, message: "File is locked and requires password." }, 403);
    }

    const { lock_password, ...safeRecord } = record;
    return json({ ok: true, file: safeRecord });
  }

  if (request.method === "POST" && pathname === "/api/file") {
    const body = await parseBody(request);
    if (!body) {
      return json({ ok: false, code: ERROR_CODES.BAD_JSON, message: "Malformed JSON payload." }, 400);
    }
    const filename = normalizeFilename(body.filename);
    const actor = getActor(request);
    const mode = String(body.mode || "local").toLowerCase();
    const lockEnabled = Boolean(body.lock);
    const lockPassword = String(body.lockPassword || "");
    if (lockEnabled && !lockPassword) {
      return json({ ok: false, code: ERROR_CODES.BAD_JSON, message: "Lock password required when lock is enabled." }, 400);
    }

    if (!validateFilename(filename)) {
      return json({ ok: false, code: ERROR_CODES.INVALID_FILENAME, message: "Filename must be 1-80 chars: a-z, A-Z, 0-9, dot, dash, underscore." }, 400);
    }

    const exists = await env.ars40_db.prepare("SELECT id FROM files WHERE filename = ?1").bind(filename).first();
    if (exists) {
      return json({ ok: false, code: ERROR_CODES.FILE_EXISTS, message: "File already exists." }, 409);
    }

    if (mode === "external") {
      const externalUrl = normalizeUrl(body.externalUrl);
      if (!externalUrl) {
        return json({ ok: false, code: ERROR_CODES.INVALID_EXTERNAL_URL, message: "A valid external URL is required for external mode." }, 400);
      }

      await env.ars40_db.prepare(`
        INSERT INTO files (filename, content, is_external, external_url, is_locked, lock_password, created_by, updated_by)
        VALUES (?1, '', 1, ?2, ?3, ?4, ?5, ?5)
      `).bind(filename, externalUrl, lockEnabled ? 1 : 0, lockEnabled ? lockPassword : null, actor).run();

      return json({ ok: true, message: `External link ${filename} created.`, file: { filename, is_external: 1, external_url: externalUrl, is_locked: lockEnabled ? 1 : 0 } });
    }

    const content = String(body.content || "");
    await env.ars40_db.prepare(`
      INSERT INTO files (filename, content, is_external, external_url, is_locked, lock_password, created_by, updated_by)
      VALUES (?1, ?2, 0, NULL, ?3, ?4, ?5, ?5)
    `).bind(filename, content, lockEnabled ? 1 : 0, lockEnabled ? lockPassword : null, actor).run();

    return json({ ok: true, message: `File ${filename} created.`, file: { filename, is_external: 0, external_url: null, is_locked: lockEnabled ? 1 : 0 } });
  }

  if (request.method === "PUT" && pathname === "/api/file") {
    const body = await parseBody(request);
    if (!body) {
      return json({ ok: false, code: ERROR_CODES.BAD_JSON, message: "Malformed JSON payload." }, 400);
    }
    const filename = normalizeFilename(body.filename);

    if (!validateFilename(filename)) {
      return json({ ok: false, code: ERROR_CODES.INVALID_FILENAME, message: "Invalid filename." }, 400);
    }

    const existing = await env.ars40_db.prepare(`
      SELECT filename, is_external, is_locked, lock_password
      FROM files
      WHERE filename = ?1
      LIMIT 1
    `).bind(filename).first();

    if (!existing) {
      return json({ ok: false, code: ERROR_CODES.FILE_NOT_FOUND, message: "File not found." }, 404);
    }

    if (Number(existing.is_external) === 1) {
      return json({ ok: false, code: ERROR_CODES.EXTERNAL_READONLY, message: "External links cannot be edited locally." }, 409);
    }

    if (Number(existing.is_locked) === 1) {
      const suppliedPassword = String(body.lockPassword || "");
      if (suppliedPassword !== String(existing.lock_password || "")) {
        return json({ ok: false, code: ERROR_CODES.FILE_LOCKED, message: "File is locked and requires password." }, 403);
      }
    }

    const content = String(body.content || "");
    const actor = getActor(request);

    await env.ars40_db.prepare(`
      UPDATE files
      SET content = ?2, updated_by = ?3, updated_at = datetime('now')
      WHERE filename = ?1
    `).bind(filename, content, actor).run();

    return json({ ok: true, message: `Saved ${filename}.` });
  }

  return json({ ok: false, code: ERROR_CODES.UNSUPPORTED_ROUTE, message: "Unsupported API route." }, 404);
};

const ensureAccountsTable = async (db) => {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'standard',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
};

const sha256Hex = async (value) => {
  const data = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((n) => n.toString(16).padStart(2, "0")).join("");
};


const ROLE_WEIGHT = { standard: 0, editor: 1, administrator: 2, manager: 3 };

const canModerateChat = (role) => Number(ROLE_WEIGHT[String(role || "standard").toLowerCase()] || 0) >= 2;

const ensureChatTables = async (db) => {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS chat_users (
      user_id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'standard',
      status TEXT NOT NULL DEFAULT 'active',
      muted_until TEXT,
      banned_at TEXT,
      note TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_uid TEXT NOT NULL UNIQUE,
      sender_user_id INTEGER,
      sender_username TEXT NOT NULL,
      sender_role TEXT NOT NULL DEFAULT 'standard',
      content TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      channel TEXT NOT NULL DEFAULT 'global',
      ip_hash TEXT,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(sender_user_id) REFERENCES chat_users(user_id)
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS chat_moderation_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action_type TEXT NOT NULL,
      target_user_id INTEGER,
      target_username TEXT,
      target_message_id INTEGER,
      reason TEXT,
      created_by TEXT NOT NULL,
      created_by_role TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
};

const cryptoRandomId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `msg-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
};

const upsertChatUser = async (db, username, role) => {
  await db.prepare(`
    INSERT INTO chat_users (username, role, updated_at)
    VALUES (?1, ?2, datetime('now'))
    ON CONFLICT(username) DO UPDATE SET
      role = excluded.role,
      updated_at = datetime('now')
  `).bind(username, role).run();

  return db.prepare(`
    SELECT user_id, username, role, status, muted_until, banned_at
    FROM chat_users
    WHERE username = ?1
    LIMIT 1
  `).bind(username).first();
};

const routeChatApi = async (request, env, pathname) => {
  if (!env.chat_db) {
    return json({ ok: false, message: "D1 binding chat_db is not configured." }, 500);
  }

  await ensureChatTables(env.chat_db);

  if (request.method === "GET" && pathname === "/chat/api/messages") {
    const url = new URL(request.url);
    const limitRaw = Number(url.searchParams.get("limit") || 80);
    const limit = Math.min(200, Math.max(10, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 80));

    const rows = await env.chat_db.prepare(`
      SELECT id, message_uid, sender_user_id, sender_username, sender_role, content, metadata_json, channel, created_at
      FROM chat_messages
      WHERE is_deleted = 0
      ORDER BY id DESC
      LIMIT ?1
    `).bind(limit).all();

    const messages = (rows.results || []).reverse().map((row) => ({
      ...row,
      metadata: (() => {
        try { return JSON.parse(String(row.metadata_json || "{}")); } catch { return {}; }
      })()
    }));

    return json({ ok: true, messages });
  }

  if (request.method === "POST" && pathname === "/chat/api/messages") {
    const body = await parseBody(request);
    const actor = getActor(request);
    const actorRole = String(request.headers.get("x-ars40-role") || body?.senderRole || "standard").trim().toLowerCase();
    const content = String(body?.content || "").trim();
    if (!content || content.length > 2000) {
      return json({ ok: false, message: "Message content must be between 1 and 2000 characters." }, 400);
    }

    const user = await upsertChatUser(env.chat_db, actor, actorRole);
    if (String(user?.status || "active") === "banned" || user?.banned_at) {
      return json({ ok: false, code: "E_CHAT_BANNED", message: "You are banned from chat." }, 403);
    }
    if (user?.muted_until) {
      const mutedUntilMs = Date.parse(String(user.muted_until));
      if (!Number.isNaN(mutedUntilMs) && mutedUntilMs > Date.now()) {
        return json({ ok: false, code: "E_CHAT_MUTED", message: `Muted until ${user.muted_until}.` }, 403);
      }
    }

    const messageUid = cryptoRandomId();
    const metadata = JSON.stringify({ source: "ars40-chat", client: String(body?.client || "web") });

    await env.chat_db.prepare(`
      INSERT INTO chat_messages (message_uid, sender_user_id, sender_username, sender_role, content, metadata_json, channel, ip_hash)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
    `).bind(
      messageUid,
      user?.user_id || null,
      actor,
      actorRole,
      content,
      metadata,
      String(body?.channel || "global"),
      await sha256Hex(request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || "")
    ).run();

    return json({ ok: true, message_uid: messageUid });
  }

  if (request.method === "DELETE" && /^\/chat\/api\/messages\/\d+$/.test(pathname)) {
    const role = String(request.headers.get("x-ars40-role") || "standard").trim().toLowerCase();
    const actor = getActor(request);
    if (!canModerateChat(role)) {
      return json({ ok: false, message: "Administrator role or higher required." }, 403);
    }

    const id = Number(pathname.split("/").pop());
    const found = await env.chat_db.prepare("SELECT id, sender_user_id, sender_username FROM chat_messages WHERE id = ?1 LIMIT 1").bind(id).first();
    if (!found) {
      return json({ ok: false, message: "Message not found." }, 404);
    }

    await env.chat_db.prepare("UPDATE chat_messages SET is_deleted = 1, updated_at = datetime('now') WHERE id = ?1").bind(id).run();
    await env.chat_db.prepare(`
      INSERT INTO chat_moderation_actions (action_type, target_user_id, target_username, target_message_id, reason, created_by, created_by_role)
      VALUES ('delete', ?1, ?2, ?3, ?4, ?5, ?6)
    `).bind(found.sender_user_id || null, found.sender_username, id, "manual delete", actor, role).run();

    return json({ ok: true, deleted_message_id: id, target_user_id: found.sender_user_id, target_username: found.sender_username });
  }

  if (request.method === "POST" && pathname === "/chat/api/moderation") {
    const role = String(request.headers.get("x-ars40-role") || "standard").trim().toLowerCase();
    const actor = getActor(request);
    if (!canModerateChat(role)) {
      return json({ ok: false, message: "Administrator role or higher required." }, 403);
    }

    const body = await parseBody(request);
    const action = String(body?.action || "").trim().toLowerCase();
    const targetUserId = Number(body?.targetUserId);
    const reason = String(body?.reason || "").slice(0, 500);
    if (!["mute", "ban"].includes(action) || !Number.isInteger(targetUserId) || targetUserId <= 0) {
      return json({ ok: false, message: "Invalid moderation action payload." }, 400);
    }

    const target = await env.chat_db.prepare("SELECT user_id, username FROM chat_users WHERE user_id = ?1 LIMIT 1").bind(targetUserId).first();
    if (!target) {
      return json({ ok: false, message: "Target user not found." }, 404);
    }

    if (action === "mute") {
      const minutes = Math.min(7 * 24 * 60, Math.max(1, Number(body?.muteMinutes) || 30));
      await env.chat_db.prepare(`
        UPDATE chat_users
        SET muted_until = datetime('now', ?2), status = 'active', updated_at = datetime('now'), note = ?3
        WHERE user_id = ?1
      `).bind(targetUserId, `+${minutes} minutes`, reason || `Muted by ${actor}`).run();
      await env.chat_db.prepare(`
        INSERT INTO chat_moderation_actions (action_type, target_user_id, target_username, reason, created_by, created_by_role)
        VALUES ('mute', ?1, ?2, ?3, ?4, ?5)
      `).bind(target.user_id, target.username, reason || `Muted for ${minutes} minutes`, actor, role).run();
      return json({ ok: true, action: "mute", target_user_id: target.user_id, target_username: target.username, mute_minutes: minutes });
    }

    await env.chat_db.prepare(`
      UPDATE chat_users
      SET status = 'banned', banned_at = datetime('now'), muted_until = NULL, updated_at = datetime('now'), note = ?2
      WHERE user_id = ?1
    `).bind(targetUserId, reason || `Banned by ${actor}`).run();
    await env.chat_db.prepare(`
      INSERT INTO chat_moderation_actions (action_type, target_user_id, target_username, reason, created_by, created_by_role)
      VALUES ('ban', ?1, ?2, ?3, ?4, ?5)
    `).bind(target.user_id, target.username, reason || "Banned", actor, role).run();

    return json({ ok: true, action: "ban", target_user_id: target.user_id, target_username: target.username });
  }

  return json({ ok: false, message: "Unsupported chat route." }, 404);
};

const routeAuth = async (request, env, pathname) => {
  if (!env.ars40_db) {
    return json({ ok: false, message: "D1 binding ars40_db is not configured." }, 500);
  }

  await ensureAccountsTable(env.ars40_db);
  const body = await parseBody(request);

  if (request.method === "GET" && pathname === "/auth/debug") {
    const accountsCount = await env.ars40_db.prepare("SELECT COUNT(*) AS count FROM accounts").first();
    const filesCount = await env.ars40_db.prepare("SELECT COUNT(*) AS count FROM files").first().catch(() => ({ count: null }));
    return json({
      ok: true,
      service: "auth-debug",
      timestamp: new Date().toISOString(),
      db: {
        accounts: Number(accountsCount?.count || 0),
        files: filesCount?.count === null ? null : Number(filesCount?.count || 0)
      }
    });
  }

  if (request.method === "POST" && pathname === "/auth/login") {
    const username = String(body?.username || "").trim().toUpperCase();
    const password = String(body?.password || "");
    if (!username || !password) {
      return json({ ok: false, message: "Username and password are required." }, 400);
    }

    const account = await env.ars40_db.prepare(`
      SELECT id, username, password_hash, role, enabled
      FROM accounts
      WHERE username = ?1
      LIMIT 1
    `).bind(username).first();

    if (!account) {
      return json({ ok: true, guest: true, role: "standard", username });
    }

    if (Number(account.enabled) !== 1) {
      return json({ ok: false, message: "Account disabled." }, 403);
    }

    const storedPassword = String(account.password_hash || "");
    const passwordSha = await sha256Hex(password);
    if (password !== storedPassword && passwordSha !== storedPassword) {
      return json({ ok: false, message: "Invalid credentials." }, 401);
    }

    return json({ ok: true, username: account.username, role: account.role || "standard" });
  }

  if (request.method === "POST" && pathname === "/auth/register") {
    const username = String(body?.username || "").trim().toUpperCase();
    const password = String(body?.password || "");

    if (!/^[A-Z0-9_-]{3,20}$/.test(username)) {
      return json({ ok: false, message: "Invalid username format." }, 400);
    }
    if (password.length < 4) {
      return json({ ok: false, message: "Password must be at least 4 characters." }, 400);
    }

    try {
      const insert = await env.ars40_db.prepare(`
        INSERT INTO accounts (username, password_hash, role, enabled)
        VALUES (?1, ?2, 'standard', 1)
      `).bind(username, password).run();
      return json({ ok: true, id: insert.meta?.last_row_id || null, username, role: "standard" }, 201);
    } catch {
      return json({ ok: false, message: "Username already exists." }, 409);
    }
  }

  if (request.method === "POST" && pathname === "/auth/admin/update-username") {
    const id = Number(body?.id);
    const username = String(body?.username || "").trim().toUpperCase();
    if (!Number.isInteger(id) || id <= 0 || !/^[A-Z0-9_-]{3,20}$/.test(username)) {
      return json({ ok: false, message: "Invalid id or username." }, 400);
    }

    try {
      const result = await env.ars40_db.prepare(`
        UPDATE accounts
        SET username = ?2, updated_at = datetime('now')
        WHERE id = ?1
      `).bind(id, username).run();
      if (!result.meta?.changes) {
        return json({ ok: false, message: "Account not found." }, 404);
      }
      return json({ ok: true, id, username });
    } catch {
      return json({ ok: false, message: "Username already exists." }, 409);
    }
  }

  if (request.method === "POST" && pathname === "/auth/admin/update-password") {
    const id = Number(body?.id);
    const password = String(body?.password || "");
    if (!Number.isInteger(id) || id <= 0 || password.length < 4) {
      return json({ ok: false, message: "Invalid id or password." }, 400);
    }

    const result = await env.ars40_db.prepare(`
      UPDATE accounts
      SET password_hash = ?2, updated_at = datetime('now')
      WHERE id = ?1
    `).bind(id, password).run();
    if (!result.meta?.changes) {
      return json({ ok: false, message: "Account not found." }, 404);
    }
    return json({ ok: true, id });
  }

  if (request.method === "POST" && pathname === "/auth/admin/elevate") {
    const id = Number(body?.id);
    const requestedRole = String(body?.role || "").trim().toLowerCase();
    const actorRole = String(request.headers.get("x-ars40-role") || "standard").trim().toLowerCase();
    const allowedRoles = actorRole === "manager"
      ? ["administrator", "editor", "standard"]
      : actorRole === "administrator"
        ? ["editor", "standard"]
        : actorRole === "editor"
          ? ["standard"]
          : [];

    if (!allowedRoles.length) {
      return json({ ok: false, message: "Insufficient role for elevate." }, 403);
    }
    if (!Number.isInteger(id) || id <= 0 || !allowedRoles.includes(requestedRole)) {
      return json({ ok: false, message: `Invalid role. ${actorRole} may only elevate to ${allowedRoles.join(", ")}.` }, 400);
    }

    const result = await env.ars40_db.prepare(`
      UPDATE accounts
      SET role = ?2, updated_at = datetime('now')
      WHERE id = ?1
    `).bind(id, requestedRole).run();
    if (!result.meta?.changes) {
      return json({ ok: false, message: "Account not found." }, 404);
    }
    return json({ ok: true, id, role: requestedRole });
  }

  return json({ ok: false, message: "Unsupported auth route." }, 404);
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return routeApi(request, env, url.pathname);
    }
    if (url.pathname.startsWith("/chat/api/")) {
      return routeChatApi(request, env, url.pathname);
    }
    if (url.pathname.startsWith("/auth/")) {
      return routeAuth(request, env, url.pathname);
    }

    if (env.ASSETS?.fetch) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Asset handler unavailable", { status: 500 });
  }
};
