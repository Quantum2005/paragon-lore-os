const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,x-ars40-user"
};

const DEFAULT_AUTH_API_BASE = "https://api-worker.logicalsystems-yt.workers.dev";

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
      created_by TEXT NOT NULL DEFAULT 'SYSTEM',
      updated_by TEXT NOT NULL DEFAULT 'SYSTEM',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
};

const normalizeFilename = (value) => String(value || "").trim();

const validateFilename = (value) => /^[a-zA-Z0-9._-]{1,80}$/.test(value);

const parseBody = async (request) => {
  try {
    return await request.json();
  } catch {
    return {};
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
    return json({ ok: false, message: "D1 binding ars40_db is not configured." }, 500);
  }

  await ensureFileTable(env.ars40_db);

  if (request.method === "GET" && pathname === "/api/files") {
    const rows = await env.ars40_db.prepare(`
      SELECT filename, is_external, external_url, updated_at
      FROM files
      ORDER BY filename COLLATE NOCASE ASC
    `).all();

    return json({ ok: true, files: rows.results || [] });
  }

  if (request.method === "GET" && pathname === "/api/file") {
    const url = new URL(request.url);
    const filename = normalizeFilename(url.searchParams.get("name"));

    if (!validateFilename(filename)) {
      return json({ ok: false, message: "Invalid filename." }, 400);
    }

    const record = await env.ars40_db.prepare(`
      SELECT filename, content, is_external, external_url, updated_at, updated_by
      FROM files
      WHERE filename = ?1
      LIMIT 1
    `).bind(filename).first();

    if (!record) {
      return json({ ok: false, message: "File not found." }, 404);
    }

    return json({ ok: true, file: record });
  }

  if (request.method === "POST" && pathname === "/api/file") {
    const body = await parseBody(request);
    const filename = normalizeFilename(body.filename);
    const actor = getActor(request);
    const mode = String(body.mode || "local").toLowerCase();

    if (!validateFilename(filename)) {
      return json({ ok: false, message: "Filename must be 1-80 chars: a-z, A-Z, 0-9, dot, dash, underscore." }, 400);
    }

    const exists = await env.ars40_db.prepare("SELECT id FROM files WHERE filename = ?1").bind(filename).first();
    if (exists) {
      return json({ ok: false, message: "File already exists." }, 409);
    }

    if (mode === "external") {
      const externalUrl = normalizeUrl(body.externalUrl);
      if (!externalUrl) {
        return json({ ok: false, message: "A valid external URL is required for external mode." }, 400);
      }

      await env.ars40_db.prepare(`
        INSERT INTO files (filename, content, is_external, external_url, created_by, updated_by)
        VALUES (?1, '', 1, ?2, ?3, ?3)
      `).bind(filename, externalUrl, actor).run();

      return json({ ok: true, message: `External link ${filename} created.`, file: { filename, is_external: 1, external_url: externalUrl } });
    }

    const content = String(body.content || "");
    await env.ars40_db.prepare(`
      INSERT INTO files (filename, content, is_external, external_url, created_by, updated_by)
      VALUES (?1, ?2, 0, NULL, ?3, ?3)
    `).bind(filename, content, actor).run();

    return json({ ok: true, message: `File ${filename} created.`, file: { filename, is_external: 0, external_url: null } });
  }

  if (request.method === "PUT" && pathname === "/api/file") {
    const body = await parseBody(request);
    const filename = normalizeFilename(body.filename);

    if (!validateFilename(filename)) {
      return json({ ok: false, message: "Invalid filename." }, 400);
    }

    const existing = await env.ars40_db.prepare(`
      SELECT filename, is_external
      FROM files
      WHERE filename = ?1
      LIMIT 1
    `).bind(filename).first();

    if (!existing) {
      return json({ ok: false, message: "File not found." }, 404);
    }

    if (Number(existing.is_external) === 1) {
      return json({ ok: false, message: "External links cannot be edited locally." }, 409);
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

  return json({ ok: false, message: "Unsupported API route." }, 404);
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
    if (!username || !password) return json({ ok: false, message: "Username and password are required." }, 400);

    const account = await env.ars40_db.prepare(`
      SELECT id, username, password_hash, role, enabled
      FROM accounts
      WHERE username = ?1
      LIMIT 1
    `).bind(username).first();

    if (!account) return json({ ok: true, guest: true, role: "standard", username });
    if (Number(account.enabled) !== 1) return json({ ok: false, message: "Account disabled." }, 403);

    const storedPassword = String(account.password_hash || "");
    const passwordSha = await sha256Hex(password);
    if (password !== storedPassword && passwordSha !== storedPassword) return json({ ok: false, message: "Invalid credentials." }, 401);
    return json({ ok: true, username: account.username, role: account.role || "standard" });
  }

  if (request.method === "POST" && pathname === "/auth/register") {
    const username = String(body?.username || "").trim().toUpperCase();
    const password = String(body?.password || "");
    if (!/^[A-Z0-9_-]{3,20}$/.test(username)) return json({ ok: false, message: "Invalid username format." }, 400);
    if (password.length < 4) return json({ ok: false, message: "Password must be at least 4 characters." }, 400);

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
      if (!result.meta?.changes) return json({ ok: false, message: "Account not found." }, 404);
      return json({ ok: true, id, username });
    } catch {
      return json({ ok: false, message: "Username already exists." }, 409);
    }
  }

  if (request.method === "POST" && pathname === "/auth/admin/update-password") {
    const id = Number(body?.id);
    const password = String(body?.password || "");
    if (!Number.isInteger(id) || id <= 0 || password.length < 4) return json({ ok: false, message: "Invalid id or password." }, 400);

    const result = await env.ars40_db.prepare(`
      UPDATE accounts
      SET password_hash = ?2, updated_at = datetime('now')
      WHERE id = ?1
    `).bind(id, password).run();
    if (!result.meta?.changes) return json({ ok: false, message: "Account not found." }, 404);
    return json({ ok: true, id });
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
    if (url.pathname.startsWith("/auth/")) {
      return routeAuth(request, env, url.pathname);
    }

    if (env.ASSETS?.fetch) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Asset handler unavailable", { status: 500 });
  }
};
