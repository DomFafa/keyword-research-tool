#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { readArg, readFlag } from "./lib/args.mjs";
import {
  attachChromePage,
  CdpClient,
  detachChromePage,
  navigateAndWait,
  readChromeWebSocketEndpoint,
  waitForChromeTargetWithCdp
} from "./lib/cdp.mjs";
import { ensureChromeProfileTargetWithCdp } from "./lib/chrome-profiles.mjs";
import { sleep } from "./lib/browser-actions.mjs";
import { writeCsv, writeJson } from "./lib/files.mjs";
import { getSpreadsheetId } from "./lib/google-sheet.mjs";
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
  openSemrushFromDash
} from "./lib/semrush-page.mjs";

const DASH_LOGIN_URL = "https://dash.3ue.com/zh-Hans/#/login";

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

async function findExistingWorkTarget(cdp) {
  const { targetInfos = [] } = await cdp.send("Target.getTargets");
  const pages = targetInfos.filter((target) => target.type === "page");
  return (
    pages.find((target) => target.url.includes("sem.3ue.com/analytics/keywordmagic")) ||
    pages.find((target) => target.url.includes("sem.3ue.com/analytics/keywordoverview")) ||
    pages.find((target) => target.url.includes("sem.3ue.com")) ||
    pages.find((target) => target.url.includes("dash.3ue.com"))
  );
}

async function openOrAttachWorkPage(cdp, chromeProfile) {
  const existing = await findExistingWorkTarget(cdp);
  if (existing) {
    return attachChromePage(cdp, existing.targetId);
  }

  const target = await ensureChromeProfileTargetWithCdp(cdp, chromeProfile, DASH_LOGIN_URL, 30000);
  return attachChromePage(cdp, target.targetId);
}

async function switchToLatestSemrushPage(cdp, currentPage) {
  await sleep(3000);
  const target = await waitForChromeTargetWithCdp(
    cdp,
    (item) => item.type === "page" && item.url.includes("sem.3ue.com"),
    30000
  );
  if (target.targetId === currentPage.targetId) {
    return currentPage;
  }
  await detachChromePage(cdp, currentPage.sessionId);
  return attachChromePage(cdp, target.targetId);
}

async function collectAllKeywordPagesViaRpc(cdp, sessionId, task, maxPages) {
  const allRows = [];
  const seen = new Set();
  const summary = await fetchKeywordMagicSummary(cdp, sessionId, task);
  const totalPages = summary.total ? Math.ceil(summary.total / 100) : Number.POSITIVE_INFINITY;
  const pageLimit = Math.min(maxPages, totalPages);
  let page = 1;

  while (page <= pageLimit) {
    const result = await fetchKeywordMagicPage(cdp, sessionId, task, page);
    for (const row of result.rows) {
      const key = `${row.keyword}\t${row.volume}\t${row.kd}`;
      if (!seen.has(key)) {
        seen.add(key);
        allRows.push(row);
      }
    }

    const pageLabel = Number.isFinite(totalPages) ? `${page}/${totalPages}` : String(page);
    console.log(`Collect RPC page ${pageLabel}: ${result.rows.length} row(s), ${allRows.length} total unique row(s).`);

    if (result.rows.length === 0 || result.rows.length < 100) {
      break;
    }
    page += 1;
  }

  allRows.filteredKeywordCount = summary.total || allRows.length;
  return allRows;
}

async function copyToClipboard(text) {
  await new Promise((resolve, reject) => {
    const child = spawn("pbcopy", [], { stdio: ["pipe", "ignore", "inherit"] });
    child.stdin.end(text);
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`pbcopy exited ${code}`));
      }
    });
  });
}

