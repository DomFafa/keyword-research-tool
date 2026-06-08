#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { readArg, readFlag } from "./lib/args.mjs";
import { writeCsv, writeJson } from "./lib/files.mjs";
import {
  batchUpdateSheet,
  formatRejectedKeywordCells,
  getSheetValues,
  updateSheetValues
} from "./lib/google-sheets-api.mjs";
import {
  buildKeywordTotalValues,
  isKeywordTotalHeaderRow,
  KEYWORD_TOTAL_HEADERS
} from "./lib/sheet-write.mjs";
import {
  hasTaskInput,
  isCompletedTask,
  resolveTaskRows,
  shortErrorMessage,
  taskRunKey,
  toOutputRows
} from "./lib/task-batch.mjs";
import { filterKeywordRowsForToolSites } from "./lib/keyword-filter.mjs";
import {
  DEFAULT_SHEET_URL,
  pickKeywordTask,
  readToolConfig
} from "./lib/tool-config.mjs";
import {
  closeSemrushCoachmark,
  detectPage,
  fetchKeywordMagicPage,
  fetchKeywordMagicSummary,
  fetchKeywordOverviewMetrics,
  loginDash,
  openSemrushFromDash,
  sleep
} from "./lib/semrush-page.mjs";
import {
  DASH_LOGIN_URL,
  launchSemrushContext,
  openSemrushLoginPage,
  semrushUserDataDir
} from "./lib/semrush-browser.mjs";

async function readJsonIfExists(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function saveState(filePath, state) {
  await writeJson(filePath, {
    ...state,
    updatedAt: new Date().toISOString()
  });
}

function findExistingWorkPage(context) {
  const pages = context.pages().filter((page) => !page.isClosed());
  return (
    pages.find((page) => page.url().includes("sem.3ue.com/analytics/keywordmagic")) ||
    pages.find((page) => page.url().includes("sem.3ue.com/analytics/keywordoverview")) ||
    pages.find((page) => page.url().includes("sem.3ue.com")) ||
    pages.find((page) => page.url().includes("dash.3ue.com"))
  );
}

async function openOrAttachWorkPage(context) {
  const existing = findExistingWorkPage(context);
  if (existing) {
    await existing.bringToFront().catch(() => {});
    return existing;
  }

  return openSemrushLoginPage(context);
}

async function switchToLatestSemrushPage(context, currentPage) {
  await sleep(3000);
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    const semrushPage = context
      .pages()
      .filter((page) => !page.isClosed())
      .reverse()
      .find((page) => page.url().includes("sem.3ue.com"));
    if (semrushPage) {
      await semrushPage.bringToFront().catch(() => {});
      return semrushPage;
    }
    await sleep(500);
  }
  return currentPage;
}

async function collectAllKeywordPagesViaRpc(page, task, maxPages) {
  const allRows = [];
  const seen = new Set();
  const summary = await fetchKeywordMagicSummary(page, task);
  const totalPages = summary.total ? Math.ceil(summary.total / 100) : Number.POSITIVE_INFINITY;
  const pageLimit = Math.min(maxPages, totalPages);
  let pageNumber = 1;

  while (pageNumber <= pageLimit) {
    const result = await fetchKeywordMagicPage(page, task, pageNumber);
    for (const row of result.rows) {
      const key = `${row.keyword}\t${row.volume}\t${row.kd}`;
      if (!seen.has(key)) {
        seen.add(key);
        allRows.push(row);
      }
    }

    const pageLabel = Number.isFinite(totalPages) ? `${pageNumber}/${totalPages}` : String(pageNumber);
    console.log(`Collect RPC page ${pageLabel}: ${result.rows.length} row(s), ${allRows.length} total unique row(s).`);

    if (result.rows.length === 0 || result.rows.length < 100) {
      break;
    }
    pageNumber += 1;
  }

  allRows.filteredKeywordCount = summary.total || allRows.length;
  return allRows;
}

function columnName(index) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function headerIndex(headers, header) {
  const index = headers.indexOf(header);
  if (index === -1) {
    throw new Error(`子表缺少表头: ${header}`);
  }
  return index;
}

