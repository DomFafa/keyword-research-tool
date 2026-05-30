import fs from "node:fs";

const DEFAULT_CONFIG_PATH = "secrets/feishu/config.json";
const DEFAULT_BASE_URL = "https://open.feishu.cn";

function readJsonFileIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function parseFeishuSpreadsheetToken(value = "") {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  const match = text.match(/\/sheets\/([A-Za-z0-9]+)/);
  return match ? match[1] : text;
}

export function readFeishuConfig(configPath = DEFAULT_CONFIG_PATH) {
  const config = readJsonFileIfExists(configPath);
  const spreadsheetToken = parseFeishuSpreadsheetToken(
    process.env.FEISHU_SPREADSHEET_TOKEN ||
      process.env.FEISHU_SHEET_URL ||
      config.spreadsheetToken ||
      config.sheetUrl ||
      ""
  );
  return {
    baseUrl: process.env.FEISHU_BASE_URL || config.baseUrl || DEFAULT_BASE_URL,
    appId: process.env.FEISHU_APP_ID || config.appId || "",
    appSecret: process.env.FEISHU_APP_SECRET || config.appSecret || "",
    spreadsheetToken
  };
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok || (Number.isFinite(Number(data.code)) && Number(data.code) !== 0)) {
    const error = new Error(data.msg || data.message || response.statusText || "feishu_api_error");
    error.status = response.status;
    error.code = data.code;
    error.data = data;
    throw error;
  }
  return data;
}

export async function getFeishuTenantAccessToken(config = readFeishuConfig()) {
  if (!config.appId || !config.appSecret) {
    throw new Error("缺少飞书 appId/appSecret，请填写 secrets/feishu/config.json");
  }
  const data = await fetchJson(`${config.baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      app_id: config.appId,
      app_secret: config.appSecret
    })
  });
  const token = data.tenant_access_token;
  if (!token) {
    throw new Error(`飞书没有返回 tenant_access_token: ${JSON.stringify(data)}`);
  }
  return token;
}

export async function feishuApiFetch({
  config = readFeishuConfig(),
  path,
  method = "GET",
  body,
  tenantAccessToken = ""
}) {
  const token = tenantAccessToken || await getFeishuTenantAccessToken(config);
  return fetchJson(`${config.baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

export async function getFeishuSpreadsheetMeta({ config = readFeishuConfig(), spreadsheetToken = "" } = {}) {
  const token = spreadsheetToken || config.spreadsheetToken;
  if (!token) {
    throw new Error("缺少飞书 spreadsheetToken 或 sheetUrl");
  }
  return feishuApiFetch({
    config,
    path: `/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(token)}/metainfo`
  });
}

export async function getFeishuSheetValues({
  config = readFeishuConfig(),
  spreadsheetToken = "",
  range
}) {
  const token = spreadsheetToken || config.spreadsheetToken;
  if (!token) {
    throw new Error("缺少飞书 spreadsheetToken 或 sheetUrl");
  }
  if (!range) {
    throw new Error("缺少飞书读取范围 range，例如 Sheet1!A1:C10");
  }
  return feishuApiFetch({
    config,
    path: `/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(token)}/values/${encodeURIComponent(range)}`
  });
}

export async function updateFeishuSheetValues({
  config = readFeishuConfig(),
  spreadsheetToken = "",
  range,
  values
}) {
  const token = spreadsheetToken || config.spreadsheetToken;
  if (!token) {
    throw new Error("缺少飞书 spreadsheetToken 或 sheetUrl");
  }
  if (!range) {
    throw new Error("缺少飞书写入范围 range，例如 Sheet1!A1:C10");
  }
  return feishuApiFetch({
    config,
    method: "PUT",
    path: `/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(token)}/values`,
    body: {
      valueRange: {
        range,
        values
      }
    }
  });
}