async function runCommand(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited ${code}`));
      }
    });
  });
}

async function runCommandOutput(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`${command} exited ${code}: ${stderr.trim()}`));
      }
    });
  });
}

async function systemPasteIntoChrome() {
  await runCommand("osascript", [
    "-e",
    'tell application "Google Chrome" to activate',
    "-e",
    "delay 1",
    "-e",
    'tell application "System Events" to keystroke "v" using command down'
  ]);
}

async function approveRemoteDebuggingPrompt() {
  return runCommandOutput("osascript", [
    "-e",
    `tell application "System Events"
      repeat with p in (every process whose background only is false)
        try
          repeat with w in windows of p
            repeat with b in buttons of w
              try
                set buttonName to name of b as text
                if buttonName contains "允许" or buttonName contains "Allow" then
                  click b
                  return "clicked:" & (name of p as text)
                end if
              end try
            end repeat
          end repeat
        end try
      end repeat
      return "not-found"
    end tell`
  ]).catch((error) => `error:${error.message}`);
}

async function connectChromeCdpWithRecovery() {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const cdp = new CdpClient(readChromeWebSocketEndpoint());
    try {
      await cdp.connect();
      if (attempt > 1) {
        console.log(`Connected to Chrome CDP after ${attempt} attempt(s).`);
      }
      return cdp;
    } catch (error) {
      lastError = error;
      cdp.close();
      const approval = await approveRemoteDebuggingPrompt();
      console.warn(`Chrome CDP connect attempt ${attempt}/5 failed: ${error.message}; prompt=${approval}`);
      await sleep(1500);
    }
  }
  throw lastError;
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

async function pasteTsvToSheetRange(cdp, sheetPage, sheetUrl, gid, range, tsv) {
  const spreadsheetId = getSpreadsheetId(sheetUrl);
  const targetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?gid=${gid}&range=${encodeURIComponent(range)}#gid=${gid}`;
  await copyToClipboard(tsv);
  await cdp.send("Target.activateTarget", { targetId: sheetPage.targetId }).catch(() => {});
  await cdp.send("Page.navigate", { url: targetUrl }, sheetPage.sessionId).catch(() => {});
  await sleep(4000);
  await cdp.send("Target.activateTarget", { targetId: sheetPage.targetId }).catch(() => {});
  await systemPasteIntoChrome();
  await sleep(8000);
}

