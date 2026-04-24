    const output = document.getElementById("consoleOutput");
    const promptRow = document.getElementById("promptRow");
    const pathLabel = document.getElementById("pathLabel");
    const consoleInput = document.getElementById("consoleInput");
    const status = document.getElementById("status");
    const poweroffFade = document.getElementById("poweroffFade");

    const POWER_OFF_URL = "./index.html";
    const LOGIN_URL = "./crt-console.html?resume=1";
    const EDITOR_URL = "./editor.html";
    const TOUCH_VIEWER_URL = "./touch-viewer.html";
    const REMOTE_BACKEND_URL = "https://api-worker.logicalsystems-yt.workers.dev";
    const ACCOUNTS_API_URL = "/auth";
    const FILES_API_URL = "/api";
    let activeBackendBase = "";
    const API_ERROR_MEANINGS = {
      E_BINDING_MISSING: "Database binding missing in runtime.",
      E_INVALID_FILENAME: "Filename is invalid. Allowed: a-z A-Z 0-9 . _ -",
      E_FILE_NOT_FOUND: "Requested file does not exist.",
      E_FILE_EXISTS: "A file with this name already exists.",
      E_INVALID_EXTERNAL_URL: "External link URL is invalid.",
      E_EXTERNAL_READONLY: "External link records cannot be edited as local text.",
      E_FILE_LOCKED: "File is locked and requires password.",
      E_BAD_JSON: "Backend received malformed JSON payload.",
      E_UNSUPPORTED_ROUTE: "Unsupported API route/method.",
      E_API_UNAVAILABLE: "API endpoint unavailable or returned non-JSON."
    };
    const user = sessionStorage.getItem("ars40:user") || "GUEST";
    const role = (sessionStorage.getItem("ars40:role") || "standard").toLowerCase();

    const roleAllowed = new Set(["standard", "editor", "administrator", "manager"]);
    const activeRole = roleAllowed.has(role) ? role : "standard";

    pathLabel.textContent = `ARS40://${user}`;

    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "bmp", "webp", "avif", "svg"]);
    const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "avi", "mkv", "m4v"]);
    const TEXT_EXTENSIONS = new Set(["txt", "md", "log", "rtf", "csv", "json", "xml", "html", "htm"]);

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

    const addLine = (text) => {
      const line = document.createElement("div");
      line.className = "line";
      line.textContent = text;
      output.appendChild(line);
      output.scrollTop = output.scrollHeight;
      return line;
    };

    const typeLine = (text, speed = 12) => new Promise((resolve) => {
      const line = addLine("");
      let i = 0;

      const tick = () => {
        line.innerHTML = `${text.slice(0, i)}<span class="typing-cursor">█</span>`;
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

    const showStatus = (message, error = false) => {
      status.textContent = message;
      status.style.color = error ? "var(--error)" : "var(--fg)";
      status.classList.add("show");
    };

    const clearStatus = () => {
      status.textContent = "";
      status.classList.remove("show");
    };
    let pendingInputHandler = null;

    const requestConsoleInput = (question, options, handler) => {
      const hidden = Boolean(options?.hidden);
      pendingInputHandler = { handler, hidden };
      addLine(question);
      showStatus("AWAITING INPUT...", false);
      consoleInput.type = hidden ? "password" : "text";
      consoleInput.focus();
    };

    const logo = [
"   _____ __________       __________  __  ___   ______  ___  ______________  _   __     ",
"  / ___// ____/ __ \\     / ____/ __ \\/ / / / | / / __ \\/   |/_  __/  _/ __ \\/ | / /     ",
"  \\__ \\/ /   / /_/ /    / /_  / / / / / / /  |/ / / / / /| | / /  / // / / /  |/ /      ",
" ___/ / /___/ ____/    / __/ / /_/ / /_/ / /|  / /_/ / ___ |/ / _/ // /_/ / /|  /       ",
"/____/\\____/_/        /_/    \\____/\\____/_/ |_/_____/_/  |_/_/ /___/\\____/_/ |_/        ",
                                                                                   
"                        PARAGON RESEARCH INSTITUTE (ARS-40) CONSOLE                     "
    ];

    const printHelp = () => {
      addLine("AVAILABLE COMMANDS:");
      addLine("  help   - Display this command reference.");
      addLine("  clear  - Clear visible console history.");
      addLine("  logout - Log out of your account.");
      addLine("  exit   - Exit the Console and power off the machine.");
      addLine("  files               - List files stored in D1.");
      addLine("  type <filename>     - Display full file contents.");
      addLine("  more <filename>     - Display first 25 lines.");
      addLine("  edit <filename>     - Open integrated text editor.");
      addLine("  touch <filename>    - Open read-only file viewer.");
      addLine("  create <filename>                    - Create local text file.");
      addLine("  create <filename> --link <url>       - Create external link file.");
      addLine("  errors              - List API error codes and meanings.");
      if (activeRole === "administrator" || activeRole === "manager") {
        addLine("  goto <url> - Navigate to a specified URL (administrator/manager).");
        addLine("  register <user> <pass> - Create registry account (administrator/manager).");
        addLine("  setuser <id> <user> - Change username by DB id (administrator/manager).");
        addLine("  setpass <id> <pass> - Change password by DB id (administrator/manager).");
      }
      if (activeRole === "administrator" || activeRole === "manager" || activeRole === "editor") {
        addLine("  elevate <id> <role> - Promote a user one level below your role.");
      }
      addLine(`CURRENT ROLE: ${activeRole.toUpperCase()}`);
      addLine("SECURITY NOTICE: Do not reuse real-world passwords. Demo environment only.");
      addLine("REGISTER NOTE: New accounts are created immediately via auth service.");
    };

    const printErrorCodes = () => {
      addLine("API ERROR CODES:");
      Object.entries(API_ERROR_MEANINGS).forEach(([code, meaning]) => {
        addLine(`  ${code} - ${meaning}`);
      });
    };

    const createApiError = (payload, status) => {
      const error = new Error(payload?.message || `HTTP ${status}`);
      error.code = payload?.code || "E_API_UNAVAILABLE";
      error.status = status;
      return error;
    };

    const formatApiError = (error, fallbackPrefix = "API ERROR") => {
      const code = String(error?.code || "E_API_UNAVAILABLE").toUpperCase();
      const meaning = API_ERROR_MEANINGS[code] || "Unexpected API failure.";
      const detail = String(error?.message || meaning).toUpperCase();
      return `${fallbackPrefix} [${code}] ${detail} - ${meaning.toUpperCase()}`;
    };

    const callApi = async (path, options = {}) => {
      const headers = {
        "Content-Type": "application/json",
        "x-ars40-user": String(user).toUpperCase(),
        ...(options.headers || {})
      };

      const response = await fetchWithBackendFallback(`${FILES_API_URL}${path}`, {
        ...options,
        headers
      });

      const contentType = response.headers.get("content-type") || "";
      let payload = {};
      if (contentType.includes("application/json")) {
        payload = await response.json().catch(() => ({}));
      } else {
        const raw = await response.text().catch(() => "");
        payload = { code: "E_API_UNAVAILABLE", message: raw ? `Unexpected response: ${raw.slice(0, 120)}` : "API unavailable." };
      }

      if (!response.ok || payload.ok === false) {
        throw createApiError(payload, response.status);
      }
      return payload;
    };

    const callAuthApi = async (path, body, extraHeaders = {}) => {
      const response = await fetchWithBackendFallback(`${ACCOUNTS_API_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...extraHeaders },
        body: JSON.stringify(body || {})
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        throw createApiError(payload, response.status);
      }
      return payload;
    };

    const readFile = async (filename, password = "") => {
      const suffix = password ? `&password=${encodeURIComponent(password)}` : "";
      const payload = await callApi(`/file?name=${encodeURIComponent(filename)}${suffix}`, { method: "GET" });
      return payload.file;
    };

    const readFileWithUnlock = async (filename) => {
      try {
        return await readFile(filename);
      } catch (error) {
        if (String(error?.code || "").toUpperCase() !== "E_FILE_LOCKED") throw error;
        return new Promise((resolve, reject) => {
          requestConsoleInput(`FILE "${filename}" IS LOCKED. ENTER PASSWORD:`, { hidden: true }, async (password) => {
            if (!password) {
              reject(error);
              return;
            }
            try {
              const unlocked = await readFile(filename, password);
              resolve(unlocked);
            } catch (unlockError) {
              reject(unlockError);
            }
          });
        });
      }
    };

    const extensionFromPath = (value) => {
      const raw = String(value || "").trim();
      if (!raw) return "";
      const clean = raw.split("?")[0].split("#")[0];
      const dot = clean.lastIndexOf(".");
      if (dot < 0) return "";
      return clean.slice(dot + 1).toLowerCase();
    };

    const classifyExternalLink = (filename, url) => {
      const fromFile = extensionFromPath(filename);
      const fromUrl = extensionFromPath(url);
      const ext = fromFile || fromUrl;
      if (IMAGE_EXTENSIONS.has(ext)) return "image";
      if (VIDEO_EXTENSIONS.has(ext)) return "video";
      if (TEXT_EXTENSIONS.has(ext)) return "text";
      return "other";
    };

    const openImageViewerWindow = (targetUrl, filename) => {
      const viewerUrl = `./image-viewer.html?img=${encodeURIComponent(String(targetUrl || ""))}&target=${encodeURIComponent(String(targetUrl || ""))}&name=${encodeURIComponent(String(filename || "IMAGE"))}`;
      const opened = window.open(viewerUrl, "_blank", "noopener");
      if (!opened) {
        showStatus("POPUP BLOCKED. ALLOW POPUPS TO VIEW IMAGE LINK.", true);
        return false;
      }
      return true;
    };

    const openExternalByType = (file, sourceCommand = "OPEN") => {
      const category = classifyExternalLink(file?.filename, file?.external_url);
      const url = String(file?.external_url || "");
      if (!url) return false;

      if (category === "image") {
        const opened = openImageViewerWindow(url, file?.filename);
        if (opened) {
          addLine(`${sourceCommand}: IMAGE LINK OPENED IN CRT VIEWER (${file.filename})`);
          showStatus("IMAGE VIEWER OPENED. CLICK IMAGE TO OPEN HOST LINK.", false);
        }
        return opened;
      }

      if (category === "video" || category === "text") {
        window.open(url, "_blank", "noopener");
        addLine(`${sourceCommand}: EXTERNAL ${category.toUpperCase()} LINK OPENED IN NEW TAB`);
        showStatus(`EXTERNAL ${category.toUpperCase()} PAGE OPENED.`, false);
        return true;
      }

      return false;
    };

    const listFiles = async () => {
      try {
        const payload = await callApi("/files", { method: "GET" });
        if (!payload.files?.length) {
          addLine("NO FILES IN REGISTRY.");
          return;
        }

        addLine("D1 FILE REGISTRY:");
        payload.files.forEach((entry) => {
          const kind = Number(entry.is_external) === 1 ? "LINK" : "TEXT";
          addLine(`  ${entry.filename} [${kind}] UPDATED ${entry.updated_at}`);
        });
      } catch (error) {
        showStatus(formatApiError(error, "FILES ERROR"), true);
      }
    };

    const runTypeCommand = async (filename, paginate = false) => {
      if (!filename) {
        showStatus(`USAGE: ${paginate ? "more" : "type"} <filename>`, true);
        return;
      }

      try {
        const file = await readFileWithUnlock(filename);
        if (Number(file.is_external) === 1) {
          if (openExternalByType(file, paginate ? "MORE" : "TYPE")) {
            return;
          }
          addLine(`EXTERNAL LINK FILE: ${file.filename}`);
          addLine(`URL: ${file.external_url}`);
          return;
        }

        const lines = String(file.content || "").split(/\r?\n/);
        const chunk = paginate ? lines.slice(0, 25) : lines;

        addLine(`--- ${file.filename} ---`);
        if (!chunk.length || (chunk.length === 1 && chunk[0] === "")) {
          addLine("[EMPTY FILE]");
        } else {
          chunk.forEach((line) => addLine(line));
        }

        if (paginate && lines.length > 25) {
          addLine(`[TRUNCATED] ${lines.length - 25} MORE LINE(S) AVAILABLE. USE TYPE.`);
        }
        addLine("--- EOF ---");
      } catch (error) {
        showStatus(formatApiError(error, "READ ERROR"), true);
      }
    };

    const runEditCommand = async (filename) => {
      if (!filename) {
        showStatus("USAGE: edit <filename>", true);
        return;
      }

      try {
        const file = await readFileWithUnlock(filename);
        if (Number(file.is_external) === 1 && file.external_url) {
          if (openExternalByType(file, "EDIT")) {
            return;
          }
          addLine(`EXTERNAL PAGE FOR ${file.filename}: ${file.external_url}`);
          window.open(file.external_url, "_blank", "noopener");
          showStatus("EXTERNAL LINK OPENED IN NEW PAGE.", false);
          return;
        }

        window.location.href = `${EDITOR_URL}?file=${encodeURIComponent(filename)}`;
      } catch (error) {
        showStatus(formatApiError(error, "EDIT ERROR"), true);
      }
    };

    const runTouchCommand = async (filename) => {
      if (!filename) {
        showStatus("USAGE: touch <filename>", true);
        return;
      }

      try {
        const file = await readFileWithUnlock(filename);
        if (Number(file.is_external) === 1 && file.external_url) {
          if (openExternalByType(file, "TOUCH")) {
            return;
          }
          addLine(`EXTERNAL PAGE FOR ${file.filename}: ${file.external_url}`);
          window.open(file.external_url, "_blank", "noopener");
          showStatus("EXTERNAL LINK OPENED IN NEW PAGE.", false);
          return;
        }

        window.location.href = `${TOUCH_VIEWER_URL}?file=${encodeURIComponent(filename)}`;
      } catch (error) {
        showStatus(formatApiError(error, "TOUCH ERROR"), true);
      }
    };

    const runCreateCommand = async (args) => {
      const filename = (args[0] || "").trim();
      if (!filename) {
        showStatus("USAGE: create <filename> [--link <url>]", true);
        return;
      }

      let externalUrl = "";
      let lockEnabled = false;
      for (let i = 1; i < args.length; i += 1) {
        const token = String(args[i] || "").trim();
        if (!token) continue;
        if (token === "--lock") {
          lockEnabled = true;
          continue;
        }
        if (token === "--link") {
          const urlParts = [];
          i += 1;
          while (i < args.length) {
            const nextToken = String(args[i] || "").trim();
            if (!nextToken || nextToken.startsWith("--")) {
              i -= 1;
              break;
            }
            urlParts.push(nextToken);
            i += 1;
          }
          externalUrl = urlParts.join(" ").trim();
          continue;
        }
      }
      const mode = externalUrl ? "external" : "local";

      if (args.includes("--link") && !externalUrl) {
        showStatus("USAGE: create <filename> --link <url>", true);
        return;
      }

      let lockPassword = "";
      if (lockEnabled) {
        await new Promise((resolve) => {
          requestConsoleInput(`SET LOCK PASSWORD FOR ${filename.toUpperCase()}:`, { hidden: true }, async (password) => {
            lockPassword = String(password || "");
            resolve();
          });
        });
        if (!lockPassword) {
          showStatus("LOCK ENABLED BUT PASSWORD NOT PROVIDED.", true);
          return;
        }
      }

      try {
        await callApi("/file", {
          method: "POST",
          body: JSON.stringify({
            filename,
            mode,
            lock: lockEnabled,
            lockPassword,
            externalUrl,
            content: mode === "local" ? `# ${filename}\n` : ""
          })
        });

        if (mode === "external") {
          addLine(`EXTERNAL LINK FILE CREATED: ${filename}`);
          addLine(`TARGET URL: ${externalUrl}`);
        } else {
          addLine(`LOCAL TEXT FILE CREATED: ${filename}`);
          addLine("TIP: RUN 'edit <filename>' TO MODIFY CONTENT.");
        }
      } catch (error) {
        showStatus(formatApiError(error, "CREATE ERROR"), true);
      }
    };

    const bootHiddenRedirect = async () => {
      const recentLines = JSON.parse(sessionStorage.getItem("ars40:lastLines") || "[]");
      recentLines.forEach((line) => addLine(line));
      await wait(220);

      for (let i = 0; i < 10; i += 1) {
        addLine(".");
        await wait(24);
      }

      await typeLine("[SYS ] [LOADING CONSOLE COMMANDS]", 11);
      await typeLine(`[AUTH] USER ${user} / STATUS ${activeRole.toUpperCase()} VERIFIED`, 11);
      await typeLine("[CONSOLE] DRAWING GRAPHICS...", 10);

      for (const line of logo) {
        await typeLine(line, 6);
      }

      await typeLine("Type HELP and press [ENTER] to list available commands.", 11);
      promptRow.classList.add("show");
      consoleInput.focus();
    };

    const runCommand = async (raw) => {
      const input = raw.trim();
      if (!input) return;

      if (pendingInputHandler) {
        const pending = pendingInputHandler;
        pendingInputHandler = null;
        try {
          await pending.handler(input);
        } finally {
          consoleInput.type = "text";
        }
        return;
      }

      addLine(`>${input}`);
      const [command, ...args] = input.split(/\s+/);
      const cmd = command.toLowerCase();

      if (cmd === "help") {
        printHelp();
        return;
      }

      if (cmd === "clear") {
        output.innerHTML = "";
        clearStatus();
        return;
      }

      if (cmd === "logout") {
        void logoutToCrt();
        return;
      }

      if (cmd === "exit") {
        void powerOffAndExit();
        return;
      }

      if (cmd === "files") {
        await listFiles();
        return;
      }

      if (cmd === "type") {
        await runTypeCommand(args.join(" ").trim(), false);
        return;
      }

      if (cmd === "more") {
        await runTypeCommand(args.join(" ").trim(), true);
        return;
      }

      if (cmd === "edit") {
        await runEditCommand(args.join(" ").trim());
        return;
      }

      if (cmd === "touch") {
        await runTouchCommand(args.join(" ").trim());
        return;
      }

      if (cmd === "create") {
        await runCreateCommand(args);
        return;
      }

      if (cmd === "errors") {
        printErrorCodes();
        return;
      }

      if (cmd === "goto") {
        if (activeRole !== "administrator" && activeRole !== "manager") {
          showStatus("ACCESS DENIED [ERROR 401 UNAUTHORIZED]", true);
          return;
        }

        const target = args.join(" ").trim();
        if (!target) {
          showStatus("USAGE: goto <url>", true);
          return;
        }

        const url = /^https?:\/\//i.test(target) ? target : `https://${target}`;
        addLine(`REDIRECTING TO ${url}`);
        window.location.href = url;
        return;
      }

      if (cmd === "register") {
        if (activeRole !== "administrator" && activeRole !== "manager") {
          showStatus("ACCESS DENIED [ERROR 401 UNAUTHORIZED]", true);
          return;
        }

        await registerAccount(args);
        return;
      }

      if (cmd === "setuser") {
        if (activeRole !== "administrator" && activeRole !== "manager") {
          showStatus("PERMISSION DENIED: ADMINISTRATOR OR MANAGER ONLY", true);
          return;
        }

        await adminUpdateUsername(args);
        return;
      }

      if (cmd === "setpass") {
        if (activeRole !== "administrator" && activeRole !== "manager") {
          showStatus("PERMISSION DENIED: ADMINISTRATOR OR MANAGER ONLY", true);
          return;
        }

        await adminUpdatePassword(args);
        return;
      }

      if (cmd === "elevate") {
        if (activeRole !== "administrator" && activeRole !== "manager" && activeRole !== "editor") {
          showStatus("PERMISSION DENIED: EDITOR, ADMINISTRATOR OR MANAGER ONLY", true);
          return;
        }

        await elevateUserRole(args);
        return;
      }

      showStatus(`UNKNOWN COMMAND: ${cmd.toUpperCase()}`, true);
    };

    const powerOffAndExit = async () => {
      consoleInput.disabled = true;
      addLine("SYSTEM NOTICE: EXIT command accepted.");
      await wait(320);
      addLine("Powering down console session...");
      await wait(600);
      poweroffFade.classList.add("show");
      await wait(950);
      window.location.href = POWER_OFF_URL;
    };

    const logoutToCrt = async () => {
      sessionStorage.removeItem("ars40:lastLines");
      sessionStorage.removeItem("ars40:user");
      sessionStorage.removeItem("ars40:role");
      addLine("SIGNING OUT TO CRT-CONSOLE...");
      await wait(120);
      window.location.href = LOGIN_URL;
    };

    const registerAccount = async (args) => {
      const username = (args[0] || "").trim().toUpperCase();
      const password = (args[1] || "").trim();

      if (!username || !password) {
        showStatus("USAGE: register <username> <password>", true);
        return;
      }

      if (!/^[A-Z0-9_-]{3,20}$/.test(username)) {
        showStatus("USERNAME MUST BE 3-20 CHARS: A-Z, 0-9, _, -", true);
        return;
      }

      if (password.length < 4) {
        showStatus("PASSWORD MUST BE AT LEAST 4 CHARACTERS", true);
        return;
      }

      addLine("SECURITY NOTICE: Do not reuse passwords from real accounts.");

      try {
        await callAuthApi("/register", { username, password });
        addLine(`ACCOUNT REGISTERED: ${username} (ROLE=STANDARD)`);
      } catch (error) {
        showStatus(formatApiError(error, "REGISTRATION FAILED"), true);
      }
    };

    const adminUpdateUsername = async (args) => {
      const id = Number(args[0]);
      const nextUsername = (args[1] || "").trim().toUpperCase();

      if (!Number.isInteger(id) || id <= 0 || !nextUsername) {
        showStatus("USAGE: setuser <db_id> <new_username>", true);
        return;
      }

      if (!/^[A-Z0-9_-]{3,20}$/.test(nextUsername)) {
        showStatus("USERNAME MUST BE 3-20 CHARS: A-Z, 0-9, _, -", true);
        return;
      }

      try {
        await callAuthApi("/admin/update-username", { id, username: nextUsername });
        addLine(`ACCOUNT UPDATED: ID ${id} USERNAME -> ${nextUsername}`);
      } catch (error) {
        showStatus(formatApiError(error, "SETUSER FAILED"), true);
      }
    };

    const adminUpdatePassword = async (args) => {
      const id = Number(args[0]);
      const nextPassword = (args[1] || "").trim();

      if (!Number.isInteger(id) || id <= 0 || !nextPassword) {
        showStatus("USAGE: setpass <db_id> <new_password>", true);
        return;
      }

      if (nextPassword.length < 4) {
        showStatus("PASSWORD MUST BE AT LEAST 4 CHARACTERS", true);
        return;
      }

      addLine("SECURITY NOTICE: Do not reuse passwords from real accounts.");

      try {
        await callAuthApi("/admin/update-password", { id, password: nextPassword });
        addLine(`ACCOUNT UPDATED: ID ${id} PASSWORD CHANGED`);
      } catch (error) {
        showStatus(formatApiError(error, "SETPASS FAILED"), true);
      }
    };

    const elevateUserRole = async (args) => {
      const id = Number(args[0]);
      const targetRole = String(args[1] || "").trim().toLowerCase();

      if (!Number.isInteger(id) || id <= 0 || !targetRole) {
        showStatus("USAGE: elevate <db_id> <role>", true);
        return;
      }

      const allowedTargets = activeRole === "manager"
        ? ["administrator", "editor", "standard"]
        : activeRole === "administrator"
          ? ["editor", "standard"]
          : ["standard"];
      if (!allowedTargets.includes(targetRole)) {
        showStatus(`ACCESS RULE: ${activeRole.toUpperCase()} MAY ONLY ELEVATE TO ${allowedTargets.join("/").toUpperCase()}`, true);
        return;
      }

      try {
        await callAuthApi("/admin/elevate", { id, role: targetRole }, { "x-ars40-role": activeRole });
        addLine(`ACCOUNT UPDATED: ID ${id} ROLE -> ${targetRole.toUpperCase()}`);
      } catch (error) {
        showStatus(formatApiError(error, "ELEVATE FAILED"), true);
      }
    };

    consoleInput.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      clearStatus();
      if (!promptRow.classList.contains("show")) return;
      await runCommand(consoleInput.value);
      consoleInput.value = "";
      if (!pendingInputHandler) {
        consoleInput.type = "text";
      }
    });

    bootHiddenRedirect();
