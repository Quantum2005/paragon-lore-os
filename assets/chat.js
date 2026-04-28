const rowsEl = document.getElementById("chatRows");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const statusEl = document.getElementById("status");
const sessionLabel = document.getElementById("sessionLabel");

const moderationMenu = document.getElementById("moderationMenu");
const menuDelete = document.getElementById("menuDelete");
const menuMute = document.getElementById("menuMute");
const menuBan = document.getElementById("menuBan");
const menuMeta = document.getElementById("menuMeta");

const user = (sessionStorage.getItem("ars40:user") || "GUEST").toUpperCase();
const role = (sessionStorage.getItem("ars40:role") || "standard").toLowerCase();
const isModerator = role === "administrator" || role === "manager";
let selectedEntry = null;

const headers = () => ({
  "Content-Type": "application/json",
  "x-ars40-user": user,
  "x-ars40-role": role
});

const setStatus = (text, error = false) => {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", error);
};

const fmtTime = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || "-";
  return d.toISOString().replace("T", " ").slice(0, 19);
};

const closeContextMenu = () => {
  moderationMenu.hidden = true;
  selectedEntry = null;
};

const openContextMenu = (event, entry) => {
  if (!isModerator) return;
  event.preventDefault();
  selectedEntry = entry;
  menuMeta.textContent = `message_id: ${entry.id} | user_id: ${entry.sender_user_id ?? "unknown"}`;
  moderationMenu.style.left = `${event.clientX}px`;
  moderationMenu.style.top = `${event.clientY}px`;
  moderationMenu.hidden = false;
};

const renderRows = (messages) => {
  rowsEl.innerHTML = "";

  if (!messages.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="5">No messages yet. Start the relay.</td>`;
    rowsEl.appendChild(tr);
    return;
  }

  messages.forEach((entry) => {
    const tr = document.createElement("tr");
    tr.className = `chat-row ${isModerator ? "selectable" : ""}`;
    tr.innerHTML = `
      <td>${entry.id}</td>
      <td>${entry.sender_user_id ?? "-"}</td>
      <td>${entry.sender_username}</td>
      <td>${fmtTime(entry.created_at)}</td>
      <td>${String(entry.content || "").replace(/</g, "&lt;")}</td>
    `;
    tr.addEventListener("contextmenu", (event) => openContextMenu(event, entry));
    rowsEl.appendChild(tr);
  });
};

const loadMessages = async () => {
  const response = await fetch("/chat/api/messages?limit=150", { headers: headers() }).catch(() => null);
  if (!response) {
    setStatus("Unable to connect to chat backend.", true);
    return;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    setStatus(payload.message || "Failed to load messages.", true);
    return;
  }

  renderRows(Array.isArray(payload.messages) ? payload.messages : []);
  setStatus(`Relay synced. ${payload.messages.length || 0} message(s) loaded.`);
};

const sendMessage = async () => {
  const content = String(messageInput.value || "").trim();
  if (!content) return;

  const response = await fetch("/chat/api/messages", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ content, senderRole: role, client: "chat-page" })
  }).catch(() => null);

  if (!response) {
    setStatus("Unable to send message.", true);
    return;
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    setStatus(payload.message || "Message rejected.", true);
    return;
  }

  messageInput.value = "";
  setStatus(`Message sent (${payload.message_uid || "ok"}).`);
  await loadMessages();
};

const runModeration = async (action) => {
  if (!selectedEntry) return;

  if (action === "delete") {
    const response = await fetch(`/chat/api/messages/${selectedEntry.id}`, {
      method: "DELETE",
      headers: headers()
    }).catch(() => null);
    const payload = response ? await response.json().catch(() => ({})) : {};
    if (!response || !response.ok || payload.ok === false) {
      setStatus(payload.message || "Delete failed.", true);
      return;
    }
    setStatus(`Deleted message #${selectedEntry.id}.`);
    closeContextMenu();
    await loadMessages();
    return;
  }

  if (!selectedEntry.sender_user_id) {
    setStatus("User ID unavailable for this message.", true);
    closeContextMenu();
    return;
  }

  const reason = window.prompt(`Reason for ${action} (optional):`) || "";
  const muteMinutes = action === "mute" ? Number(window.prompt("Mute duration (minutes):", "30") || 30) : undefined;

  const response = await fetch("/chat/api/moderation", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      action,
      targetUserId: selectedEntry.sender_user_id,
      muteMinutes,
      reason
    })
  }).catch(() => null);

  const payload = response ? await response.json().catch(() => ({})) : {};
  if (!response || !response.ok || payload.ok === false) {
    setStatus(payload.message || `${action} failed.`, true);
    return;
  }

  setStatus(`${action.toUpperCase()} applied to user #${selectedEntry.sender_user_id}.`);
  closeContextMenu();
  await loadMessages();
};

sendBtn.addEventListener("click", () => { void sendMessage(); });
messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void sendMessage();
  }
});

window.addEventListener("click", (event) => {
  if (!moderationMenu.contains(event.target)) closeContextMenu();
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeContextMenu();
});

menuDelete.addEventListener("click", () => { void runModeration("delete"); });
menuMute.addEventListener("click", () => { void runModeration("mute"); });
menuBan.addEventListener("click", () => { void runModeration("ban"); });

sessionLabel.textContent = `USER ${user} | ROLE ${role.toUpperCase()} | ${isModerator ? "MODERATION ENABLED" : "READ/SEND ONLY"}`;
void loadMessages();
setInterval(() => {
  void loadMessages();
}, 5000);
