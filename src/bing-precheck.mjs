#!/usr/bin/env node
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import {
  attachChromePage,
  CdpClient,
  createChromePage,
  detachChromePage,
  evaluate,
  navigateAndWait,
  readChromeWebSocketEndpoint,
  waitForChromeTargetWithCdp
} from "./lib/cdp.mjs";
import { sleep } from "./lib/browser-actions.mjs";
import {
  buildBingKeywordResearchUrl,
  fetchBingKeywordResearchViaPageApis,
  fetchBingTopSearchUrlsViaBrowser,
  keywordResearchUrlMatchesSite,
  navigateToBingKeywordResearch,
  searchBingKeyword
} from "./lib/bing-page.mjs";
import {
  getKeywordResearchMetrics,
  getKeywordCountryRows,
  isBingThrottleError,
  parseCountryCodes,
  readBingWebmasterApiKeys,
  shouldUseBingApiMetrics
} from "./lib/bing-webmaster-api.mjs";
import {
  evaluateBingPrecheck,
  formatInteger,
  sortCountryBreakdown,
  summarizeTopUrlCompetition
} from "./lib/bing-precheck.mjs";
import { readArg, readFlag } from "./lib/args.mjs";
import { findChromeProfile, openChromeProfileUrl } from "./lib/chrome-profiles.mjs";
import { readFeishuBingRegistry } from "./lib/feishu-registry.mjs";
import {
  formatCellBackgrounds,
  getSheetValues,
  updateSheetValues
} from "./lib/google-sheets-api.mjs";
import { DEFAULT_SHEET_URL } from "./lib/tool-config.mjs";
import { writeJson } from "./lib/files.mjs";

const ACCOUNT_SHEET = "工具账号密码";
const TASK_SHEET = "词根拓展";
const KEYWORD_TOTAL_SHEET = "关键词总表";
const DEFAULT_SITE_URL = "https://2fafree.com/";

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

function rowToObject(headers, row) {
  return Object.fromEntries(headers.map((header, index) => [header, row?.[index] || ""]));
}

function valuesToTable(values) {
  const headers = values[0] || [];
  return {
    headers,
    rows: values.slice(1).map((row, index) => ({
      rowNumber: index + 2,
      values: row,
      record: rowToObject(headers, row)
    }))
  };
}

function headerIndex(headers, header) {
  const index = headers.indexOf(header);
  if (index === -1) {
    throw new Error(`${KEYWORD_TOTAL_SHEET} 缺少表头: ${header}`);
  }
  return index;
}

function isActualBingWebmasterApiKey(value) {
  return /^[a-f0-9]{32}$/i.test(String(value || "").trim());
}

async function readBingMetricApiKeys({ source = "auto", startFingerprintName = "25", startFeishuRow = 0 } = {}) {
  const normalizedSource = String(source || "auto").trim().toLowerCase();
  const feishuKeys = async () => {
    const rows = await readFeishuBingRegistry({
      startFingerprintName,
      requireBingApi: true,
      requireFingerprint: false
    });
    return rows
      .filter((row) => !startFeishuRow || row.rowNumber >= startFeishuRow)
      .map((row) => row.bingWebmasterApi)
      .filter(isActualBingWebmasterApiKey);
  };
  if (normalizedSource === "feishu") {
    return feishuKeys();
  }
  if (normalizedSource === "local" || normalizedSource === "file") {
    return readBingWebmasterApiKeys();
  }
  try {
    const keys = await feishuKeys();
    if (keys.length > 0) {
      return keys;
    }
  } catch (error) {
    console.warn(`Feishu Bing Webmaster API key unavailable, fallback to local file: ${error.message || String(error)}`);
  }
  return readBingWebmasterApiKeys();
}

function optionalHeaderIndex(headers, header) {
  return headers.indexOf(header);
}

