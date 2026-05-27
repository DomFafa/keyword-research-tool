import { evaluate, navigateAndWait, withChromePage, withExistingChromePage } from "./cdp.mjs";
import { parseCsv, rowsToObjects } from "./csv.mjs";

export function getSpreadsheetId(sheetUrl) {
  const match = sheetUrl.match(/\/spreadsheets\/d\/([^/]+)/);
  if (!match) {
    throw new Error(`Invalid Google Sheet URL: ${sheetUrl}`);
  }
  return match[1];
}

export function getGid(sheetUrl) {
  const parsed = new URL(sheetUrl);
  const gidFromSearch = parsed.searchParams.get("gid");
  const gidFromHash = parsed.hash.match(/gid=(\d+)/)?.[1];
  return gidFromSearch || gidFromHash || "0";
}

export function parseSheetGidsFromHtml(html) {
  const gids = {};
  const chunkPattern = /\[21350203,"((?:\\.|[^"\\])*)"\]/g;

  for (const match of html.matchAll(chunkPattern)) {
    try {
      const decoded = JSON.parse(`"${match[1]}"`);
      const payload = JSON.parse(decoded);
      const gid = payload?.[2];
      const sheetName = payload?.[3]?.[0]?.["1"]?.[0]?.[2];
      if (typeof gid === "string" && typeof sheetName === "string" && sheetName) {
        gids[sheetName] = gid;
      }
    } catch {
      // Ignore unrelated bootstrap chunks.
    }
  }

  return gids;
}

export function buildCsvUrl({ sheetUrl, gid, sheetName }) {
  const spreadsheetId = getSpreadsheetId(sheetUrl);
  const exportUrl = new URL(
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq`
  );
  exportUrl.searchParams.set("tqx", "out:csv");
  if (sheetName) {
    exportUrl.searchParams.set("sheet", sheetName);
  } else {
    exportUrl.searchParams.set("gid", gid || getGid(sheetUrl));
  }
  return exportUrl.toString();
}

async function fetchCsvInPage({ cdp, sessionId, csvUrl }) {
  const expression = `(${async function fetchSheetCsv(url) {
      let lastError = "";
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
	          const controller = new AbortController();
	          const timer = setTimeout(() => controller.abort(), 15000);
	          const response = await fetch(url, {
	            credentials: "include",
	            signal: controller.signal
	          });
	          const text = await response.text();
	          clearTimeout(timer);
          return {
            ok: response.ok,
            status: response.status,
            finalUrl: response.url,
            contentType: response.headers.get("content-type") || "",
            text
          };
        } catch (error) {
          lastError = error?.stack || error?.message || String(error);
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
      return {
        ok: false,
        status: 0,
        finalUrl: url,
        contentType: "",
        text: lastError
      };
    }.toString()})(${JSON.stringify(csvUrl)})`;

  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await evaluate(cdp, sessionId, expression, 30000);
    } catch (error) {
      lastError = error;
      const message = error?.message || String(error);
      if (!/Execution context was destroyed|Cannot find context|Inspected target navigated/.test(message)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  throw lastError;
}

async function fetchSheetHtmlInPage({ cdp, sessionId, sheetUrl }) {
  const spreadsheetId = getSpreadsheetId(sheetUrl);
  const editUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  const expression = `(${async function fetchSheetHtml(url) {
      let lastError = "";
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 15000);
          const response = await fetch(url, {
            credentials: "include",
            signal: controller.signal
          });
          const text = await response.text();
          clearTimeout(timer);
          return {
            ok: response.ok,
            status: response.status,
            finalUrl: response.url,
            contentType: response.headers.get("content-type") || "",
            text
          };
        } catch (error) {
          lastError = error?.stack || error?.message || String(error);
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
      return {
        ok: false,
        status: 0,
        finalUrl: url,
        contentType: "",
        text: lastError
      };
    }.toString()})(${JSON.stringify(editUrl)})`;

  return evaluate(cdp, sessionId, expression, 30000);
}

function parseSheetResponse(data, expectedHeaders = []) {
  if (!data.ok) {
    const hint = data.text.includes("登入") || data.text.includes("Sign in")
      ? "Chrome is not logged into the Google account that can access this Sheet."
      : "Google Sheets did not return a successful CSV response.";
    throw new Error(
      `${hint}\nHTTP ${data.status}; content-type: ${data.contentType}; final URL: ${data.finalUrl}`
    );
  }

  const rows = parseCsv(data.text);
  const headers = rows[0] || [];
  const missing = expectedHeaders.filter((header) => !headers.includes(header));
  if (missing.length > 0) {
    throw new Error(
      `The response did not look like the expected Sheet CSV. Missing headers: ${missing.join(", ")}. Headers: ${headers.join(", ")}`
    );
  }

  return {
    headers,
    rows: rowsToObjects(rows),
    rawRows: rows
  };
}

export async function readSheetWithBootstrapChrome({
  sheetUrl,
  gid,
  sheetName,
  expectedHeaders = []
}) {
  const csvUrl = buildCsvUrl({ sheetUrl, gid, sheetName });
  const data = await withChromePage(async ({ cdp, sessionId }) => {
    await navigateAndWait(cdp, sessionId, "https://docs.google.com/", 30000);
    return fetchCsvInPage({ cdp, sessionId, csvUrl });
  });
  return {
    csvUrl,
    ...parseSheetResponse(data, expectedHeaders)
  };
}

export async function readSheetInSession({
  cdp,
  sessionId,
  sheetUrl,
  gid,
  sheetName,
  expectedHeaders = []
}) {
  const csvUrl = buildCsvUrl({ sheetUrl, gid, sheetName });
  const data = await fetchCsvInPage({ cdp, sessionId, csvUrl });
  return {
    csvUrl,
    ...parseSheetResponse(data, expectedHeaders)
  };
}

export async function readSheetGidsInSession({
  cdp,
  sessionId,
  sheetUrl
}) {
  const data = await fetchSheetHtmlInPage({ cdp, sessionId, sheetUrl });
  if (!data.ok) {
    throw new Error(
      `Google Sheets did not return the spreadsheet HTML. HTTP ${data.status}; final URL: ${data.finalUrl}`
    );
  }

  const gids = parseSheetGidsFromHtml(data.text);
  if (Object.keys(gids).length === 0) {
    throw new Error("Unable to parse Google Sheet tab gids from spreadsheet HTML.");
  }
  return gids;
}

export async function readSheetWithTargetChrome({
  targetId,
  sheetUrl,
  gid,
  sheetName,
  expectedHeaders = []
}) {
  const csvUrl = buildCsvUrl({ sheetUrl, gid, sheetName });
  const data = await withExistingChromePage(targetId, async ({ cdp, sessionId }) =>
    fetchCsvInPage({ cdp, sessionId, csvUrl })
  );
  return {
    csvUrl,
    ...parseSheetResponse(data, expectedHeaders)
  };
}
