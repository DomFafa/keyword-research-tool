import { getFeishuSheetValues, readFeishuConfig } from "./feishu-api.mjs";
import { headerIndex, valuesToTable } from "./table-utils.mjs";

const API_REGISTER_SHEET_ID = "4zuQ4Y";
const TOTAL_SHEET_ID = "0f28c2";

function cellText(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (Array.isArray(value)) {
    return value.map(cellText).filter(Boolean).join("");
  }
  if (typeof value === "object") {
    return String(value.text || value.link || value.value || "").trim();
  }
  return String(value).trim();
}

function parseCellReference(value) {
  const text = cellText(value);
  const match = text.match(/^'([^']+)'!([A-Z]+\d+)$/i);
  if (!match) {
    return null;
  }
  const sheetName = match[1];
  const cell = match[2].toUpperCase();
  const sheetId = sheetName === "总表" ? TOTAL_SHEET_ID : sheetName;
  return { sheetName, sheetId, cell };
}

function columnIndexFromName(name) {
  return String(name || "").toUpperCase().split("").reduce((total, char) => {
    const code = char.charCodeAt(0);
    if (code < 65 || code > 90) return total;
    return total * 26 + (code - 64);
  }, 0) - 1;
}

function cellFromGrid(values, cell) {
  const match = String(cell || "").match(/^([A-Z]+)(\d+)$/i);
  if (!match) return "";
  const column = columnIndexFromName(match[1]);
  const row = Number(match[2]) - 1;
  return cellText(values[row]?.[column]);
}

function resolveReferenceCellFromCache({ totalValues, value }) {
  const reference = parseCellReference(value);
  if (!reference) {
    return cellText(value);
  }
  if (reference.sheetId === TOTAL_SHEET_ID) {
    return cellFromGrid(totalValues, reference.cell);
  }
  return cellText(value);
}

export function isUsableBingWebmasterApi(value) {
  const text = cellText(value);
  return /^[a-f0-9]{32}$/i.test(text) || /^(可用|available|ready|已注册)$/i.test(text);
}

function optionalHeader(tableHeaders, names) {
  const normalized = tableHeaders.map((header) => String(header || "").trim().toLowerCase());
  for (const name of names) {
    const index = normalized.indexOf(String(name || "").trim().toLowerCase());
    if (index >= 0) return index;
  }
  return -1;
}

export async function readFeishuBingRegistry({
  config = readFeishuConfig(),
  startFingerprintName = "",
  limit = 0,
  requireBingApi = false,
  requireFingerprint = requireBingApi
} = {}) {
  const result = await getFeishuSheetValues({
    config,
    range: `${API_REGISTER_SHEET_ID}!A1:Z1000`
  });
  const totalResult = await getFeishuSheetValues({
    config,
    range: `${TOTAL_SHEET_ID}!A1:J1000`
  });
  const values = result.data?.valueRange?.values || [];
  const totalValues = totalResult.data?.valueRange?.values || [];
  const table = valuesToTable(values);
  const fingerprintIndex = headerIndex(table.headers, "指纹的名称", "飞书 api 注册");
  const bingApiIndex = headerIndex(table.headers, "bing webmaster api", "飞书 api 注册");
  const regionIndex = optionalHeader(table.headers, ["地区", "地址", "区域", "region"]);
  const emailIndex = optionalHeader(table.headers, ["邮箱账号", "邮箱", "email", "account"]);
  const passwordIndex = optionalHeader(table.headers, ["邮箱密码", "密码", "password"]);
  const recoverEmailIndex = optionalHeader(table.headers, ["安全邮箱", "恢复邮箱", "recover email", "recovery email"]);
  const fallbackPasswordIndex = optionalHeader(table.headers, ["默认返利网密码", "返利网密码", "fanli password"]);
  const rows = [];
  for (const row of table.rows) {
    const fingerprintName = resolveReferenceCellFromCache({
      totalValues,
      value: row.values[fingerprintIndex]
    });
    const bingWebmasterApi = cellText(row.values[bingApiIndex]);
    if (!fingerprintName && !bingWebmasterApi) {
      continue;
    }
    if (requireBingApi && !isUsableBingWebmasterApi(bingWebmasterApi)) {
      continue;
    }
    if (requireBingApi && requireFingerprint && !(Number(fingerprintName) > 0)) {
      continue;
    }
    rows.push({
      rowNumber: row.rowNumber,
      fingerprintName,
      serialNumber: Number(fingerprintName) || null,
      bingWebmasterApi,
      region: regionIndex >= 0 ? resolveReferenceCellFromCache({ totalValues, value: row.values[regionIndex] }) : "",
      email: emailIndex >= 0 ? resolveReferenceCellFromCache({ totalValues, value: row.values[emailIndex] }) : "",
      password: passwordIndex >= 0 ? resolveReferenceCellFromCache({ totalValues, value: row.values[passwordIndex] }) : "",
      recoverEmail: recoverEmailIndex >= 0 ? resolveReferenceCellFromCache({ totalValues, value: row.values[recoverEmailIndex] }) : "",
      fallbackPassword: fallbackPasswordIndex >= 0 ? resolveReferenceCellFromCache({ totalValues, value: row.values[fallbackPasswordIndex] }) : ""
    });
  }

  const start = String(startFingerprintName || "").trim();
  const startIndex = start
    ? rows.findIndex((row) => String(row.fingerprintName || "").trim() === start)
    : 0;
  if (start && startIndex === -1) {
    throw new Error(`飞书 api 注册中没有找到指纹名称: ${start}`);
  }
  const selected = rows.slice(start ? startIndex : 0);
  return limit > 0 ? selected.slice(0, limit) : selected;
}
