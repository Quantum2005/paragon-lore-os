const REMOTE_BACKEND_URL = "https://api-worker.logicalsystems-yt.workers.dev";
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

const user = (sessionStorage.getItem("ars40:user") || "GUEST").toUpperCase();
const role = (sessionStorage.getItem("ars40:role") || "standard").toLowerCase();
const isModerator = role === "administrator" || role === "manager";

whoami.textContent = `USER ${user} // ROLE ${role.toUpperCase()}`;

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
  const response = await fetchWithBackendFallback(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-ars40-user": user,
      "x-ars40-role": role,
      ...(options.headers || {})
    }
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || `HTTP ${response.status}`);
  }

  return payload;
};

const fmtTime = (isoTime) => {
  const dt = new Date(isoTime);
  if (Number.isNaN(dt.getTime())) return "--:--:--";
  return dt.toISOString().slice(11, 19);
};

const renderMessages = (messages) => {
  chatBody.innerHTML = "";

  for (const message of messages) {
    const row = document.createElement("tr");
    row.className = "message-row";
    row.dataset.messageUid = message.message_uid;
    row.dataset.sender = String(message.sender || "");

    const timeCell = document.createElement("td");
    timeCell.textContent = fmtTime(message.created_at);
    const idCell = document.createElement("td");
    idCell.textContent = String(message.message_uid || "").slice(0, 8);
    const senderCell = document.createElement("td");
    senderCell.textContent = message.sender || "UNKNOWN";
    const messageCell = document.createElement("td");
    messageCell.textContent = message.content || "";
    row.append(timeCell, idCell, senderCell, messageCell);

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
    const payload = await callChatApi("/chat/messages?limit=120", { method: "GET" });
    renderMessages(payload.messages || []);
  } catch (error) {
    setStatus(`LOAD FAILED: ${error.message}`, true);
  }
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const content = messageInput.value.trim();
  if (!content) return;

  try {
    await callChatApi("/chat/messages", {
      method: "POST",
      body: JSON.stringify({ content, channel: "lobby" })
    });
    messageInput.value = "";
    setStatus("MESSAGE SENT", false);
    await loadMessages();
  } catch (error) {
    setStatus(`SEND FAILED: ${error.message}`, true);
  }
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
