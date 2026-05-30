#!/usr/bin/env node
import { readArg } from "./lib/args.mjs";
import {
  getFeishuSheetValues,
  getFeishuSpreadsheetMeta,
  getFeishuTenantAccessToken,
  parseFeishuSpreadsheetToken,
  readFeishuConfig
} from "./lib/feishu-api.mjs";

function summarizeMeta(data) {
  const sheets = data.data?.sheets || data.data?.sheet_info || [];
  return {
    spreadsheetToken: data.data?.spreadsheetToken || data.data?.spreadsheet_token || "",
    sheetCount: Array.isArray(sheets) ? sheets.length : 0,
    sheets: Array.isArray(sheets)
      ? sheets.slice(0, 10).map((sheet) => ({
        sheetId: sheet.sheetId || sheet.sheet_id,
        title: sheet.title
      }))
      : []
  };
}

async function main() {
  const configPath = readArg("config", "secrets/feishu/config.json");
  const range = readArg("range", "");
  const sheetUrl = readArg("sheet-url", "");
  const spreadsheetToken = parseFeishuSpreadsheetToken(readArg("spreadsheet-token", sheetUrl));
  const config = {
    ...readFeishuConfig(configPath),
    spreadsheetToken: spreadsheetToken || readFeishuConfig(configPath).spreadsheetToken
  };

  const token = await getFeishuTenantAccessToken(config);
  console.log(JSON.stringify({
    ok: true,
    step: "tenant_access_token",
    tokenPrefix: token.slice(0, 3),
    tokenLength: token.length
  }, null, 2));

  if (!config.spreadsheetToken) {
    console.log(JSON.stringify({
      ok: true,
      skipped: "spreadsheet",
      reason: "没有提供 --sheet-url 或 spreadsheetToken，仅验证了 app_id/app_secret"
    }, null, 2));
    return;
  }

  const meta = await getFeishuSpreadsheetMeta({ config });
  console.log(JSON.stringify({
    ok: true,
    step: "spreadsheet_meta",
    ...summarizeMeta(meta)
  }, null, 2));

  if (range) {
    const values = await getFeishuSheetValues({ config, range });
    console.log(JSON.stringify({
      ok: true,
      step: "sheet_values",
      range,
      rowCount: values.data?.valueRange?.values?.length || 0,
      preview: (values.data?.valueRange?.values || []).slice(0, 5)
    }, null, 2));
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error.message || String(error),
    status: error.status,
    code: error.code,
    data: error.data
  }, null, 2));
  process.exitCode = 1;
});
