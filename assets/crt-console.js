const bootOutput = document.getElementById("bootOutput");
const consoleOutput = document.getElementById("consoleOutput");
const promptRow = document.getElementById("promptRow");
const pathLabel = document.getElementById("pathLabel");
const consoleInput = document.getElementById("consoleInput");
const status = document.getElementById("status");

// Auth API is served through same-origin proxy route to avoid cross-origin failures.
const ACCOUNTS_API_URL = "/auth";
// Next page to open on successful login (GitHub Pages-friendly relative path).
const NEXT_FILE_URL = "./ars40-console.html";

const bootLines = [
  { text: "[SYS ] RESTART REQUEST ACCEPTED......OK", hold: 160 },
  { text: "[SYS ] STOPPING ACTIVE TASKS.........COMPLETE", hold: 220 },
  { text: "[SYS ] FLUSHING SESSION CACHE........COMPLETE", hold: 240 },
  { text: "[BOOT] HANDOFF TO LDOS BOOTLDR.......COMPLETE", hold: 180 },
  { text: "[BOOT] REINITIALIZING DEVICE TABLE...OK", hold: 180 },
  { text: "[BOOT] RELOADING NETWORK STACK........OK", hold: 180 },
  { text: "[APP ] STARTING CONSOLE KERNEL.......READY", hold: 620 },
  { text: "[APP ] STARTING BTN LINK MODULE......READY", hold: 680 },
  { text: "[APP ] STARTING AUTHENTICATION.......READY", hold: 740 },
  { text: "[APP ] LOADING CONSOLE...............READY", hold: 760 },
  { text: "[MSG ] RESTART COMPLETE / STANDBY", hold: 180 }
];

