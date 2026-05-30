#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { readArg, readFlag } from "./lib/args.mjs";
import { loadDotEnv } from "./lib/env.mjs";
import { writeJson } from "./lib/files.mjs";
import { getSheetValues, updateSheetValues } from "./lib/google-sheets-api.mjs";
import { DEFAULT_SHEET_URL } from "./lib/tool-config.mjs";
import {
  columnName,
  valuesToTable
} from "./lib/table-utils.mjs";
import {
  AGENT_STATUS_COLUMN,
  evaluateKeywordAgentRow,
  targetAgentColumns
} from "./lib/keyword-agent-rules.mjs";
import { evaluateKeywordRowsWithOpenAI } from "./lib/openai-keyword-agent.mjs";

const TASK_SHEET = "词根拓展";
const KEYWORD_TOTAL_SHEET = "关键词总表";
const DEFAULT_LIMIT = 20;

loadDotEnv();

export { AGENT_STATUS_COLUMN };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function buildRuleIndex(taskTable) {
  const byRoot = new Map();
  const byKeyword = new Map();
  for (const row of taskTable.rows) {
    const root = normalizeKey(row.record["词根"]);
    const keyword = normalizeKey(row.record["关键词"]);
    if (root) {
      byRoot.set(root, row.record);
    }
    if (keyword) {
      byKeyword.set(keyword, row.record);
    }
  }
  return { byRoot, byKeyword };
}

function findRule(keywordRow, ruleIndex) {
  const root = normalizeKey(keywordRow.record["词根"]);
  const keyword = normalizeKey(keywordRow.record["关键词"]);
  if (root && ruleIndex.byRoot.has(root)) {
    return ruleIndex.byRoot.get(root);
  }
  if (keyword && ruleIndex.byKeyword.has(keyword)) {
    return ruleIndex.byKeyword.get(keyword);
  }
  return null;
}

function normalizedHeaderIndex(headers, header, tableName = KEYWORD_TOTAL_SHEET) {
  const expected = String(header || "").trim();
  const index = headers.findIndex((candidate) => String(candidate || "").trim() === expected);
  if (index === -1) {
    throw new Error(`${tableName} 缺少表头: ${header}`);
  }
  return index;
}

function optionalNormalizedHeaderIndex(headers, header) {
  const expected = String(header || "").trim();
  return headers.findIndex((candidate) => String(candidate || "").trim() === expected);
}

export function validateHeaders(headers) {
  const required = [
    "词根",
    "关键词",
    "bing二次判断",
    ...targetAgentColumns()
  ];
  const normalized = new Set(headers.map((header) => String(header || "").trim()));
  const missing = required.filter((header) => !normalized.has(header));
  if (missing.length > 0) {
    throw new Error(`${KEYWORD_TOTAL_SHEET} 缺少表头: ${missing.join(", ")}`);
  }
}

function selectRows(keywordTable, { fromRow, toRow, limit }) {
  const bingSecondIndex = normalizedHeaderIndex(keywordTable.headers, "bing二次判断");
  const keywordIndex = normalizedHeaderIndex(keywordTable.headers, "关键词");
  const selected = [];

  for (const row of keywordTable.rows) {
    if (fromRow && row.rowNumber < fromRow) {
      continue;
    }
    if (toRow && row.rowNumber > toRow) {
      break;
    }
    const keyword = String(row.values[keywordIndex] || "").trim();
    if (!keyword) {
      continue;
    }
    const bingSecond = String(row.values[bingSecondIndex] || "").trim();
    if (bingSecond !== "继续") {
      continue;
    }
    selected.push(row);
    if (limit && selected.length >= limit) {
      break;
    }
  }

  return selected;
}

function buildRowUpdate(headers, row, proposedValues, { force = false } = {}) {
  const values = [...row.values];
  while (values.length < headers.length) {
    values.push("");
  }

  const changed = [];
  for (const [header, value] of Object.entries(proposedValues)) {
    const index = optionalNormalizedHeaderIndex(headers, header);
    if (index === -1) {
      continue;
    }
    if (!force && String(values[index] || "").trim()) {
      continue;
    }
    values[index] = value;
    changed.push(header);
  }

  return { values, changed };
}

function hasBlankTargetColumn(headers, row) {
  return targetAgentColumns().some((header) => {
    const index = optionalNormalizedHeaderIndex(headers, header);
    return index !== -1 && !String(row.values[index] || "").trim();
  });
}

export function shouldSkipKeywordAgentRow({ headers, row, force = false }) {
  if (force) {
    return { skip: false, reason: "" };
  }

  const statusIndex = optionalNormalizedHeaderIndex(headers, AGENT_STATUS_COLUMN);
  if (statusIndex !== -1) {
    const status = String(row.values[statusIndex] || "").trim();
    if (status === "完成") {
      return { skip: true, reason: "agent_status_done" };
    }
    if (status === "排除") {
      return { skip: true, reason: "agent_status_excluded" };
    }
  }

  if (!hasBlankTargetColumn(headers, row)) {
    return { skip: true, reason: "target_columns_already_filled" };
  }

  return { skip: false, reason: "" };
}

async function readRequiredSheet(sheetUrl, range) {
  const result = await getSheetValues({ sheetUrl, range });
  if (!result.ok) {
    throw new Error(`读取 ${range} 失败: ${result.reason || "unknown error"}`);
  }
  return valuesToTable(result.values || []);
}