function uniqueNonEmpty(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function readBingAccounts(accountTable) {
  const headers = accountTable.headers;
  const index = headers.indexOf("bing webmaster所在的chrome账号");
  if (index === -1) {
    throw new Error(`${ACCOUNT_SHEET} 缺少表头: bing webmaster所在的chrome账号`);
  }
  const accounts = uniqueNonEmpty(accountTable.rows.map((row) => row.values[index]));
  if (accounts.length === 0) {
    throw new Error(`${ACCOUNT_SHEET} 没有填写 bing webmaster所在的chrome账号`);
  }
  return accounts;
}

function filterBingAccounts(accounts, requestedAccount) {
  const expected = String(requestedAccount || "").trim().toLowerCase();
  if (!expected) {
    return accounts;
  }
  const filtered = accounts.filter((account) => String(account || "").trim().toLowerCase() === expected);
  if (filtered.length === 0) {
    throw new Error(`工具账号密码 中没有找到 Bing Chrome 账号: ${requestedAccount}`);
  }
  return filtered;
}

function buildRuleIndex(taskTable) {
  const rootRules = new Map();
  const keywordRules = new Map();
  for (const row of taskTable.rows) {
    const root = String(row.record["词根"] || "").trim();
    const keyword = String(row.record["关键词"] || "").trim();
    if (root) {
      const list = rootRules.get(root.toLowerCase()) || [];
      list.push(row);
      rootRules.set(root.toLowerCase(), list);
    }
    if (keyword) {
      const list = keywordRules.get(keyword.toLowerCase()) || [];
      list.push(row);
      keywordRules.set(keyword.toLowerCase(), list);
    }
  }
  return { rootRules, keywordRules };
}

function findRuleForKeywordRow(keywordRow, ruleIndex) {
  const root = String(keywordRow.record["词根"] || "").trim();
  const keyword = String(keywordRow.record["关键词"] || "").trim();
  const candidates = root
    ? ruleIndex.rootRules.get(root.toLowerCase()) || []
    : ruleIndex.keywordRules.get(keyword.toLowerCase()) || [];
  if (candidates.length !== 1) {
    const source = root ? `词根=${root}` : `关键词=${keyword}`;
    throw new Error(`Bing 规则${candidates.length === 0 ? "不存在" : "不唯一"}: ${KEYWORD_TOTAL_SHEET} 第 ${keywordRow.rowNumber} 行 ${source}`);
  }
  return candidates[0];
}

function selectKeywordRows(keywordTable, { fromRow, toRow, force, onlyTop5Zero, onlyMissingCountry, chromeOnly, countryOnly }) {
  const judgementIndex = headerIndex(keywordTable.headers, "判断");
  const bingJudgementIndex = optionalHeaderIndex(keywordTable.headers, "bing初步判断");
  const bingSecondJudgementIndex = optionalHeaderIndex(keywordTable.headers, "bing二次判断");
  const top5Index = optionalHeaderIndex(keywordTable.headers, "top5根域名数量");
  const top1CountryIndex = optionalHeaderIndex(keywordTable.headers, "top 1国家");
  const ratingIndex = optionalHeaderIndex(keywordTable.headers, "评级");
  if (countryOnly && ratingIndex === -1) {
    throw new Error(`${KEYWORD_TOTAL_SHEET} 缺少表头: 评级`);
  }
  const selected = [];
  for (const row of keywordTable.rows) {
    if (fromRow && row.rowNumber < fromRow) {
      continue;
    }
    if (toRow && row.rowNumber > toRow) {
      break;
    }
    const judgement = String(row.values[judgementIndex] || "").trim();
    if (!judgement && !toRow) {
      break;
    }
    if (onlyTop5Zero && String(row.values[top5Index] || "").trim() !== "0") {
      continue;
    }
    const bingJudgement = bingJudgementIndex === -1 ? "" : String(row.values[bingJudgementIndex] || "").trim();
    if (countryOnly) {
      const rating = ratingIndex === -1 ? "" : String(row.values[ratingIndex] || "").trim();
      if (rating !== "A") {
        continue;
      }
      if (onlyMissingCountry && top1CountryIndex !== -1 && String(row.values[top1CountryIndex] || "").trim()) {
        continue;
      }
      selected.push(row);
      continue;
    }
    if (judgement !== "继续") {
      continue;
    }
    if (onlyMissingCountry) {
      if (bingJudgement !== "继续") {
        continue;
      }
      if (String(row.values[top1CountryIndex] || "").trim()) {
        continue;
      }
    }
    if (chromeOnly) {
      const bingJudgement = bingJudgementIndex === -1 ? "" : String(row.values[bingJudgementIndex] || "").trim();
      const bingSecondJudgement = bingSecondJudgementIndex === -1 ? "" : String(row.values[bingSecondJudgementIndex] || "").trim();
      if (bingJudgement !== "继续") {
        continue;
      }
      if (bingSecondJudgement && !force) {
        continue;
      }
      selected.push(row);
      continue;
    }
    if (bingJudgement && !force) {
      continue;
    }
    selected.push(row);
  }
  return selected;
}

function evaluateBingApiPrecheck({ impressions, minImpressions }) {
  const impressionsNumber = Number(String(impressions || "").replace(/,/g, "")) || 0;
  const minImpressionsNumber = Number(String(minImpressions || "").replace(/,/g, "")) || 0;
  const impressionFailed = minImpressionsNumber > 0 && impressionsNumber < minImpressionsNumber;
  return {
    judgement: impressionFailed ? "拒绝" : "继续",
    impressionsNumber,
    minImpressionsNumber,
    impressionFailed
  };
}

async function approveRemoteDebuggingPrompt() {
  return new Promise((resolve) => {
    const child = spawn("osascript", [
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
    ], { stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.once("exit", () => resolve(stdout.trim() || "not-found"));
    child.once("error", (error) => resolve(`error:${error.message}`));
  });
}

async function connectChromeCdpWithRecovery() {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const cdp = new CdpClient(readChromeWebSocketEndpoint());
    try {
      await cdp.connect();
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

function isBingAccountLimitError(error) {
  return /BING_ACCOUNT_LIMIT|quota|daily limit|usage limit|limit reached|too many requests|try again tomorrow|达到.*限制|次数.*限制|稍后再试/i.test(error?.message || String(error));
}

function isBingAccountSwitchableError(error) {
  return isBingAccountLimitError(error) ||
    /BING_TOP_URLS_EMPTY/i.test(error?.message || String(error)) ||
    /BING_ACCOUNT_UNAVAILABLE_FOR_SITE/i.test(error?.message || String(error));
}

function createAllBingApiKeysThrottledError(rowNumber) {
  const error = new Error(`所有 Bing Webmaster API key 都已达到限额，停止在第 ${rowNumber} 行`);
  error.name = "AllBingApiKeysThrottledError";
  return error;
}

function isAllBingApiKeysThrottledError(error) {
  return error?.name === "AllBingApiKeysThrottledError";
}

function isTransientBingAutomationError(error) {
  return /BING_API_CAPTURE_TIMEOUT|BING_TOP_URLS_EMPTY|Timed out waiting for CDP response|Timed out while loading|Target closed|WebSocket/i.test(
    error?.message || String(error)
  );
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function closeDuplicateBingTabs(cdp, keepTargetId, siteUrl) {
  const { targetInfos = [] } = await cdp.send("Target.getTargets");
  const duplicates = targetInfos.filter(
    (target) =>
      target.type === "page" &&
      target.targetId !== keepTargetId &&
      keywordResearchUrlMatchesSite(target.url, siteUrl)
  );
  for (const target of duplicates) {
    await cdp.send("Target.closeTarget", { targetId: target.targetId }).catch(() => {});
  }
  return duplicates.length;
}

async function openOrAttachBingPage(cdp, profile, siteUrl, { reuseExisting = true, cleanDuplicates = false } = {}) {
  const targetUrl = buildBingKeywordResearchUrl(siteUrl);
  const { targetInfos = [] } = await cdp.send("Target.getTargets");
  if (reuseExisting) {
    const existing = targetInfos.find(
      (target) => target.type === "page" && keywordResearchUrlMatchesSite(target.url, siteUrl)
    );
    if (existing) {
      if (cleanDuplicates) {
        const closed = await closeDuplicateBingTabs(cdp, existing.targetId, siteUrl);
        if (closed > 0) {
          console.log(`Closed ${closed} duplicate Bing Keyword Research tab(s).`);
        }
      }
      return attachChromePage(cdp, existing.targetId);
    }
  }

  const beforeTargetIds = new Set(targetInfos.map((target) => target.targetId));
  await openChromeProfileUrl(profile, targetUrl).catch(() => {});
  const target = await waitForChromeTargetWithCdp(
    cdp,
    (item) =>
      item.type === "page" &&
      item.url.includes("bing.com/webmasters/keywordresearch") &&
      !beforeTargetIds.has(item.targetId),
    15000
  ).catch(async () => {
    const created = await createChromePage(cdp, targetUrl);
    return { targetId: created.targetId, _attachedPage: created };
  });
  if (target._attachedPage) {
    return target._attachedPage;
  }
  if (cleanDuplicates) {
    const closed = await closeDuplicateBingTabs(cdp, target.targetId, siteUrl);
    if (closed > 0) {
      console.log(`Closed ${closed} duplicate Bing Keyword Research tab(s).`);
    }
  }
  return attachChromePage(cdp, target.targetId);
}

async function readRequiredSheet(sheetUrl, range) {
  const result = await getSheetValues({ sheetUrl, range });
  if (!result.ok) {
    throw new Error(`读取 ${range} 失败: ${result.reason || "unknown error"}`);
  }
  return valuesToTable(result.values || []);
}

function buildKeywordTotalUpdates(keywordHeaders, keywordRow, precheck, competition) {
  const updates = new Map();
  const set = (header, value) => {
    const index = headerIndex(keywordHeaders, header);
    updates.set(index, value);
  };

  set("3M展示", formatInteger(precheck.impressionsNumber));
  set("top5根域名数量", String(competition.count));
  set("bing初步判断", precheck.judgement);

  const clearDomainFields = () => {
    set("根域名1", "");
    set("根域名1排名", "");
    set("根域名2", "");
    set("根域名2排名", "");
  };

  if (precheck.judgement !== "拒绝") {
    const topDomains = competition.domains.slice(0, 2);
    set("根域名1", topDomains[0]?.domain || "");
    set("根域名1排名", topDomains[0]?.rank ? String(topDomains[0].rank) : "");
    set("根域名2", topDomains[1]?.domain || "");
    set("根域名2排名", topDomains[1]?.rank ? String(topDomains[1].rank) : "");
  } else {
    clearDomainFields();
  }

  const existing = [...keywordRow.values];
  for (const [columnIndex, value] of updates.entries()) {
    existing[columnIndex] = value;
  }
  return existing;
}

function findTopCountrySlots(keywordHeaders) {
  return keywordHeaders
    .map((header) => {
      const match = String(header || "").match(/^top\s*(\d+)\s*国家$/i);
      if (!match) return null;
      const slot = Number(match[1]);
      const impressionHeader = keywordHeaders.find((candidate) => {
        const text = String(candidate || "");
        return new RegExp(`^top\\s*${slot}\\s*展示量$`, "i").test(text);
      });
      return Number.isFinite(slot) && impressionHeader ? {
        slot,
        countryHeader: header,
        impressionHeader
      } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.slot - b.slot);
}

function buildKeywordTotalApiUpdates(keywordHeaders, keywordRow, apiPrecheck) {
  const updates = new Map();
  const set = (header, value) => {
    const index = headerIndex(keywordHeaders, header);
    updates.set(index, value);
  };

  set("3M展示", formatInteger(apiPrecheck.impressionsNumber));
  set("bing初步判断", apiPrecheck.judgement);

  for (const header of [
    "top5根域名数量",
    "bing二次判断",
    "根域名1",
    "根域名1排名",
    "根域名2",
    "根域名2排名"
  ]) {
    set(header, "");
  }

  const existing = [...keywordRow.values];
  for (const [columnIndex, value] of updates.entries()) {
    existing[columnIndex] = value;
  }
  return existing;
}

function buildKeywordTotalCountryUpdates(keywordHeaders, keywordRow, countryTopRows) {
  const updates = new Map();
  const set = (header, value) => {
    const index = headerIndex(keywordHeaders, header);
    updates.set(index, value);
  };
  const slots = findTopCountrySlots(keywordHeaders);
  const topCountries = countryTopRows.slice(0, slots.length);
  for (const slot of slots) {
    const row = topCountries[slot.slot - 1];
    set(slot.countryHeader, row?.country || "");
    set(slot.impressionHeader, formatInteger(row?.impressionsNumber ?? ""));
  }
  const existing = [...keywordRow.values];
  for (const [columnIndex, value] of updates.entries()) {
    existing[columnIndex] = value;
  }
  return existing;
}

function buildKeywordTotalChromeUpdates(keywordHeaders, keywordRow, chromePrecheck, competition) {
  const updates = new Map();
  const set = (header, value) => {
    const index = headerIndex(keywordHeaders, header);
    updates.set(index, value);
  };

  set("top5根域名数量", String(competition.count));
  set("bing二次判断", chromePrecheck.judgement);

  if (chromePrecheck.judgement !== "拒绝") {
    const topDomains = competition.domains.slice(0, 2);
    set("根域名1", topDomains[0]?.domain || "");
    set("根域名1排名", topDomains[0]?.rank ? String(topDomains[0].rank) : "");
    set("根域名2", topDomains[1]?.domain || "");
    set("根域名2排名", topDomains[1]?.rank ? String(topDomains[1].rank) : "");
  } else {
    set("根域名1", "");
    set("根域名1排名", "");
    set("根域名2", "");
    set("根域名2排名", "");
  }

  const existing = [...keywordRow.values];
  for (const [columnIndex, value] of updates.entries()) {
    existing[columnIndex] = value;
  }
  return existing;
}

async function writeKeywordTotalRow({ sheetUrl, rowNumber, headers, values }) {
  const endColumn = columnName(Math.max(headers.length, values.length) - 1);
  const result = await updateSheetValues({
    sheetUrl,
    range: `${KEYWORD_TOTAL_SHEET}!A${rowNumber}:${endColumn}${rowNumber}`,
    values: [values.slice(0, Math.max(headers.length, values.length))]
  });
  if (!result.ok) {
    throw new Error(`写入 ${KEYWORD_TOTAL_SHEET} 第 ${rowNumber} 行失败: ${result.reason || "unknown error"}`);
  }
  return result;
}

async function processKeywordRow({
  cdp,
  page,
  sheetUrl,
  siteUrl,
  keywordTotalGid,
  keywordTable,
  keywordRow,
  rule,
  bingApiKey,
  useBingApiMetrics,
  bingApiCountryConcurrency,
  bingApiCountryRequestDelayMs
}) {
  const keyword = String(keywordRow.record["关键词"] || "").trim();
  const minImpressions = rule.record["bing最低展示量"] || "";
  const maxTop5Domains = rule.record["Max root on Bing top 5url"] || "";

  let extracted;
  if (useBingApiMetrics && bingApiKey) {
    const metrics = await getKeywordResearchMetrics({
      apiKey: bingApiKey,
      keyword,
      countryCodes: [],
      countryConcurrency: bingApiCountryConcurrency,
      countryRequestDelayMs: bingApiCountryRequestDelayMs
    });
    const topUrls = await fetchBingTopSearchUrlsViaBrowser(cdp, page.sessionId, { keyword, siteUrl });
    extracted = {
      impressions: metrics.impressions,
      topUrls,
      countryRows: metrics.countryRows,
      source: "bing-webmaster-api"
    };
  } else {
    extracted = await fetchBingKeywordResearchViaPageApis(cdp, page.sessionId, { keyword, siteUrl });
  }
  const competition = summarizeTopUrlCompetition(extracted.topUrls, 5);
  const precheck = evaluateBingPrecheck({
    impressions: extracted.impressions,
    minImpressions,
    top5DomainCount: competition.count,
    maxTop5Domains
  });

  const values = buildKeywordTotalUpdates(
    keywordTable.headers,
    keywordRow,
    precheck,
    competition
  );
  const writeResult = await writeKeywordTotalRow({
    sheetUrl,
    rowNumber: keywordRow.rowNumber,
    headers: keywordTable.headers,
    values
  });

  const redCells = [];
  const ruleCells = [
    { row: keywordRow.rowNumber, column: headerIndex(keywordTable.headers, "3M展示") },
    { row: keywordRow.rowNumber, column: headerIndex(keywordTable.headers, "top5根域名数量") }
  ];
  await formatCellBackgrounds({
    sheetUrl,
    sheetId: keywordTotalGid,
    cells: ruleCells,
    color: { red: 1, green: 1, blue: 1 }
  }).catch(() => ({ skipped: true }));

  if (precheck.impressionFailed) {
    redCells.push(ruleCells[0]);
  }
  if (precheck.top5DomainFailed) {
    redCells.push(ruleCells[1]);
  }
  const formatResult = await formatCellBackgrounds({
    sheetUrl,
    sheetId: keywordTotalGid,
    cells: redCells
  }).catch((error) => ({ ok: false, reason: error.message || String(error) }));
  const pendingFormatResult = await formatCellBackgrounds({
    sheetUrl,
    sheetId: keywordTotalGid,
    cells: precheck.top5DomainPending ? [ruleCells[1]] : [],
    color: { red: 1, green: 0.9, blue: 0 }
  }).catch((error) => ({ ok: false, reason: error.message || String(error) }));

  return {
    row: keywordRow.rowNumber,
    keyword,
    judgement: precheck.judgement,
    impressions: formatInteger(precheck.impressionsNumber),
    top5DomainCount: competition.count,
    domains: competition.domains.slice(0, 2),
    topCountries: [],
    writeResult,
    formatResult,
    pendingFormatResult
  };
}

async function processKeywordRowApiOnly({
  sheetUrl,
  keywordTotalGid,
  keywordTable,
  keywordRow,
  rule,
  bingApiKey,
  bingApiCountryConcurrency,
  bingApiCountryRequestDelayMs
}) {
  const keyword = String(keywordRow.record["关键词"] || "").trim();
  const minImpressions = rule.record["bing最低展示量"] || "";
  const metrics = await getKeywordResearchMetrics({
    apiKey: bingApiKey,
    keyword,
    countryCodes: [],
    countryConcurrency: bingApiCountryConcurrency,
    countryRequestDelayMs: bingApiCountryRequestDelayMs
  });
  const apiPrecheck = evaluateBingApiPrecheck({
    impressions: metrics.impressions,
    minImpressions
  });
  const values = buildKeywordTotalApiUpdates(keywordTable.headers, keywordRow, apiPrecheck);
  const writeResult = await writeKeywordTotalRow({
    sheetUrl,
    rowNumber: keywordRow.rowNumber,
    headers: keywordTable.headers,
    values
  });

  const impressionCell = { row: keywordRow.rowNumber, column: headerIndex(keywordTable.headers, "3M展示") };
  await formatCellBackgrounds({
    sheetUrl,
    sheetId: keywordTotalGid,
    cells: [impressionCell],
    color: { red: 1, green: 1, blue: 1 }
  }).catch(() => ({ skipped: true }));

  const formatResult = await formatCellBackgrounds({
    sheetUrl,
    sheetId: keywordTotalGid,
    cells: apiPrecheck.impressionFailed ? [impressionCell] : []
  }).catch((error) => ({ ok: false, reason: error.message || String(error) }));

  return {
    row: keywordRow.rowNumber,
    keyword,
    judgement: apiPrecheck.judgement,
    impressions: formatInteger(apiPrecheck.impressionsNumber),
    topCountries: [],
    writeResult,
    formatResult
  };
}

async function processKeywordRowCountryOnly({
  sheetUrl,
  keywordTable,
  keywordRow,
  bingApiKey,
  bingApiCountryCodes,
  bingApiCountryConcurrency,
  bingApiCountryRequestDelayMs
}) {
  const keyword = String(keywordRow.record["关键词"] || "").trim();
  const countryTopRows = await getKeywordCountryRows({
    apiKey: bingApiKey,
    keyword,
    countryCodes: bingApiCountryCodes,
    countryConcurrency: bingApiCountryConcurrency,
    countryRequestDelayMs: bingApiCountryRequestDelayMs
  });
  const values = buildKeywordTotalCountryUpdates(keywordTable.headers, keywordRow, countryTopRows);
  const writeResult = await writeKeywordTotalRow({
    sheetUrl,
    rowNumber: keywordRow.rowNumber,
    headers: keywordTable.headers,
    values
  });
  return {
    row: keywordRow.rowNumber,
    keyword,
    judgement: keywordRow.record["bing初步判断"] || "",
    impressions: keywordRow.record["3M展示"] || "",
    topCountries: countryTopRows.slice(0, 10),
    writeResult
  };
}

async function fetchTopUrlsForKeyword(cdp, page, { keyword, siteUrl }) {
  await searchBingKeyword(cdp, page.sessionId, keyword, siteUrl);
  const topUrls = await extractTopUrlsFromCurrentPageDom(cdp, page.sessionId);
  if (topUrls.length > 0) {
    return topUrls;
  }
  throw new Error(`BING_TOP_URLS_EMPTY: ${keyword}`);
}

async function extractTopUrlsFromCurrentPageDom(cdp, sessionId) {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const result = await evaluate(
      cdp,
      sessionId,
      `(() => {
        const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim();
        const usableUrl = (url) => {
          try {
            const parsed = new URL(url);
            return /^https?:$/i.test(parsed.protocol) &&
              !/\\b(bing|microsoft)\\.com$/i.test(parsed.hostname) &&
              !/\\/search\\?/i.test(parsed.pathname + parsed.search);
          } catch {
            return false;
          }
        };
        const linkValue = (link) => clean(link.textContent) || link.href;
        const grids = [...document.querySelectorAll('[role="grid"]')];
        const topUrlGrid = grids.find((grid) =>
          /Top 10 url ranking on this keyword/i.test(grid.getAttribute("aria-label") || grid.innerText || "")
        );
        const heading = [...document.querySelectorAll("h1,h2,h3,div,span")]
          .find((el) => clean(el.textContent) === "Top 10 url ranking on this keyword");
        const headingTop = heading?.getBoundingClientRect?.().top ?? 0;
        const root = topUrlGrid ||
          (heading
            ? [...document.querySelectorAll(".cardStyle, [class*=card], section, [role=grid], div")]
              .find((candidate) => {
                const rect = candidate.getBoundingClientRect();
                return rect.top >= headingTop - 8 &&
                  candidate.querySelectorAll("a").length > 0 &&
                  /https?:\\/\\//i.test(candidate.innerText || candidate.textContent || "");
              })
            : null);
        let urls = root
          ? [...root.querySelectorAll('[role="row"], a.secondaryInfo, a[href]')]
            .flatMap((item) => {
              if (item.matches?.("a.secondaryInfo")) return [linkValue(item)];
              const link = item.querySelector?.("a.secondaryInfo") ||
                [...(item.querySelectorAll?.("a[href]") || [])].find((candidate) => usableUrl(linkValue(candidate)));
              return link ? [linkValue(link)] : [];
            })
            .filter(usableUrl)
          : [];
        if (urls.length === 0 && heading) {
          urls = [...document.querySelectorAll("a.secondaryInfo, a[href]")]
            .filter((link) => {
              const rect = link.getBoundingClientRect();
              return rect.top >= headingTop - 8 && usableUrl(linkValue(link));
            })
            .map(linkValue);
        }
        if (urls.length > 0) {
          return { found: true, urls: [...new Set(urls)].slice(0, 5) };
        }
        if (heading || topUrlGrid) {
          window.scrollBy({ top: Math.floor(window.innerHeight * 0.45), left: 0, behavior: "instant" });
          return { found: true, urls: [] };
        }
        window.scrollBy({ top: Math.floor(window.innerHeight * 0.8), left: 0, behavior: "instant" });
        return { found: false, urls: [] };
      })()`,
      15000
    ).catch(() => ({ found: false, urls: [] }));
    if (result.urls?.length) {
      return result.urls;
    }
    await sleep(650);
  }
  return [];
}

async function processKeywordRowChromeOnly({
  cdp,
  page,
  sheetUrl,
  siteUrl,
  keywordTotalGid,
  keywordTable,
  keywordRow,
  rule
}) {
  const keyword = String(keywordRow.record["关键词"] || "").trim();
  const maxTop5Domains = rule.record["Max root on Bing top 5url"] || "";
  const topUrls = await fetchTopUrlsForKeyword(cdp, page, { keyword, siteUrl });
  const competition = summarizeTopUrlCompetition(topUrls, 5);
  const chromePrecheck = evaluateBingPrecheck({
    impressions: "",
    minImpressions: "",
    top5DomainCount: competition.count,
    maxTop5Domains
  });
  const values = buildKeywordTotalChromeUpdates(keywordTable.headers, keywordRow, chromePrecheck, competition);
  const writeResult = await writeKeywordTotalRow({
    sheetUrl,
    rowNumber: keywordRow.rowNumber,
    headers: keywordTable.headers,
    values
  });

  const top5Cell = { row: keywordRow.rowNumber, column: headerIndex(keywordTable.headers, "top5根域名数量") };
  await formatCellBackgrounds({
    sheetUrl,
    sheetId: keywordTotalGid,
    cells: [top5Cell],
    color: { red: 1, green: 1, blue: 1 }
  }).catch(() => ({ skipped: true }));

  const formatResult = await formatCellBackgrounds({
    sheetUrl,
    sheetId: keywordTotalGid,
    cells: chromePrecheck.top5DomainFailed ? [top5Cell] : []
  }).catch((error) => ({ ok: false, reason: error.message || String(error) }));
  const pendingFormatResult = await formatCellBackgrounds({
    sheetUrl,
    sheetId: keywordTotalGid,
    cells: chromePrecheck.top5DomainPending ? [top5Cell] : [],
    color: { red: 1, green: 0.9, blue: 0 }
  }).catch((error) => ({ ok: false, reason: error.message || String(error) }));

  return {
    row: keywordRow.rowNumber,
    keyword,
    judgement: chromePrecheck.judgement,
    impressions: keywordRow.record["3M展示"] || "",
    top5DomainCount: competition.count,
    domains: competition.domains.slice(0, 2),
    writeResult,
    formatResult,
    pendingFormatResult
  };
}

async function main() {
  const sheetUrl = readArg("sheet", process.env.GOOGLE_SHEET_URL || DEFAULT_SHEET_URL);
  const siteUrl = readArg("site-url", DEFAULT_SITE_URL);
  const rowArg = readArg("row", "");
  const fromRowArg = readArg("from-row", "");
  const toRowArg = readArg("to-row", "");
  const force = readFlag("force");
  const onlyTop5Zero = readFlag("only-top5-zero");
  const onlyMissingCountry = readFlag("only-missing-country");
  const stopOnError = readFlag("stop-on-error");
  const outDir = readArg("out-dir", "output/bing-precheck");
  const keywordTotalGid = readArg("keyword-total-gid", "999267438");
  const requestedBingAccount = readArg("bing-account", "");
  const minDelayMs = Number(readArg("min-delay-ms", "3500")) || 3500;
  const maxDelayMs = Number(readArg("max-delay-ms", "7500")) || 7500;
  const rowRetries = Number(readArg("row-retries", "3")) || 3;
  const cleanBingTabs = readFlag("clean-bing-tabs");
  const apiOnlyRequested = readFlag("api-only");
  const chromeOnly = readFlag("chrome-only");
  const legacyCountryOnly = readFlag("country-only");
  const agentACountryOnly = readFlag("agent-a-country-only");
  const countryOnly = agentACountryOnly;
  const apiOnly = apiOnlyRequested || countryOnly;
  const useBingApiMetrics = shouldUseBingApiMetrics(readArg("bing-api-metrics", "1"));
  const bingApiSource = readArg("bing-api-source", "auto");
  const bingApiStartFingerprint = readArg("bing-api-start-fingerprint", "25");
  const bingApiStartFeishuRow = Number(readArg("bing-api-start-feishu-row", "0")) || 0;
  const bingApiCountryCodes = parseCountryCodes(readArg("bing-api-countries", ""));
  const bingApiCountryConcurrency = Number(readArg("bing-api-country-concurrency", "8")) || 8;
  const bingApiCountryRequestDelayMs = Number(readArg("bing-api-country-request-delay-ms", "0")) || 0;

  const fromRow = Number(rowArg || fromRowArg || "0") || 0;
  const toRow = Number(rowArg || toRowArg || "0") || 0;

  if (countryOnly && chromeOnly) {
    throw new Error("--agent-a-country-only/--country-only 不能和 --chrome-only 同时使用");
  }
  if (apiOnly && chromeOnly) {
    throw new Error("--api-only 和 --chrome-only 不能同时使用");
  }
  if (legacyCountryOnly) {
    throw new Error("--country-only 已删除。国家流量只允许使用 --agent-a-country-only，并且只处理 评级=A 的行。");
  }
  if (readFlag("include-country-breakdown") || readFlag("skip-country-breakdown")) {
    throw new Error("--include-country-breakdown/--skip-country-breakdown 已删除。国家流量只允许在 --agent-a-country-only 模式抓取。");
  }

  let cdp = apiOnly ? null : await connectChromeCdpWithRecovery();
  let page;
  try {
    const [accountTable, taskTable, keywordTable] = await Promise.all([
      readRequiredSheet(sheetUrl, `${ACCOUNT_SHEET}!A:Z`),
      readRequiredSheet(sheetUrl, `${TASK_SHEET}!A:Z`),
      readRequiredSheet(sheetUrl, `${KEYWORD_TOTAL_SHEET}!A:AZ`)
    ]);
    console.log(`Keyword total headers: ${keywordTable.headers.join(" | ")}`);
    const accounts = apiOnly
      ? []
      : filterBingAccounts(readBingAccounts(accountTable), requestedBingAccount);
    const ruleIndex = buildRuleIndex(taskTable);
    const keywordRows = selectKeywordRows(keywordTable, {
      fromRow,
      toRow,
      force,
      onlyTop5Zero,
      onlyMissingCountry,
      chromeOnly,
      countryOnly
    });
    const bingApiKeys = useBingApiMetrics
      ? await readBingMetricApiKeys({
        source: bingApiSource,
        startFingerprintName: bingApiStartFingerprint,
        startFeishuRow: bingApiStartFeishuRow
      }).catch((error) => {
        console.warn(`Bing Webmaster API key unavailable, fallback to browser metrics: ${error.message || String(error)}`);
        return [];
      })
      : [];
    let bingApiKeyIndex = 0;
    const currentBingApiKey = () => bingApiKeys[bingApiKeyIndex] || "";
    const switchBingApiKey = () => {
      if (bingApiKeys.length === 0) {
        return "";
      }
      bingApiKeyIndex = (bingApiKeyIndex + 1) % bingApiKeys.length;
      return currentBingApiKey();
    };

    console.log(`Selected ${keywordRows.length} keyword row(s).`);
    console.log(`Bing metric source: ${bingApiKeys.length ? `official API (${bingApiSource}, ${bingApiKeys.length} key(s))` : "browser page"}`);
    console.log(`Mode: ${countryOnly ? "agent-a-country-only" : chromeOnly ? "chrome-only" : apiOnly ? "api-only" : "api+chrome"}`);
    console.log(`Country breakdown: ${countryOnly ? "agent A only" : "disabled"}`);

    if (apiOnly && bingApiKeys.length === 0) {
      throw new Error("api-only 模式需要飞书 api 注册中的 bing webmaster api、secrets/bing-webmaster-api-key.txt 或 BING_WEBMASTER_API_KEY");
    }

    let accountIndex = 0;
    const reconnectBingPage = async () => {
      if (page?.sessionId) {
        await detachChromePage(cdp, page.sessionId).catch(() => {});
      }
      cdp.close();
      cdp = await connectChromeCdpWithRecovery();
      page = null;
      return switchBingAccount({ reuseExisting: true });
    };

    const switchBingAccount = async ({ reuseExisting = false } = {}) => {
      if (page?.sessionId) {
        await detachChromePage(cdp, page.sessionId).catch(() => {});
      }
      const account = accounts[accountIndex];
      const profile = findChromeProfile(account);
      console.log(`Bing profile: ${account} (${profile.directory})`);
      page = await openOrAttachBingPage(cdp, profile, siteUrl, {
        reuseExisting,
        cleanDuplicates: cleanBingTabs
      });
      await navigateToBingKeywordResearch(cdp, page.sessionId, siteUrl);
      return { account, profile };
    };

    if (!apiOnly) {
      let reuseExistingBingTab = true;
      for (;;) {
        try {
          await switchBingAccount({ reuseExisting: reuseExistingBingTab });
          break;
        } catch (error) {
          if (!isBingAccountSwitchableError(error) || accountIndex >= accounts.length - 1) {
            throw error;
          }
          const previousAccount = accounts[accountIndex];
          accountIndex += 1;
          reuseExistingBingTab = false;
          console.warn(`Bing account unavailable on ${previousAccount}; switch to ${accounts[accountIndex]}.`);
        }
      }
    }

    const summaries = [];
    for (const keywordRow of keywordRows) {
      try {
        const rule = findRuleForKeywordRow(keywordRow, ruleIndex);
        let summary;
        if (chromeOnly) {
          for (let attempt = 0; attempt < accounts.length; attempt += 1) {
            try {
              for (let rowTry = 1; rowTry <= rowRetries; rowTry += 1) {
                try {
                  summary = await processKeywordRowChromeOnly({
                    cdp,
                    page,
                    sheetUrl,
                    siteUrl,
                    keywordTotalGid,
                    keywordTable,
                    keywordRow,
                    rule
                  });
                  break;
                } catch (error) {
                  if (!isTransientBingAutomationError(error) || rowTry >= rowRetries) {
                    throw error;
                  }
                  console.warn(`Row ${keywordRow.rowNumber} transient chrome error; retry ${rowTry + 1}/${rowRetries}: ${error.message || String(error)}`);
                  await sleep(randomInt(2500, 5000));
                  await reconnectBingPage();
                }
              }
              break;
            } catch (error) {
              if (!isBingAccountSwitchableError(error) || accountIndex >= accounts.length - 1) {
                throw error;
              }
              const previousAccount = accounts[accountIndex];
              accountIndex += 1;
              console.warn(`Bing account switch needed on ${previousAccount}; switch to ${accounts[accountIndex]}.`);
              await switchBingAccount({ reuseExisting: false });
            }
          }
        } else if (apiOnly && countryOnly) {
          const maxKeyAttempts = Math.max(1, bingApiKeys.length);
          let keyAttempts = 0;
          for (let rowTry = 1; rowTry <= rowRetries; rowTry += 1) {
            try {
              summary = await processKeywordRowCountryOnly({
                sheetUrl,
                keywordTable,
                keywordRow,
                bingApiKey: currentBingApiKey(),
                bingApiCountryCodes,
                bingApiCountryConcurrency,
                bingApiCountryRequestDelayMs
              });
              break;
            } catch (error) {
              if (isBingThrottleError(error) && bingApiKeys.length > 1) {
                if (keyAttempts >= maxKeyAttempts) {
                  throw createAllBingApiKeysThrottledError(keywordRow.rowNumber);
                }
                const previousIndex = bingApiKeyIndex;
                switchBingApiKey();
                keyAttempts += 1;
                console.warn(
                  `Row ${keywordRow.rowNumber} API key ${previousIndex + 1}/${bingApiKeys.length} throttled; switch to key ${bingApiKeyIndex + 1}/${bingApiKeys.length}`
                );
                rowTry -= 1;
                continue;
              }
              if (rowTry >= rowRetries) {
                throw error;
              }
              console.warn(`Row ${keywordRow.rowNumber} API error; retry ${rowTry + 1}/${rowRetries}: ${error.message || String(error)}`);
              await sleep(1000 * rowTry);
            }
          }
        } else if (apiOnly) {
          const maxKeyAttempts = Math.max(1, bingApiKeys.length);
          let keyAttempts = 0;
          for (let rowTry = 1; rowTry <= rowRetries; rowTry += 1) {
            try {
              summary = await processKeywordRowApiOnly({
                sheetUrl,
                keywordTotalGid,
                keywordTable,
                keywordRow,
                rule,
                bingApiKey: currentBingApiKey(),
                bingApiCountryConcurrency,
                bingApiCountryRequestDelayMs
              });
              break;
            } catch (error) {
              if (isBingThrottleError(error) && bingApiKeys.length > 1) {
                if (keyAttempts >= maxKeyAttempts) {
                  throw createAllBingApiKeysThrottledError(keywordRow.rowNumber);
                }
                const previousIndex = bingApiKeyIndex;
                switchBingApiKey();
                keyAttempts += 1;
                console.warn(
                  `Row ${keywordRow.rowNumber} API key ${previousIndex + 1}/${bingApiKeys.length} throttled; switch to key ${bingApiKeyIndex + 1}/${bingApiKeys.length}`
                );
                rowTry -= 1;
                continue;
              }
              if (rowTry >= rowRetries) {
                throw error;
              }
              console.warn(`Row ${keywordRow.rowNumber} API error; retry ${rowTry + 1}/${rowRetries}: ${error.message || String(error)}`);
              await sleep(1000 * rowTry);
            }
          }
        } else {
          for (let attempt = 0; attempt < accounts.length; attempt += 1) {
            try {
              for (let rowTry = 1; rowTry <= rowRetries; rowTry += 1) {
                try {
                  summary = await processKeywordRow({
                    cdp,
                    page,
                    sheetUrl,
                    siteUrl,
                    keywordTotalGid,
                    keywordTable,
                    keywordRow,
                    rule,
                    bingApiKey: currentBingApiKey(),
                    useBingApiMetrics,
                    bingApiCountryConcurrency,
                    bingApiCountryRequestDelayMs
                  });
                  break;
                } catch (error) {
                  if (!isTransientBingAutomationError(error) || rowTry >= rowRetries) {
                    throw error;
                  }
                  console.warn(`Row ${keywordRow.rowNumber} transient automation error; retry ${rowTry + 1}/${rowRetries}: ${error.message || String(error)}`);
                  await sleep(randomInt(2500, 5000));
                  await reconnectBingPage();
                }
              }
              break;
            } catch (error) {
              if (!isBingAccountSwitchableError(error) || accountIndex >= accounts.length - 1) {
                throw error;
              }
              const previousAccount = accounts[accountIndex];
              accountIndex += 1;
              console.warn(`Bing account switch needed on ${previousAccount}; switch to ${accounts[accountIndex]}.`);
              await switchBingAccount({ reuseExisting: false });
            }
          }
        }
        summaries.push(summary);
        console.log(`Row ${summary.row}: ${summary.keyword} -> ${summary.judgement}, 3M=${summary.impressions}${apiOnly ? "" : `, top5=${summary.top5DomainCount}`}`);
        await sleep(randomInt(Math.min(minDelayMs, maxDelayMs), Math.max(minDelayMs, maxDelayMs)));
      } catch (error) {
        summaries.push({
          row: keywordRow.rowNumber,
          keyword: keywordRow.record["关键词"] || "",
          failed: true,
          error: error.message || String(error)
        });
        console.error(`Row ${keywordRow.rowNumber} failed: ${error.message || String(error)}`);
        if (!apiOnly && isBingAccountSwitchableError(error) && accountIndex >= accounts.length - 1) {
          throw new Error(`所有 Bing Webmaster 账号都不可用或额度已耗尽，停止运行。最后错误: ${error.message || String(error)}`);
        }
        if (isAllBingApiKeysThrottledError(error)) {
          throw error;
        }
        if (stopOnError) {
          throw error;
        }
      }
    }

    await fs.mkdir(outDir, { recursive: true });
    await writeJson(`${outDir}/last-run-summary.json`, {
      sheetUrl,
      siteUrl,
      mode: countryOnly ? "agent-a-country-only" : chromeOnly ? "chrome-only" : apiOnly ? "api-only" : "api+chrome",
      countryBreakdown: countryOnly ? "agent-a-only" : "disabled",
      accounts,
      lastAccount: accounts[accountIndex],
      rows: keywordRows.map((row) => row.rowNumber),
      summaries
    });
    console.log(`Run summary: ${summaries.length} row(s) handled.`);
  } finally {
    if (page?.sessionId && cdp) {
      await detachChromePage(cdp, page.sessionId).catch(() => {});
    }
    cdp?.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