const greetingLines = [
  { text: "LDoS 5.1 (C) 19XX TERMINAL SUBSYSTEM", hold: 140 },
  { text: "NODE: #ops-main / BAUD: 14400", hold: 180 },
  { text: "AUTH ONLINE.................READY", hold: 700 },
  { text: "", hold: 80 },
  { text: "Please enter your USERNAME and press [ENTER].", hold: 120 }
];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const authenticate = async (username, password) => {
  const response = await fetch(`${ACCOUNTS_API_URL}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    if (response.status === 401) {
      return { ok: false, code: "BAD_PASSWORD", message: payload.message || "Invalid credentials." };
    }

    if (response.status === 403) {
      return { ok: false, code: "DISABLED", message: payload.message || "Account disabled." };
    }

    return { ok: false, code: "AUTH_FAILED", message: payload.message || "Authentication failed." };
  }

  if (payload.guest) {
    return {
      ok: true,
      code: "GUEST_SESSION",
      message: "Account not found in registry. Entering guest mode.",
      role: "standard",
      username
    };
  }

  const role = String(payload.role || "standard").toLowerCase();
  return { ok: true, code: "AUTH_OK", message: "Authentication accepted.", role, username };
};

const proceedToNextFile = () => {
  window.location.href = NEXT_FILE_URL;
};

const addLine = (container, text) => {
  const line = document.createElement("div");
  line.className = "line";
  line.textContent = text;
  container.appendChild(line);
  container.scrollTop = container.scrollHeight;
  return line;
};

const typeLine = (container, text, speed = 18) => {
  return new Promise((resolve) => {
    let i = 0;
    const line = addLine(container, "");

    const tick = () => {
      const typed = text.slice(0, i);
      line.innerHTML = `${typed}<span class="typing-cursor">█</span>`;
      i += 1;
      if (i <= text.length) {
        setTimeout(tick, speed);
      } else {
        line.textContent = text;
        resolve();
      }
    };

    tick();
  });
};

const wipeBootLinesBackwards = () => {
  return new Promise((resolve) => {
    const lines = Array.from(bootOutput.querySelectorAll(".line"));
    const totalChars = lines.reduce((sum, line) => sum + line.textContent.length, 0) || 1;
    const charDelay = Math.max(1, Math.floor(1900 / totalChars));

    const eraseTick = () => {
      const activeLines = bootOutput.querySelectorAll(".line");
      const lastLine = activeLines[activeLines.length - 1];

      if (!lastLine) {
        resolve();
        return;
      }

      if (lastLine.textContent.length > 0) {
        lastLine.textContent = lastLine.textContent.slice(0, -1);
        setTimeout(eraseTick, charDelay);
        return;
      }

      lastLine.remove();
      setTimeout(eraseTick, 0);
    };

    eraseTick();
  });
};

const showStatus = (message, isError = true) => {
  status.textContent = message;
  status.style.color = isError ? "var(--error)" : "var(--fg)";
  status.classList.add("show");
};

const clearStatus = () => {
  status.textContent = "";
  status.classList.remove("show");
};

const state = {
  stage: "username",
  username: "",
  rawUsername: ""
};

const logsDebug = {
  panel: null,
  body: null,
  timer: null
};

const pushDebugLine = (text) => {
  if (!logsDebug.body) return;
  const stamp = new Date().toLocaleTimeString();
  const row = document.createElement("div");
  row.className = "debug-row";
  row.textContent = `[${stamp}] ${text}`;
  logsDebug.body.appendChild(row);
  logsDebug.body.scrollTop = logsDebug.body.scrollHeight;
};

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
};

const pollDebugStatus = async () => {
  if (!logsDebug.panel) return;
  try {
    const authDebug = await fetchJson(`${ACCOUNTS_API_URL}/debug`);
    if (authDebug.response.ok && authDebug.payload.ok) {
      const accounts = authDebug.payload?.db?.accounts;
      const files = authDebug.payload?.db?.files;
      pushDebugLine(`AUTH DEBUG OK | accounts=${accounts} files=${files ?? "N/A"}`);
    } else {
      pushDebugLine(`AUTH DEBUG FAIL | status=${authDebug.response.status}`);
    }
  } catch (_error) {
    pushDebugLine("AUTH DEBUG FAIL | request error");
  }

  try {
    const filesProbe = await fetchJson("/api/files");
    if (filesProbe.response.ok) {
      const count = Array.isArray(filesProbe.payload?.files) ? filesProbe.payload.files.length : 0;
      pushDebugLine(`FILES API OK | count=${count}`);
    } else {
      pushDebugLine(`FILES API FAIL | status=${filesProbe.response.status}`);
    }
  } catch (_error) {
    pushDebugLine("FILES API FAIL | request error");
  }
};

const enablePanelDrag = (panel, handle) => {
  let startX = 0;
  let startY = 0;
  let moving = false;

  const onMove = (event) => {
    if (!moving) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    const nextLeft = panel.offsetLeft + dx;
    const nextTop = panel.offsetTop + dy;
    panel.style.left = `${Math.max(6, nextLeft)}px`;
    panel.style.top = `${Math.max(6, nextTop)}px`;
    startX = event.clientX;
    startY = event.clientY;
  };

  const onUp = () => {
    moving = false;
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  };

  handle.addEventListener("mousedown", (event) => {
    event.preventDefault();
    moving = true;
    startX = event.clientX;
    startY = event.clientY;
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
};

const closeLogsPanel = () => {
  if (logsDebug.timer) {
    clearInterval(logsDebug.timer);
    logsDebug.timer = null;
  }
  if (logsDebug.panel) {
    logsDebug.panel.remove();
    logsDebug.panel = null;
    logsDebug.body = null;
  }
};

const openLogsPanel = async () => {
  if (logsDebug.panel) {
    pushDebugLine("PANEL ALREADY OPEN");
    return;
  }

  const panel = document.createElement("section");
  panel.className = "logs-debug-panel";
  panel.innerHTML = `
    <header class="logs-debug-header">
      <span class="logs-debug-title">AUTH/DB LIVE DIAGNOSTICS</span>
      <button type="button" class="logs-debug-close" aria-label="Close logs panel">X</button>
    </header>
    <div class="logs-debug-body"></div>
  `;

  document.body.appendChild(panel);
  logsDebug.panel = panel;
  logsDebug.body = panel.querySelector(".logs-debug-body");
  const closeBtn = panel.querySelector(".logs-debug-close");
  const header = panel.querySelector(".logs-debug-header");

  closeBtn.addEventListener("click", closeLogsPanel);
  enablePanelDrag(panel, header);
  pushDebugLine("DIAGNOSTICS PANEL OPENED");
  pushDebugLine("CHECKING AUTH/API HEALTH...");
  await pollDebugStatus();
  logsDebug.timer = setInterval(pollDebugStatus, 2500);
};

const beginConsole = async (skipIntro = false) => {
  bootOutput.style.display = "none";
  consoleOutput.classList.add("show");

  if (!skipIntro) {
    for (const entry of greetingLines) {
      await typeLine(consoleOutput, entry.text, 14 + Math.floor(Math.random() * 13));
      await wait(entry.hold);
    }
  } else {
    addLine(consoleOutput, "SESSION RESTORED FROM LOGOUT.");
    addLine(consoleOutput, "Enter USERNAME and press [ENTER].");
  }

  promptRow.classList.add("show");
  consoleInput.focus();
};

const bootSequence = async () => {
  const fastResume = new URLSearchParams(window.location.search).get("resume") === "1";
  if (fastResume) {
    await beginConsole(true);
    return;
  }

  await wait(1300);

  for (const entry of bootLines) {
    await typeLine(bootOutput, entry.text, 10 + Math.floor(Math.random() * 14));
    await wait(entry.hold);
  }

  await wait(140);
  await wipeBootLinesBackwards();
  await wait(120);
  beginConsole();
};

consoleInput.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  clearStatus();

  const value = consoleInput.value.trim();
  if (!value) {
    showStatus("INPUT REQUIRED.");
    return;
  }

  if (state.stage === "username") {
    state.rawUsername = value;
    state.username = value.toUpperCase();
    pathLabel.textContent = `C://${state.username}`;

    await typeLine(consoleOutput, `USERNAME ACCEPTED: ${state.username}`, 10);
    await typeLine(consoleOutput, "Please enter your PASSWORD and press [ENTER].", 10);

    state.stage = "password";
    consoleInput.value = "";
    consoleInput.type = "password";
    return;
  }

  const masked = "*".repeat(Math.max(6, value.length));
  await typeLine(consoleOutput, `PASSWORD: ${masked}`, 10);
  await typeLine(consoleOutput, `AUTH REQUEST SENT FOR ${state.username}...`, 10);
  showStatus("VERIFYING WITH AUTH SERVICE...", false);

  if (state.rawUsername === "openLogs" && value === "Logs123") {
    await typeLine(consoleOutput, "LOG DIAGNOSTICS ACCESS GRANTED", 10);
    showStatus("LOG PANEL OPENED. DRAG HEADER TO MOVE. CLICK X TO CLOSE.", false);
    await openLogsPanel();
    consoleInput.value = "";
    consoleInput.type = "text";
    state.stage = "username";
    state.username = "";
    state.rawUsername = "";
    pathLabel.textContent = "C://CONSOLE";
    await typeLine(consoleOutput, "Please enter your USERNAME and press [ENTER].", 10);
    return;
  }

  try {
    const result = await authenticate(state.username, value);

    if (result.ok) {
      if (result.code === "GUEST_SESSION") {
        await typeLine(consoleOutput, `GUEST ACCESS GRANTED: ${state.username}`, 10);
        await typeLine(consoleOutput, "NOTICE: GUEST ACCOUNT ACTIVE (STANDARD MODE)", 10);
      } else {
        await typeLine(consoleOutput, `ACCESS GRANTED: ${state.username}`, 10);
      }
      const recentLines = Array.from(consoleOutput.querySelectorAll(".line"))
        .slice(-8)
        .map((line) => line.textContent)
        .filter(Boolean);
      sessionStorage.setItem("ars40:lastLines", JSON.stringify(recentLines));
      sessionStorage.setItem("ars40:user", state.username);
      sessionStorage.setItem("ars40:role", result.role || "standard");
      await wait(260);
      proceedToNextFile();
      return;
    }

    if (result.code === "BAD_PASSWORD") {
      await typeLine(consoleOutput, "ACCESS DENIED: INCORRECT PASSWORD", 10);
      showStatus("INCORRECT PASSWORD. TRY AGAIN.");
      consoleInput.value = "";
      consoleInput.type = "password";
      state.stage = "password";
      return;
    }

    await typeLine(consoleOutput, `ACCESS DENIED: ${result.message || "AUTH FAILED"}`, 10);
    showStatus((result.message || "AUTH FAILED").toUpperCase());
  } catch (error) {
    await typeLine(consoleOutput, "ACCESS DENIED: AUTHENTICATION SERVER UNAVAILABLE", 10);
    showStatus("AUTH SERVICE UNAVAILABLE - TRY AGAIN LATER.");
  }

  consoleInput.value = "";
  consoleInput.type = "text";
  state.stage = "username";
  state.username = "";
  state.rawUsername = "";
  pathLabel.textContent = "C://CONSOLE";
  await typeLine(consoleOutput, "", 10);
  await typeLine(consoleOutput, "Please enter your USERNAME and press [ENTER].", 10);
});

bootSequence();