async function writeKeywordRow({ sheetUrl, headers, rowNumber, values }) {
  const lastColumn = columnName(headers.length - 1);
  let lastResult;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    lastResult = await updateSheetValues({
      sheetUrl,
      range: `${KEYWORD_TOTAL_SHEET}!A${rowNumber}:${lastColumn}${rowNumber}`,
      values: [values.slice(0, headers.length)]
    });
    if (lastResult.ok) {
      return lastResult;
    }
    const reason = String(lastResult.reason || "");
    const quotaLimited = lastResult.status === 429 || /quota|rate|too many/i.test(reason);
    if (!quotaLimited || attempt >= 5) {
      return lastResult;
    }
    const waitMs = 65000 + (attempt - 1) * 10000;
    console.warn(`写入第 ${rowNumber} 行触发限流，等待 ${Math.round(waitMs / 1000)} 秒后重试 (${attempt}/5)`);
    await sleep(waitMs);
  }
  return lastResult;
}

async function main() {
  const sheetUrl = readArg("sheet", process.env.GOOGLE_SHEET_URL || DEFAULT_SHEET_URL);
  const fromRow = Number(readArg("from-row", "0")) || 0;
  const toRow = Number(readArg("to-row", "0")) || 0;
  const limit = Number(readArg("limit", String(DEFAULT_LIMIT))) || DEFAULT_LIMIT;
  const dryRun = readFlag("dry-run");
  const force = readFlag("force");
  const mode = readArg("mode", "llm");
  const model = readArg("model", process.env.OPENAI_MODEL || "");
  const out = readArg("out", "output/keyword-agent/last-run-summary.json");
  const writeDelayMs = Number(readArg("write-delay-ms", "1200")) || 1200;

  const [taskTable, keywordTable] = await Promise.all([
    readRequiredSheet(sheetUrl, `${TASK_SHEET}!A:S`),
    readRequiredSheet(sheetUrl, `${KEYWORD_TOTAL_SHEET}!A:AZ`)
  ]);

  validateHeaders(keywordTable.headers);
  const ruleIndex = buildRuleIndex(taskTable);
  const selectedRows = selectRows(keywordTable, { fromRow, toRow, limit });
  const summaries = [];
  const pending = [];

  for (const row of selectedRows) {
    const keyword = String(row.record["关键词"] || "").trim();
    const rule = findRule(row, ruleIndex);
    if (!rule) {
      summaries.push({
        row: row.rowNumber,
        keyword,
        status: "skipped",
        reason: "missing_rule"
      });
      continue;
    }

    const skip = shouldSkipKeywordAgentRow({
      headers: keywordTable.headers,
      row,
      force
    });
    if (skip.skip) {
      summaries.push({
        row: row.rowNumber,
        keyword,
        status: "skipped",
        reason: skip.reason
      });
      continue;
    }

    pending.push({
      row,
      rowNumber: row.rowNumber,
      keyword,
      rule,
      keywordRecord: row.record
    });
  }

  const evaluations = mode === "rules"
    ? pending.map((item) => ({
        rowNumber: item.rowNumber,
        values: evaluateKeywordAgentRow(item.row, item.rule).values,
        modelRationale: ""
      }))
    : await evaluateKeywordRowsWithOpenAI(pending, { model: model || undefined });
  const evaluationByRow = new Map(evaluations.map((evaluation) => [Number(evaluation.rowNumber), evaluation]));

  for (const item of pending) {
    const row = item.row;
    const keyword = item.keyword;
    const evaluation = evaluationByRow.get(Number(row.rowNumber));
    if (!evaluation) {
      summaries.push({
        row: row.rowNumber,
        keyword,
        status: "skipped",
        reason: "missing_evaluation"
      });
      continue;
    }
    const { values, changed } = buildRowUpdate(keywordTable.headers, row, evaluation.values, { force });
    if (changed.length === 0) {
      summaries.push({
        row: row.rowNumber,
        keyword,
        status: "skipped",
        reason: "target_columns_already_filled"
      });
      continue;
    }

    let writeResult = { skipped: true, dryRun };
    if (!dryRun) {
      writeResult = await writeKeywordRow({
        sheetUrl,
        headers: keywordTable.headers,
        rowNumber: row.rowNumber,
        values
      });
      if (!writeResult.ok) {
        throw new Error(`写入第 ${row.rowNumber} 行失败: ${writeResult.reason || "unknown error"}`);
      }
    }

    summaries.push({
      row: row.rowNumber,
      keyword,
      status: dryRun ? "dry-run" : "updated",
      mode,
      model: mode === "rules" ? "" : (model || process.env.OPENAI_MODEL || "gpt-5.4-mini"),
      changed,
      values: Object.fromEntries(changed.map((header) => [header, values[normalizedHeaderIndex(keywordTable.headers, header)]])),
      modelRationale: evaluation.modelRationale,
      writeResult
    });
    if (!dryRun && writeDelayMs > 0) {
      await sleep(writeDelayMs);
    }
  }

  const summary = {
    source: {
      sheetUrl,
      taskSheet: TASK_SHEET,
      keywordSheet: KEYWORD_TOTAL_SHEET,
      dryRun,
      force,
      mode,
      model: mode === "rules" ? "" : (model || process.env.OPENAI_MODEL || "gpt-5.4-mini"),
      writeDelayMs,
      limit,
      fromRow,
      toRow,
      ranAt: new Date().toISOString()
    },
    selectedRows: selectedRows.length,
    updatedRows: summaries.filter((item) => item.status === "updated" || item.status === "dry-run").length,
    skippedRows: summaries.filter((item) => item.status === "skipped").length,
    rows: summaries
  };

  await writeJson(out, summary);
  console.log(`${dryRun ? "Dry-run" : "Updated"} ${summary.updatedRows}/${summary.selectedRows} selected row(s).`);
  console.log(`Wrote ${out}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message || String(error));
    process.exit(1);
  });
}