async function resolveSheetGid(cdp, sessionId, sheetName) {
  const clicked = await cdp.send(
    "Runtime.evaluate",
    {
      awaitPromise: true,
      returnByValue: true,
      expression: `(() => {
        const tabs = [...document.querySelectorAll(".docs-sheet-tab")];
        const tab = tabs.find((item) => (item.innerText || item.textContent || "").trim() === ${JSON.stringify(sheetName)});
        if (!tab) return { ok: false, reason: "sheet tab not found" };
        tab.scrollIntoView({ block: "center", inline: "center" });
        tab.click();
        return { ok: true };
      })()`
    },
    sessionId
  );
  if (clicked.result?.value?.ok === false) {
    throw new Error(clicked.result.value.reason);
  }
  await sleep(1500);
  const urlResult = await cdp.send(
    "Runtime.evaluate",
    {
      returnByValue: true,
      expression: "location.href"
    },
    sessionId
  );
  const url = urlResult.result?.value || "";
  const gid = new URL(url).searchParams.get("gid") || url.match(/[#&?]gid=(\\d+)/)?.[1];
  if (!gid) {
    throw new Error(`Unable to resolve gid for ${sheetName}`);
  }
  return gid;
}

async function pasteRowsToKeywordTotalSheet(cdp, sheetPage, sheetUrl, sheetName, rows, gidOverride) {
  if (rows.length === 0) {
    return { skipped: true };
  }

  const gid = gidOverride || await resolveSheetGid(cdp, sheetPage.sessionId, sheetName);
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

async function writeKeywordTaskUpdates(cdp, sheetPage, sheetUrl, sheet, taskRow, updates) {
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

async function updateKeywordTaskResultSheet(cdp, sheetPage, sheetUrl, sheet, taskRow, result) {
  return writeKeywordTaskUpdates(cdp, sheetPage, sheetUrl, sheet, taskRow, [
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

async function updateKeywordTaskKeywordResultSheet(cdp, sheetPage, sheetUrl, sheet, taskRow) {
  return writeKeywordTaskUpdates(cdp, sheetPage, sheetUrl, sheet, taskRow, [
    {
      header: "SEM完成状态",
      value: "已完成关键词采集"
    }
  ]);
}

async function updateKeywordTaskStatusSheet(cdp, sheetPage, sheetUrl, sheet, taskRow, status) {
  return writeKeywordTaskUpdates(cdp, sheetPage, sheetUrl, sheet, taskRow, [
    {
      header: "SEM完成状态",
      value: status
    }
  ]);
}

async function runSemrushFlow(cdp, page, config, state, statePath, maxPages) {
  const { task, toolAccount } = config;
  const semrushUsername = toolAccount["semrush账号"] || "";
  const semrushPassword = toolAccount["semrush密码"] || toolAccount["密码"] || "";

  if (!semrushUsername || !semrushPassword) {
    throw new Error("工具账号密码 子表缺少 semrush账号 或 semrush密码");
  }

  for (let step = 0; step < 12; step += 1) {
    await closeSemrushCoachmark(cdp, page.sessionId);
    const current = await detectPage(cdp, page.sessionId);
    state.lastDetectedPage = current;
    await saveState(statePath, state);
    console.log(`Page: ${current.kind} ${current.url}`);

    if (current.kind === "dash_login") {
      await loginDash(cdp, page.sessionId, semrushUsername, semrushPassword);
      state.dashLoggedIn = true;
      await saveState(statePath, state);
      continue;
    }

    if (current.kind === "dash_home") {
      await openSemrushFromDash(cdp, page.sessionId);
      state.openedSemrushFromDash = true;
      await saveState(statePath, state);
      page = await switchToLatestSemrushPage(cdp, page);
      continue;
    }

    if (current.kind.startsWith("semrush_")) {
      if (task.mode === "keyword") {
        const metrics = await fetchKeywordOverviewMetrics(cdp, page.sessionId, task.query, task.matchCountry);
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

      const rows = await collectAllKeywordPagesViaRpc(cdp, page.sessionId, task, maxPages);
      state.collectedRows = rows.length;
      state.filteredKeywordCount = rows.filteredKeywordCount || rows.length;
      state.completed = true;
      await saveState(statePath, state);
      return { page, rows, filteredKeywordCount: state.filteredKeywordCount };
    }

    await navigateAndWait(cdp, page.sessionId, DASH_LOGIN_URL, 45000).catch(async () => {
      await sleep(3000);
    });
  }

  throw new Error("Semrush workflow did not reach a terminal state within 12 steps.");
}

async function runOneTask({
  cdp,
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
  const result = await runSemrushFlow(cdp, page, config, state, statePath, maxPages);
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
      cdp,
      baseConfig.targetPage,
      sheetUrl,
      "关键词总表",
      outputRows,
      keywordTotalGid
    );
    await writeJson(path.join(outDir, `${runKey}.sheet-write.json`), sheetWriteResult);
    taskWriteResult = task.mode === "keyword"
      ? await updateKeywordTaskKeywordResultSheet(
          cdp,
          baseConfig.targetPage,
          sheetUrl,
          baseConfig.keywordSheet,
          taskRow
        )
      : await updateKeywordTaskResultSheet(
          cdp,
          baseConfig.targetPage,
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

	  const cdp = await connectChromeCdpWithRecovery();

  let page;
  let config;
	  try {
    console.log("Reading Google Sheet config...");
	    config = await readToolConfig(cdp, {
      sheetUrl,
      taskRow: taskRows[0],
      requireTask: !isBatch
    });
    console.log("Attaching Semrush work page...");
	    page = await openOrAttachWorkPage(cdp, config.chromeProfile);

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
          cdp,
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
            cdp,
            config.targetPage,
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
    if (page) {
      await detachChromePage(cdp, page.sessionId);
    }
    if (config?.targetPage) {
      await detachChromePage(cdp, config.targetPage.sessionId);
    }
    cdp.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