async function pasteRowsToKeywordTotalSheet(sheetUrl, sheetName, rows, gid) {
  if (rows.length === 0) {
    return { skipped: true };
  }

  const existing = await getSheetValues({
    sheetUrl,
    range: `${sheetName}!A:F`
  });
  if (!existing.ok) {
    throw new Error(`读取 ${sheetName} 失败: ${existing.reason || "unknown error"}`);
  }

  const hasHeader = isKeywordTotalHeaderRow(existing.values[0]);
  if (existing.values.length > 0 && !hasHeader) {
    throw new Error(`${sheetName} 表头损坏或缺失，停止写入以避免覆盖旧数据。请先恢复 A1:F1 表头。`);
  }

  if (!hasHeader) {
    const headerWrite = await updateSheetValues({
      sheetUrl,
      range: `${sheetName}!A1:F1`,
      values: [KEYWORD_TOTAL_HEADERS]
    });
    if (!headerWrite.ok) {
      throw new Error(`写入 ${sheetName} 表头失败: ${headerWrite.reason || "unknown error"}`);
    }
  }

  const startRow = hasHeader ? existing.values.length + 1 : 2;
  const endRow = startRow + rows.length - 1;
  const range = `A${startRow}:F${endRow}`;

  let writeResult = await updateSheetValues({
    sheetUrl,
    range: `${sheetName}!${range}`,
    values: buildKeywordTotalValues(rows)
  });
  if (!writeResult.ok && /exceeds grid limits/i.test(writeResult.reason || "")) {
    const expandResult = await batchUpdateSheet({
      sheetUrl,
      requests: [
        {
          appendDimension: {
            sheetId: Number(gid),
            dimension: "ROWS",
            length: Math.max(rows.length + 100, 500)
          }
        }
      ]
    });
    if (!expandResult.ok) {
      throw new Error(`扩展 ${sheetName} 行数失败: ${expandResult.reason || "unknown error"}`);
    }
    writeResult = await updateSheetValues({
      sheetUrl,
      range: `${sheetName}!${range}`,
      values: buildKeywordTotalValues(rows)
    });
  }
  if (!writeResult.ok) {
    throw new Error(`写入 ${sheetName} 失败: ${writeResult.reason || "unknown error"}`);
  }

  const judgementFormatResult = await formatRejectedKeywordCells({
    sheetUrl,
    sheetId: gid,
    startRow,
    rows
  }).catch((error) => ({ ok: false, reason: error.message || String(error) }));

  const verify = await getSheetValues({
    sheetUrl,
    range: `${sheetName}!A:F`
  });

  return {
    gid,
    startRow,
    endRow,
    pastedRows: rows.length,
    rowCountBeforeRead: Math.max(0, existing.values.length - (hasHeader ? 1 : 0)),
    rowCountAfterRead: verify.ok ? Math.max(0, verify.values.length - 1) : null,
    method: "google_sheets_api",
    mode: "append",
    range,
    writeResult,
    judgementFormatResult
  };
}

async function writeKeywordTaskUpdates(sheetUrl, sheet, taskRow, updates) {
  const sheetName = "词根拓展";
  const headers = sheet.headers || [];

  const written = [];
  for (const update of updates) {
    const column = columnName(headerIndex(headers, update.header));
    const range = `${column}${taskRow}`;
    const result = await updateSheetValues({
      sheetUrl,
      range: `${sheetName}!${range}`,
      values: [[update.value]]
    });
    if (!result.ok) {
      throw new Error(`写入 ${sheetName}!${range} 失败: ${result.reason || "unknown error"}`);
    }
    written.push({ ...update, range });
  }

  let verifiedRow = {};
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await sleep(1500);
    const verify = await getSheetValues({
      sheetUrl,
      range: `${sheetName}!A${taskRow}:M${taskRow}`
    });
    const values = verify.ok ? verify.values[0] || [] : [];
    verifiedRow = Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
    const mismatch = updates.find(
      (update) => String(verifiedRow[update.header] || "").trim() !== update.value
    );
    if (!mismatch) {
      return {
        row: taskRow,
        written,
        verified: true
      };
    }
  }

  throw new Error(
    `${sheetName} row ${taskRow} status write verification failed. Last row data: ${JSON.stringify(verifiedRow)}`
  );
}

async function updateKeywordTaskResultSheet(sheetUrl, sheet, taskRow, result) {
  return writeKeywordTaskUpdates(sheetUrl, sheet, taskRow, [
    {
      header: "筛选数量",
      value: String(result.filteredKeywordCount || result.collectedRows)
    },
    {
      header: "SEM完成状态",
      value: `已完成${result.collectedRows}个关键词采集`
    }
  ]);
}

async function updateKeywordTaskKeywordResultSheet(sheetUrl, sheet, taskRow) {
  return writeKeywordTaskUpdates(sheetUrl, sheet, taskRow, [
    {
      header: "SEM完成状态",
      value: "已完成关键词采集"
    }
  ]);
}

async function updateKeywordTaskStatusSheet(sheetUrl, sheet, taskRow, status) {
  return writeKeywordTaskUpdates(sheetUrl, sheet, taskRow, [
    {
      header: "SEM完成状态",
      value: status
    }
  ]);
}

