const REMOTE_BACKEND_URL = "https://api-worker.logicalsystems-yt.workers.dev";
const CHAT_RETURN_URL = "./ars40-console.html";

const chatBody = document.getElementById("chatBody");
const whoami = document.getElementById("whoami");
const channelLabel = document.getElementById("channelLabel");
const form = document.getElementById("composer");
const messageInput = document.getElementById("messageInput");
const statusEl = document.getElementById("status");
const inboxStatusEl = document.getElementById("inboxStatus");
const modMenu = document.getElementById("modMenu");
const toastEl = document.getElementById("toast");
const modMessageId = document.getElementById("modMessageId");
const modUserId = document.getElementById("modUserId");

let activeBackendBase = "";
let selectedMessage = null;
let activeChannel = "lobby";
let activeNickname = (sessionStorage.getItem("ars40:chatNick") || sessionStorage.getItem("ars40:user") || "GUEST").trim().toUpperCase().slice(0, 20);
const persistentUserId = (() => {
  const saved = localStorage.getItem("ars40:chatUserId");
  if (saved && /^[a-f0-9-]{8,40}$/i.test(saved)) return saved;
  const next = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`).toLowerCase();
  localStorage.setItem("ars40:chatUserId", next);
  return next;
})();

const role = (sessionStorage.getItem("ars40:role") || "standard").toLowerCase();
const isModerator = role === "administrator" || role === "manager";

const refreshIdentity = () => {
  const channelTag = activeChannel.startsWith("@") ? `DM ${activeChannel}` : `#${activeChannel.toUpperCase()}`;
  whoami.textContent = `USER ${activeNickname} [${persistentUserId.slice(0,8)}] | ROLE ${role.toUpperCase()}${isModerator ? " | MODERATION ENABLED" : ""}`;
  channelLabel.textContent = `INTERCHAT RELAY NETWORK // CHANNEL ${channelTag}`;
};

refreshIdentity();

const backendCandidates = () => {
  const list = [activeBackendBase, "", REMOTE_BACKEND_URL]
    .map((value) => String(value || "").replace(/\/+$/, ""))
    .filter((value, index, arr) => arr.indexOf(value) === index);
  return list;
};

const fetchWithBackendFallback = async (path, options = {}) => {
  let lastResponse = null;

  for (const base of backendCandidates()) {
    const response = await fetch(`${base}${path}`, options).catch(() => null);
    if (!response) continue;

    lastResponse = response;
    if (response.status !== 404 && response.status !== 405) {
      activeBackendBase = base;
      return response;
    }
  }

  if (lastResponse) return lastResponse;
  throw new Error(`No reachable backend for ${path}`);
};

const setStatus = (message, error = false) => {
  statusEl.textContent = message;
  statusEl.style.color = error ? "var(--error)" : "var(--fg)";
};

const showToast = (message) => { if (!toastEl) return; toastEl.textContent = message; toastEl.hidden = false; clearTimeout(showToast._t); showToast._t=setTimeout(()=>{toastEl.hidden=true;}, 2600); };

const setInboxStatus = (message) => {
  inboxStatusEl.textContent = message;
};

const callChatApi = async (path, options = {}) => {
  const headers = {
    "x-ars40-user": activeNickname,
    "x-ars40-role": role,
    "x-ars40-user-id": persistentUserId,
    ...(options.headers || {})
  };

  if (options.body) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetchWithBackendFallback(path, {
    ...options,
    headers
  });

  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : { message: await response.text().catch(() => "") };

  if (!response.ok || payload.ok === false) {
    const code = payload.code ? ` (${payload.code})` : "";
    const message = payload.message || `HTTP ${response.status}`;
    throw new Error(`${message}${code}`.trim());
  }

  return payload;
};

const fmtTime = (isoTime) => {
  const dt = new Date(isoTime);
  if (Number.isNaN(dt.getTime())) return "--:--:--";
  return dt.toISOString().slice(11, 19);
};

const normalizeChannel = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "lobby";
  if (raw.startsWith("@")) {
    const peer = raw.slice(1).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 20);
    return peer ? `@${peer}` : "lobby";
  }
  return raw.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40) || "lobby";
};

