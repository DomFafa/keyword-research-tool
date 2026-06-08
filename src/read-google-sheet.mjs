#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { getGid } from "./lib/google-sheet.mjs";
import {
  DEFAULT_SHEET_URL,
  readToolConfig,
  redactSecrets
} from "./lib/tool-config.mjs";

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

async function main() {
  const sheetUrl = readArg("sheet", process.env.GOOGLE_SHEET_URL || DEFAULT_SHEET_URL);
  const gid = readArg("gid", process.env.GOOGLE_SHEET_GID || getGid(sheetUrl));
  const accountSheetName = readArg("account-sheet", "工具账号密码");
  const keywordSheetName = readArg("keyword-sheet", "词根拓展");
  const keywordTotalSheetName = readArg("keyword-total-sheet", "关键词总表");
  const output = readArg("out", "output/google-sheet-input.json");

  const config = await readToolConfig({
    sheetUrl,
    accountSheetName,
    keywordSheetName,
    keywordTotalSheetName,
    requireTask: false
  });

  const payload = {
    source: {
      sheetUrl,
      gid,
      accountSheetName,
      keywordSheetName,
      keywordTotalSheetName,
      readAt: new Date().toISOString()
    },
    toolAccount: {
      semrush账号: config.toolAccount["semrush账号"] || "",
      运行浏览器账号: config.browserAccount
    },
    sheets: {
      [accountSheetName]: {
        headers: config.accountSheet.headers,
        rows: redactSecrets(config.accountSheet.rows)
      },
      [keywordSheetName]: {
        headers: config.keywordSheet.headers,
        rows: config.keywordSheet.rows
      },
      [keywordTotalSheetName]: {
        headers: config.keywordTotalSheet.headers,
        rows: config.keywordTotalSheet.rows
      }
    }
  };

  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(`Read ${config.accountSheet.rows.length} row(s) from ${accountSheetName}`);
  console.log(`Read ${config.keywordSheet.rows.length} row(s) from ${keywordSheetName}`);
  console.log(`Read ${config.keywordTotalSheet.rows.length} row(s) from ${keywordTotalSheetName}`);
  console.log(`Wrote ${output}`);
  console.log(JSON.stringify(config.keywordSheet.rows[0] || {}, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
