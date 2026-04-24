const fileLabel = document.getElementById("fileLabel");
const userLabel = document.getElementById("userLabel");
const editor = document.getElementById("editor");
const saveBtn = document.getElementById("saveBtn");
const backBtn = document.getElementById("backBtn");
const status = document.getElementById("status");

const params = new URLSearchParams(window.location.search);
const filename = String(params.get("file") || "").trim();
const user = (sessionStorage.getItem("ars40:user") || "GUEST").toUpperCase();
const REMOTE_BACKEND_URL = "https://api-worker.logicalsystems-yt.workers.dev";
let activeBackendBase = "";
const API_ERROR_MEANINGS = {
  E_BINDING_MISSING: "Database binding missing in runtime.",
  E_INVALID_FILENAME: "Filename is invalid.",
  E_FILE_NOT_FOUND: "Requested file does not exist.",
  E_FILE_EXISTS: "A file with this name already exists.",
  E_INVALID_EXTERNAL_URL: "External link URL is invalid.",
  E_EXTERNAL_READONLY: "External link records cannot be edited as local text.",
  E_BAD_JSON: "Backend received malformed JSON payload.",
  E_UNSUPPORTED_ROUTE: "Unsupported API route/method.",
  E_API_UNAVAILABLE: "API endpoint unavailable or returned non-JSON."
};

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

fileLabel.textContent = `EDIT://${filename || "UNKNOWN"}`;
userLabel.textContent = `USER://${user}`;

const showStatus = (message, error = false) => {
  status.textContent = message;
  status.style.color = error ? "var(--error)" : "var(--fg)";
  status.classList.add("show");
};

const createApiError = (payload, statusCode) => {
  const error = new Error(payload?.message || `HTTP ${statusCode}`);
  error.code = payload?.code || "E_API_UNAVAILABLE";
  return error;
};

const formatApiError = (error, prefix) => {
  const code = String(error?.code || "E_API_UNAVAILABLE").toUpperCase();
  const meaning = API_ERROR_MEANINGS[code] || "Unexpected API failure.";
  const detail = String(error?.message || meaning).toUpperCase();
  return `${prefix} [${code}] ${detail} - ${meaning.toUpperCase()}`;
};

const parsePayload = async (response) => {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json().catch(() => ({}));
  }
  const raw = await response.text().catch(() => "");
  return {
    ok: false,
    code: "E_API_UNAVAILABLE",
    message: raw ? `Unexpected response: ${raw.slice(0, 120)}` : "API unavailable."
  };
};

const fetchFile = async () => {
  if (!filename) {
    showStatus("MISSING FILE PARAMETER. RETURNING.", true);
    setTimeout(() => window.location.href = "./ars40-console.html", 600);
    return;
  }

  try {
    const response = await fetchWithBackendFallback(`/api/file?name=${encodeURIComponent(filename)}`);
    const payload = await parsePayload(response);
    if (!response.ok || payload.ok === false) {
      if (String(payload.code || "").toUpperCase() === "E_FILE_LOCKED") {
        const password = window.prompt(`FILE "${filename}" IS LOCKED. ENTER PASSWORD:`) || "";
        if (password) {
          const retry = await fetchWithBackendFallback(`/api/file?name=${encodeURIComponent(filename)}&password=${encodeURIComponent(password)}`);
          const retryPayload = await parsePayload(retry);
          if (retry.ok && retryPayload.ok !== false) {
            editor.value = String(retryPayload.file?.content || "");
            showStatus("FILE READY (UNLOCKED). READ/EDIT ENABLED.", false);
            editor.dataset.lockPassword = password;
            editor.focus();
            return;
          }
        }
      }
      showStatus(formatApiError(createApiError(payload, response.status), "FILE LOAD FAILED"), true);
      editor.disabled = true;
      saveBtn.disabled = true;
      return;
    }

    if (Number(payload.file?.is_external) === 1 && payload.file?.external_url) {
      showStatus(`EXTERNAL LINK: ${payload.file.external_url}`, false);
      window.open(payload.file.external_url, "_blank", "noopener");
      setTimeout(() => {
        window.location.href = "./ars40-console.html";
      }, 700);
      return;
    }

    editor.value = String(payload.file?.content || "");
    showStatus("FILE READY. EDIT AND PRESS CTRL+S.", false);
    editor.focus();
  } catch (_error) {
    showStatus("FILE LOAD FAILED [E_API_UNAVAILABLE] API UNAVAILABLE", true);
  }
};

const save = async () => {
  if (!filename || editor.disabled) return;

  try {
    const response = await fetchWithBackendFallback("/api/file", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-ars40-user": user
      },
      body: JSON.stringify({ filename, content: editor.value, lockPassword: editor.dataset.lockPassword || "" })
    });

    const payload = await parsePayload(response);
    if (!response.ok || payload.ok === false) {
      showStatus(formatApiError(createApiError(payload, response.status), "SAVE FAILED"), true);
      return;
    }

    showStatus(`SAVED ${filename.toUpperCase()} TO D1 DATABASE.`, false);
  } catch (_error) {
    showStatus("SAVE FAILED [E_API_UNAVAILABLE] API UNAVAILABLE", true);
  }
};

saveBtn.addEventListener("click", () => {
  void save();
});

backBtn.addEventListener("click", () => {
  window.location.href = "./ars40-console.html";
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    window.location.href = "./ars40-console.html";
    return;
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void save();
  }
});

fetchFile();