const escapeHtml = (v) => String(v||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const linkify = (text) => escapeHtml(text).replace(/(https?:\/\/[^\s<]+)/gi, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
const roleClass = (roleName) => ({administrator:"role-administrator",manager:"role-manager",system:"role-system"}[String(roleName||"").toLowerCase()]||"");
const mentionRegex = /@([A-Z0-9_-]{3,20}|everyone|local)/gi;
const buildVisibleLine = (message) => {
  const sender = String(message.sender || "UNKNOWN");
  const created = fmtTime(message.created_at);
  const content = String(message.content || "");
  const channelTag = String(message.channel || "").toLowerCase() === "dm"
    ? `DM:${message.recipient ? `@${String(message.recipient).toUpperCase()}` : "DIRECT"}`
    : `#${String(message.channel || "lobby").toUpperCase()}`;
  return `<${sender}> [${created}] ${channelTag} ${content}`;
};

const renderMessages = (messages) => {
  chatBody.innerHTML = "";

  for (const message of messages) {
    const row = document.createElement("tr");
    row.className = "message-row";
    row.dataset.messageUid = String(message.message_uid || "");
    row.dataset.sender = String(message.sender || "");

    const hiddenSenderCell = document.createElement("td");
    hiddenSenderCell.className = "meta-cell";
    hiddenSenderCell.textContent = String(message.sender || "");

    const hiddenTimeCell = document.createElement("td");
    hiddenTimeCell.className = "meta-cell";
    hiddenTimeCell.textContent = fmtTime(message.created_at);

    const visibleCell = document.createElement("td");
    const mine = activeNickname.toUpperCase();
    const mentions = String(message.content||"").match(mentionRegex) || [];
    if (mentions.some((m) => { const t=m.slice(1).toUpperCase(); return t===mine || t==="EVERYONE" || (t==="LOCAL" && String(message.channel||"").toLowerCase()===String(activeChannel).replace("@", "dm")); })) { row.classList.add("mention-highlight"); }
    row.classList.add(roleClass(message.sender_role_snapshot));
    visibleCell.innerHTML = buildVisibleLine(message).replace(escapeHtml(String(message.content||"")), linkify(String(message.content||"")));

    row.append(hiddenSenderCell, hiddenTimeCell, visibleCell);

    if (isModerator) {
      row.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        selectedMessage = message;
        modMessageId.textContent = message.message_uid;
        modUserId.textContent = message.sender;
        modMenu.style.left = `${event.clientX}px`;
        modMenu.style.top = `${event.clientY}px`;
        modMenu.hidden = false;
      });
    }

    chatBody.appendChild(row);
  }

  chatBody.parentElement.scrollTop = chatBody.parentElement.scrollHeight;
};