async function runSemrushFlow(context, page, config, state, statePath, maxPages) {
  const { task, toolAccount } = config;
  const semrushUsername = toolAccount["semrush账号"] || "";
  const semrushPassword = toolAccount["semrush密码"] || toolAccount["密码"] || "";

  if (!semrushUsername || !semrushPassword) {
    throw new Error("工具账号密码 子表缺少 semrush账号 或 semrush密码");
  }

  for (let step = 0; step < 12; step += 1) {
    await closeSemrushCoachmark(page);
    const current = await detectPage(page);
    state.lastDetectedPage = current;
    await saveState(statePath, state);
    console.log(`Page: ${current.kind} ${current.url}`);

    if (current.kind === "dash_login") {
      await loginDash(page, semrushUsername, semrushPassword);
      state.dashLoggedIn = true;
      await saveState(statePath, state);
      continue;
    }

    if (current.kind === "dash_home") {
      await openSemrushFromDash(page);
      state.openedSemrushFromDash = true;
      await saveState(statePath, state);
      page = await switchToLatestSemrushPage(context, page);
      continue;
    }

    if (current.kind.startsWith("semrush_")) {
      if (task.mode === "keyword") {
        const metrics = await fetchKeywordOverviewMetrics(page, task.query, task.matchCountry);
        const hasCountry = Boolean(task.matchCountry);
        const rows = [{
          root: "",
          keyword: task.query,
          country: hasCountry ? task.matchCountry : "全球",
          volume: hasCountry ? metrics.localVolume : metrics.globalVolume,
          kd: metrics.kd,
          semrush_page: "keyword_overview"
        }];
        state.keywordOverviewMetrics = metrics;
        state.collectedRows = rows.length;
        state.filteredKeywordCount = rows.length;
        state.completed = true;
        await saveState(statePath, state);
        return { page, rows, filteredKeywordCount: rows.length };
      }

      const rows = await collectAllKeywordPagesViaRpc(page, task, maxPages);
      state.collectedRows = rows.length;
      state.filteredKeywordCount = rows.filteredKeywordCount || rows.length;
      state.completed = true;
      await saveState(statePath, state);
      return { page, rows, filteredKeywordCount: state.filteredKeywordCount };
    }

    await page.goto(DASH_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(async () => {
      await sleep(3000);
    });
  }

  throw new Error("Semrush workflow did not reach a terminal state within 12 steps.");
}

async function runOneTask({
  context,
  page,
  baseConfig,
  sheetUrl,
  taskRow,
  maxPages,
  outDir,
  keywordTotalGid,
  reset,
  skipSheetWrite
}) {
  const task = pickKeywordTask(baseConfig.keywordSheet.rows, taskRow);
  const config = {
    ...baseConfig,
    task
  };
  const runKey = taskRunKey(task);
  const statePath = path.join(outDir, `${runKey}.state.json`);
  const jsonPath = path.join(outDir, `${runKey}.keywords.json`);
  const csvPath = path.join(outDir, `${runKey}.keywords.csv`);
  const state = reset
    ? {}
    : await readJsonIfExists(statePath, {});

  console.log(`Loaded task row ${taskRow}: ${task.query}`);
  const result = await runSemrushFlow(context, page, config, state, statePath, maxPages);
  const outputCountry = task.mode === "keyword"
    ? ""
    : task.matchCountry;
  const rawOutputRows = toOutputRows(result.rows, { country: outputCountry });
  const keywordOverviewRows = rawOutputRows.map((row) => ({
    ...row,
    判断: "继续",
    机器筛选状态: "跳过",
    机器筛选原因: "keyword_overview_flow"
  }));
  const keywordFilterResult = task.mode === "keyword"
    ? {
        rows: keywordOverviewRows,
        accepted: keywordOverviewRows,
        rejected: [],
        summary: {
          enabled: false,
          rawRows: rawOutputRows.length,
          acceptedRows: rawOutputRows.length,
          rejectedRows: 0,
          reason: "keyword_overview_flow"
        }
      }
    : filterKeywordRowsForToolSites(rawOutputRows, task);
  const outputRows = keywordFilterResult.rows;

  await writeJson(jsonPath, {
    source: {
      sheetUrl,
      taskRow,
      query: task.query,
      mode: task.mode,
      collectedAt: new Date().toISOString()
    },
    machineFilter: keywordFilterResult.summary,
    rows: outputRows,
    continueRows: keywordFilterResult.accepted,
    rejectedRows: keywordFilterResult.rejected
  });
  await writeCsv(csvPath, outputRows);

  let sheetWriteResult = { skipped: true };
  let taskWriteResult = { skipped: true };
  if (!skipSheetWrite) {
    sheetWriteResult = await pasteRowsToKeywordTotalSheet(
      sheetUrl,
      "关键词总表",
      outputRows,
      keywordTotalGid
    );
    await writeJson(path.join(outDir, `${runKey}.sheet-write.json`), sheetWriteResult);
    taskWriteResult = task.mode === "keyword"
      ? await updateKeywordTaskKeywordResultSheet(
          sheetUrl,
          baseConfig.keywordSheet,
          taskRow
        )
      : await updateKeywordTaskResultSheet(
          sheetUrl,
          baseConfig.keywordSheet,
          taskRow,
          {
            filteredKeywordCount: result.filteredKeywordCount,
            collectedRows: outputRows.length
          }
        );
    await writeJson(path.join(outDir, `${runKey}.task-write.json`), taskWriteResult);
  }

  console.log(
    `Collected ${rawOutputRows.length} keyword row(s); ${keywordFilterResult.accepted.length} marked 继续, ${keywordFilterResult.rejected.length} marked 拒绝.`
  );
  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${csvPath}`);
  if (sheetWriteResult.skipped) {
    console.log("Skipped Google Sheet write.");
  } else {
    console.log(`Wrote ${sheetWriteResult.pastedRows} row(s) to 关键词总表 from row ${sheetWriteResult.startRow}.`);
  }

  return {
    page: result.page,
    summary: {
      row: taskRow,
      query: task.query,
      mode: task.mode,
      collectedRows: rawOutputRows.length,
      rawCollectedRows: rawOutputRows.length,
      continueRows: keywordFilterResult.accepted.length,
      rejectedRows: keywordFilterResult.rejected.length,
      filteredKeywordCount: result.filteredKeywordCount,
      sheetWriteResult,
      taskWriteResult
    }
  };
}

async function main() {
  const sheetUrl = readArg("sheet", process.env.GOOGLE_SHEET_URL || DEFAULT_SHEET_URL);
  const rowArg = readArg("row", "");
  const fromRowArg = readArg("from-row", "");
  const toRowArg = readArg("to-row", "");
  const taskRows = resolveTaskRows({ rowArg, fromRowArg, toRowArg });
  const isBatch = taskRows.length > 1 || Boolean(fromRowArg || toRowArg);
  const maxPagesArg = readArg("max-pages", "all");
  const maxPages = maxPagesArg === "all" ? Number.POSITIVE_INFINITY : Number(maxPagesArg);
  const outDir = readArg("out-dir", "output/semrush-step1");
  const keywordTotalGid = readArg("keyword-total-gid", "999267438");
  const reset = readFlag("reset");
  const skipSheetWrite = readFlag("skip-sheet-write");
  const force = readFlag("force");
  const stopOnError = readFlag("stop-on-error");

  let page;
  let config;
  const context = await launchSemrushContext();
  try {
    console.log(`Semrush Chrome profile: ${semrushUserDataDir()}`);
    console.log("Reading Google Sheet config...");
    config = await readToolConfig({
      sheetUrl,
      taskRow: taskRows[0],
      requireTask: !isBatch
    });
    console.log("Attaching Semrush work page...");
    page = await openOrAttachWorkPage(context);

    const summaries = [];
    for (const taskRow of taskRows) {
      const row = config.keywordSheet.rows[taskRow - 2];
      if (!hasTaskInput(row)) {
        console.log(`Skip row ${taskRow}: empty task row.`);
        summaries.push({ row: taskRow, skipped: true, reason: "empty" });
        continue;
      }
      if (isBatch && !force && isCompletedTask(row)) {
        console.log(`Skip row ${taskRow}: already completed. Use --force to rerun.`);
        summaries.push({ row: taskRow, skipped: true, reason: "completed" });
        continue;
      }

      try {
        const result = await runOneTask({
          context,
          page,
          baseConfig: config,
          sheetUrl,
          taskRow,
          maxPages,
          outDir,
          keywordTotalGid,
          reset,
          skipSheetWrite
        });
        page = result.page;
        summaries.push(result.summary);
      } catch (error) {
        const status = `失败：${shortErrorMessage(error)}`;
        console.error(`Row ${taskRow} failed: ${shortErrorMessage(error)}`);
        summaries.push({ row: taskRow, failed: true, error: shortErrorMessage(error) });
        if (!skipSheetWrite) {
          await updateKeywordTaskStatusSheet(
            sheetUrl,
            config.keywordSheet,
            taskRow,
            status
          ).catch((writeError) => {
            console.error(`Unable to write failure status for row ${taskRow}: ${shortErrorMessage(writeError)}`);
          });
        }
        if (!isBatch || stopOnError) {
          throw error;
        }
      }
    }

    await writeJson(path.join(outDir, "last-run-summary.json"), {
      sheetUrl,
      rows: taskRows,
      batch: isBatch,
      summaries
    });
    console.log(`Run summary: ${summaries.length} row(s) handled.`);
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
