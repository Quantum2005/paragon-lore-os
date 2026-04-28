const REMOTE_BACKEND_URL = "https://api-worker.logicalsystems-yt.workers.dev";
const CHAT_RETURN_URL = "./ars40-console.html";
const CHAT_CHANNEL = "lobby";

const chatBody = document.getElementById("chatBody");
const whoami = document.getElementById("whoami");
const form = document.getElementById("composer");
const messageInput = document.getElementById("messageInput");
const statusEl = document.getElementById("status");
const modMenu = document.getElementById("modMenu");
const modMessageId = document.getElementById("modMessageId");
const modUserId = document.getElementById("modUserId");

let activeBackendBase = "";
let selectedMessage = null;
let activeNickname = (sessionStorage.getItem("ars40:chatNick") || sessionStorage.getItem("ars40:user") || "GUEST").trim().toUpperCase().slice(0, 20);

const role = (sessionStorage.getItem("ars40:role") || "standard").toLowerCase();
const isModerator = role === "administrator" || role === "manager";

const refreshIdentity = () => {
  whoami.textContent = `USER ${activeNickname} | ROLE ${role.toUpperCase()}${isModerator ? " | MODERATION ENABLED" : ""}`;
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

const callChatApi = async (path, options = {}) => {
  const headers = {
    "x-ars40-user": activeNickname,
    "x-ars40-role": role,
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

const buildVisibleLine = (message) => {
  const sender = String(message.sender || "UNKNOWN");
  const created = fmtTime(message.created_at);
  const content = String(message.content || "");
  return `<${sender}> [${created}] ${content}`;
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
    visibleCell.textContent = buildVisibleLine(message);

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
    const payload = await callChatApi(`/chat/messages?limit=120&channel=${encodeURIComponent(CHAT_CHANNEL)}`, { method: "GET" });
    renderMessages(payload.messages || []);
    setStatus(`ONLINE // ${activeNickname} // ${CHAT_CHANNEL.toUpperCase()}`, false);
  } catch (error) {
    setStatus(`LOAD FAILED: ${error.message}`, true);
  }
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
    return true;
  }

  setStatus(`UNKNOWN COMMAND: /${command || "?"}`, true);
  return true;
};

const sendMessage = async (content) => {
  try {
    await callChatApi("/chat/messages", {
      method: "POST",
      body: JSON.stringify({ content, channel: CHAT_CHANNEL })
    });
    setStatus("MESSAGE SENT", false);
    await loadMessages();
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
}, 5000);

void loadMessages();
