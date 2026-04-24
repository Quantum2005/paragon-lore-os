import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 3000);
const ACCOUNTS_PATH = path.join(__dirname, "accounts.json");

app.use(express.json());
app.use(express.static(__dirname));

const normalizeUsername = (value) => String(value || "").trim().toUpperCase();

const loadAccounts = async () => {
  const raw = await fs.readFile(ACCOUNTS_PATH, "utf8");
  const payload = JSON.parse(raw);
  const list = Array.isArray(payload.accounts) ? payload.accounts : [];
  return { payload, list };
};

const decode = (value) => Buffer.from(String(value || ""), "base64").toString("utf8");
const encode = (value) => Buffer.from(String(value || ""), "utf8").toString("base64");
const sha256Hex = (value) => createHash("sha256").update(String(value || "")).digest("hex");

app.get("/auth/debug", async (_req, res) => {
  const { list } = await loadAccounts();
  res.json({
    ok: true,
    service: "auth-debug",
    timestamp: new Date().toISOString(),
    db: {
      accounts: list.length
    }
  });
});

app.post("/auth/login", async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || "");
  if (!username || !password) {
    res.status(400).json({ ok: false, message: "Username and password are required." });
    return;
  }

  const { list } = await loadAccounts();
  const account = list.find((entry) => normalizeUsername(decode(entry.username_b64)) === username);
  if (!account) {
    res.json({ ok: true, guest: true, role: "standard", username });
    return;
  }

  if (!account.enabled) {
    res.status(403).json({ ok: false, message: "Account disabled." });
    return;
  }

  const decoded = decode(account.password_b64);
  if (decoded !== password && decoded !== sha256Hex(password)) {
    res.status(401).json({ ok: false, message: "Invalid credentials." });
    return;
  }

  res.json({ ok: true, username, role: String(account.role || "standard").toLowerCase() });
});

app.post("/auth/register", async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || "");
  if (!/^[A-Z0-9_-]{3,20}$/.test(username)) {
    res.status(400).json({ ok: false, message: "Invalid username format." });
    return;
  }
  if (password.length < 4) {
    res.status(400).json({ ok: false, message: "Password must be at least 4 characters." });
    return;
  }

  const { payload, list } = await loadAccounts();
  const exists = list.some((entry) => normalizeUsername(decode(entry.username_b64)) === username);
  if (exists) {
    res.status(409).json({ ok: false, message: "Username already exists." });
    return;
  }

  list.push({
    username_b64: encode(username),
    password_b64: encode(password),
    enabled: true,
    role: "standard"
  });
  payload.accounts = list;
  await fs.writeFile(ACCOUNTS_PATH, JSON.stringify(payload, null, 2) + "\n", "utf8");

  res.status(201).json({ ok: true, username, role: "standard" });
});

app.post("/auth/admin/update-username", async (req, res) => {
  const id = Number(req.body?.id);
  const username = normalizeUsername(req.body?.username);
  if (!Number.isInteger(id) || id <= 0 || !/^[A-Z0-9_-]{3,20}$/.test(username)) {
    res.status(400).json({ ok: false, message: "Invalid id or username." });
    return;
  }

  const { payload, list } = await loadAccounts();
  const index = id - 1;
  if (!list[index]) {
    res.status(404).json({ ok: false, message: "Account not found." });
    return;
  }

  const duplicate = list.some((entry, idx) => idx !== index && normalizeUsername(decode(entry.username_b64)) === username);
  if (duplicate) {
    res.status(409).json({ ok: false, message: "Username already exists." });
    return;
  }

  list[index].username_b64 = encode(username);
  payload.accounts = list;
  await fs.writeFile(ACCOUNTS_PATH, JSON.stringify(payload, null, 2) + "\n", "utf8");
  res.json({ ok: true, id, username });
});

app.post("/auth/admin/update-password", async (req, res) => {
  const id = Number(req.body?.id);
  const password = String(req.body?.password || "");
  if (!Number.isInteger(id) || id <= 0 || password.length < 4) {
    res.status(400).json({ ok: false, message: "Invalid id or password." });
    return;
  }

  const { payload, list } = await loadAccounts();
  const index = id - 1;
  if (!list[index]) {
    res.status(404).json({ ok: false, message: "Account not found." });
    return;
  }

  list[index].password_b64 = encode(password);
  payload.accounts = list;
  await fs.writeFile(ACCOUNTS_PATH, JSON.stringify(payload, null, 2) + "\n", "utf8");
  res.json({ ok: true, id });
});

app.post("/auth/admin/elevate", async (req, res) => {
  const id = Number(req.body?.id);
  const requestedRole = String(req.body?.role || "").trim().toLowerCase();
  const actorRole = String(req.headers["x-ars40-role"] || "standard").trim().toLowerCase();
  const allowedRoles = actorRole === "manager"
    ? ["administrator", "editor", "standard"]
    : actorRole === "administrator"
      ? ["editor", "standard"]
      : actorRole === "editor"
        ? ["standard"]
        : [];

  if (!allowedRoles.length) {
    res.status(403).json({ ok: false, message: "Insufficient role for elevate." });
    return;
  }
  if (!Number.isInteger(id) || id <= 0 || !allowedRoles.includes(requestedRole)) {
    res.status(400).json({ ok: false, message: `Invalid role. ${actorRole} may only elevate to ${allowedRoles.join(", ")}.` });
    return;
  }

  const { payload, list } = await loadAccounts();
  const index = id - 1;
  if (!list[index]) {
    res.status(404).json({ ok: false, message: "Account not found." });
    return;
  }

  list[index].role = requestedRole;
  payload.accounts = list;
  await fs.writeFile(ACCOUNTS_PATH, JSON.stringify(payload, null, 2) + "\n", "utf8");
  res.json({ ok: true, id, role: requestedRole });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