const loadMessages = async () => {
  try {
    const payload = await callChatApi(`/chat/messages?limit=120&channel=${encodeURIComponent(activeChannel)}`, { method: "GET" });
    renderMessages(payload.messages || []);
    refreshIdentity();
    setStatus(`ONLINE // ${activeNickname} // ${activeChannel.startsWith("@") ? activeChannel : `#${activeChannel.toUpperCase()}`}`, false);
  } catch (error) {
    setStatus(`LOAD FAILED: ${error.message}`, true);
  }
};

const loadInbox = async () => {
  try {
    const payload = await callChatApi("/chat/inbox?unread=1", { method: "GET" });
    const unread = payload.inbox || [];
    if (!unread.length) {
      setInboxStatus("INBOX: 0 unread");
      return;
    }

    setInboxStatus(`INBOX: ${unread.length} unread | latest from ${unread[0].sender} at ${fmtTime(unread[0].created_at)}`);
  } catch {
    setInboxStatus("INBOX: unavailable");
  }
};

const markInboxRead = async (entries) => {
  const messageUids = entries.map((row) => row.message_uid).filter(Boolean);
  if (!messageUids.length) return;
  await callChatApi("/chat/inbox/read", {
    method: "POST",
    body: JSON.stringify({ messageUids })
  });
};

const runCommand = async (rawInput) => {
  const [cmd, ...args] = rawInput.slice(1).trim().split(/\s+/);
  const command = String(cmd || "").toLowerCase();

  if (command === "exit") {
    setStatus("EXITING RELAY...", false);
    setTimeout(() => {
      window.location.href = CHAT_RETURN_URL;
    }, 120);
    return true;
  }

  if (command === "reload") {
    await loadMessages();
    await loadInbox();
    return true;
  }

  if (command === "nick") {
    const nextNickname = args.join(" ").trim().toUpperCase().slice(0, 20);
    if (!nextNickname) {
      setStatus("USAGE: /nick <new_name>", true);
      return true;
    }

    activeNickname = nextNickname;
    sessionStorage.setItem("ars40:chatNick", activeNickname);
    refreshIdentity();
    setStatus(`NICK CHANGED TO ${activeNickname}`, false);
    await loadMessages();
    return true;
  }

  if (command === "join") {
    const nextChannel = normalizeChannel(args.join(" "));
    activeChannel = nextChannel;
    refreshIdentity();
    await loadMessages();
    return true;
  }

  if (command === "msg") {
    const target = normalizeChannel(`@${args[0] || ""}`);
    const messageText = args.slice(1).join(" ").trim();
    if (!target.startsWith("@") || !messageText) {
      setStatus("USAGE: /msg <user> <message>", true);
      return true;
    }

    await sendMessage(messageText, target);
    return true;
  }


  if (command === "announce" || command === "ping") {
    const text = args.join(" ").trim();
    if (!text) { setStatus(`USAGE: /${command} <message>`, true); return true; }
    await sendMessage(`@everyone [${command.toUpperCase()}] ${text}`, "lobby");
    return true;
  }

  if (command === "inbox") {
    const payload = await callChatApi("/chat/inbox?unread=1", { method: "GET" });
    const entries = payload.inbox || [];
    if (!entries.length) {
      setStatus("INBOX EMPTY", false);
      return true;
    }

    const preview = entries.slice(0, 5).map((row) => `<${row.sender}> [${fmtTime(row.created_at)}] ${row.content}`).join(" | ");
    setStatus(`INBOX ${entries.length}: ${preview}`, false);
    await markInboxRead(entries);
    await loadInbox();
    return true;
  }

  setStatus(`UNKNOWN COMMAND: /${command || "?"}`, true);
  return true;
};

let blockedTerms = [];
const loadBlockedTerms = async () => {
  try {
    const res = await fetch("./assets/en.txt", { cache: "no-store" });
    if (!res.ok) return;
    const text = await res.text();
    blockedTerms = text.split(/\r?\n/).map((v) => v.trim().toLowerCase()).filter(Boolean);
  } catch {}
};
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const maskBlocked = (txt) => { let blocked=[]; let out=txt; for (const w of blockedTerms){ const re=new RegExp(`\\b${escapeRegExp(w)}\\b`,"gi"); if (re.test(out)){ blocked.push(w); out=out.replace(re, (m)=>"*".repeat(m.length)); } } return {out,blocked}; };

const sendMessage = async (content, overrideChannel = null) => {
  try {
    const channel = overrideChannel || activeChannel;
    const filtered = maskBlocked(content);
    if (filtered.blocked.length) { showToast(`Blocked term(s): ${Array.from(new Set(filtered.blocked)).join(", ")}`); }
    await callChatApi("/chat/messages", {
      method: "POST",
      body: JSON.stringify({ content: filtered.out, channel })
    });
    setStatus(`MESSAGE SENT ${channel.startsWith("@") ? channel : `#${channel.toUpperCase()}`}`, false);
    await loadMessages();
    await loadInbox();
  } catch (error) {
    setStatus(`SEND FAILED: ${error.message}`, true);
  }
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = messageInput.value.trim();
  if (!input) return;
  messageInput.value = "";

  if (input.startsWith("/")) {
    await runCommand(input);
    return;
  }

  await sendMessage(input);
});

modMenu.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;

  const action = button.dataset.action;
  if (action === "close") {
    modMenu.hidden = true;
    return;
  }

  if (!selectedMessage || !isModerator) {
    setStatus("MODERATION ERROR: NO SELECTED MESSAGE", true);
    modMenu.hidden = true;
    return;
  }

  const reason = prompt(`Optional reason for ${action}:`, "") || "";

  try {
    if (action === "delete") {
      await callChatApi("/chat/moderation", {
        method: "POST",
        body: JSON.stringify({ action: "delete", messageUid: selectedMessage.message_uid, reason })
      });
    } else if (action === "mute" || action === "ban") {
      await callChatApi("/chat/moderation", {
        method: "POST",
        body: JSON.stringify({ action, targetUsername: selectedMessage.sender, reason })
      });
    }

    setStatus(`ACTION COMPLETE: ${action.toUpperCase()}`, false);
    modMenu.hidden = true;
    await loadMessages();
    await loadInbox();
  } catch (error) {
    setStatus(`ACTION FAILED: ${error.message}`, true);
    modMenu.hidden = true;
  }
});

window.addEventListener("click", (event) => {
  if (!modMenu.hidden && !modMenu.contains(event.target)) {
    modMenu.hidden = true;
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    modMenu.hidden = true;
  }
});

setInterval(() => {
  void loadMessages();
  void loadInbox();
}, 7000);

void loadBlockedTerms();
void loadMessages();
void loadInbox();

if (!isModerator) { modMenu.hidden = true; }
