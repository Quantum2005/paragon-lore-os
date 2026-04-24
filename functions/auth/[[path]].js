const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,x-ars40-user"
};

const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    ...CORS_HEADERS
  }
});

const parseBody = async (request) => {
  try {
    return await request.json();
  } catch {
    return null;
  }
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
  const bytes = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((part) => part.toString(16).padStart(2, "0")).join("");
};

const routeAuth = async (request, env, pathname) => {
  if (!env.ars40_db) {
    return json({ ok: false, message: "D1 binding ars40_db is not configured." }, 500);
  }

  await ensureAccountsTable(env.ars40_db);
  const body = await parseBody(request);

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

    const hashed = await sha256Hex(password);
    if (hashed !== String(account.password_hash || "")) {
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

    const passwordHash = await sha256Hex(password);
    try {
      const insert = await env.ars40_db.prepare(`
        INSERT INTO accounts (username, password_hash, role, enabled)
        VALUES (?1, ?2, 'standard', 1)
      `).bind(username, passwordHash).run();
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

    const passwordHash = await sha256Hex(password);
    const result = await env.ars40_db.prepare(`
      UPDATE accounts
      SET password_hash = ?2, updated_at = datetime('now')
      WHERE id = ?1
    `).bind(id, passwordHash).run();
    if (!result.meta?.changes) {
      return json({ ok: false, message: "Account not found." }, 404);
    }
    return json({ ok: true, id });
  }

  return json({ ok: false, message: "Unsupported auth route." }, 404);
};

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const { pathname } = new URL(request.url);
  return routeAuth(request, env, pathname);
}
