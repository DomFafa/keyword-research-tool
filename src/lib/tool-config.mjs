import { getSheetValues } from "./google-sheets-api.mjs";
import { rowsToObjects } from "./csv.mjs";

export const DEFAULT_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1Ea3mSRW431QP08sq9tn3VoYEkj52hNRzY_GVizVLy3A/edit?gid=0#gid=0";

function sheetRange(sheetName) {
  return `${sheetName}!A:Z`;
}

export function parseSheetValues(values, expectedHeaders = []) {
  const headers = values[0] || [];
  const missing = expectedHeaders.filter((header) => !headers.includes(header));
  if (missing.length > 0) {
    throw new Error(
      `子表缺少表头: ${missing.join(", ")}. 当前表头: ${headers.join(", ")}`
    );
  }

  return {
    headers,
    rows: rowsToObjects(values),
    rawRows: values
  };
}

async function readSheetFromApi({ sheetUrl, sheetName, expectedHeaders = [] }) {
  const result = await getSheetValues({
    sheetUrl,
    range: sheetRange(sheetName)
  });
  if (!result.ok) {
    throw new Error(`读取 ${sheetName} 失败: ${result.reason || "unknown error"}`);
  }
  return {
    range: result.range,
    ...parseSheetValues(result.values || [], expectedHeaders)
  };
}

export function getRequiredValue(record, key) {
  const value = record?.[key]?.trim();
  if (!value) {
    throw new Error(`Missing required value in Google Sheet: ${key}`);
  }
  return value;
}

export function getRequiredValueByAliases(record, aliases) {
  for (const key of aliases) {
    const value = record?.[key]?.trim();
    if (value) {
      return value;
    }
  }
  throw new Error(`Missing required value in Google Sheet. Tried columns: ${aliases.join(", ")}`);
}

export function redactSecrets(rows) {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        /密码|password/i.test(key) && value ? "***" : value
      ])
    )
  );
}

export function pickKeywordTask(keywordRows, rowNumber = 2) {
  const index = Math.max(0, Number(rowNumber) - 2);
  const row = keywordRows[index];
  if (!row) {
    throw new Error(`No task row found in 词根拓展 at spreadsheet row ${rowNumber}`);
  }

  const rootKeyword = (row["词根"] || "").trim();
  const keyword = (row["关键词"] || "").trim();
  const query = rootKeyword || keyword;
  if (!query) {
    throw new Error(`Spreadsheet row ${rowNumber} has neither 词根 nor 关键词`);
  }

  return {
    rowNumber,
    row,
    query,
    mode: rootKeyword ? "root" : "keyword",
    rootKeyword,
    keyword,
    matchType: (row["匹配类型"] || "").trim(),
    matchCountry: (row["匹配国家"] || "").trim(),
    volumeMin: (row["搜索量范围（小）"] || "").trim(),
    volumeMax: (row["搜索量范围（大）"] || "").trim(),
    kdMin: (row["KD范围（小）"] || "").trim(),
    kdMax: (row["KD范围（大）"] || "").trim(),
    machineFilter: (row["是否进行机器筛选"] || row["进行机器筛选"] || "").trim()
  };
}

export async function readToolConfig(options) {
  const {
    sheetUrl,
    accountSheetName = "工具账号密码",
    keywordSheetName = "词根拓展",
    keywordTotalSheetName = "关键词总表",
    taskRow = 2,
    requireTask = true
  } = options;

  const accountSheet = await readSheetFromApi({
    sheetUrl,
    sheetName: accountSheetName,
    expectedHeaders: ["semrush账号", "semrush密码"]
  });
  const toolAccount = accountSheet.rows[0] || {};

  const keywordSheet = await readSheetFromApi({
    sheetUrl,
    sheetName: keywordSheetName,
    expectedHeaders: ["词根", "关键词"]
  });

  const keywordTotalSheet = await readSheetFromApi({
    sheetUrl,
    sheetName: keywordTotalSheetName,
    expectedHeaders: ["词根", "关键词", "国家", "搜索量", "KD"]
  });

  return {
    accountSheet,
    keywordSheet,
    keywordTotalSheet,
    toolAccount,
    browserAccount: toolAccount["运行浏览器账号"] || toolAccount["运行浏览器的账号"] || "",
    task: requireTask ? pickKeywordTask(keywordSheet.rows, taskRow) : null
  };
}
