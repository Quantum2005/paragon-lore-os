/**
 * DEPRECATED: This Apps Script backend is no longer used by the GitHub Pages flow.
 * The active credential source is `accounts.json` with Base64-encoded fields.
 */

/**
 * Google Apps Script Web App for fixed-account authentication.
 *
 * Sheet format (tab name: Accounts):
 * - Column A: username (case-insensitive)
 * - Column B: password
 * - Column C: enabled (TRUE/FALSE, optional; blank treated as TRUE)
 */
const SHEET_NAME = 'Accounts';

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const username = sanitize(body.username);
    const password = String(body.password || '');

    if (!username || !password) {
      return json({ ok: false, code: 'MISSING_FIELDS', message: 'Username and password are required.' });
    }

    const result = verifyCredentials(username, password);
    return json(result);
  } catch (err) {
    return json({ ok: false, code: 'SERVER_ERROR', message: 'Unexpected auth error.' });
  }
}

function verifyCredentials(username, password) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    return { ok: false, code: 'CONFIG_ERROR', message: 'Accounts sheet is missing.' };
  }

  const values = sheet.getDataRange().getValues();
  // Skip header row.
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const sheetUsername = sanitize(row[0]);
    const sheetPassword = String(row[1] || '');
    const enabledCell = row[2];
    const enabled = String(enabledCell).trim() === '' ? true : String(enabledCell).toLowerCase() === 'true';

    if (sheetUsername !== username) continue;

    if (!enabled) {
      return { ok: false, code: 'DISABLED', message: 'Account is disabled.' };
    }

    if (sheetPassword === password) {
      return { ok: true, code: 'AUTH_OK', message: 'Authentication accepted.', username: sheetUsername };
    }

    return {
      ok: false,
      code: 'BAD_PASSWORD',
      message: 'Incorrect password for fixed account. Try again.'
    };
  }

  return { ok: false, code: 'UNKNOWN_USER', message: 'Account not found.' };
}

function sanitize(value) {
  return String(value || '').trim().toUpperCase();
}

function json(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
