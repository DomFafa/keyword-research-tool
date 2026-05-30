import fs from "node:fs/promises";
import { parseCompactNumber } from "./bing-precheck.mjs";

const KEYWORD_STATS_ENDPOINT = "https://ssl.bing.com/webmaster/api.svc/json/GetKeywordStats";
const RELATED_KEYWORDS_ENDPOINT = "https://ssl.bing.com/webmaster/api.svc/json/GetRelatedKeywords";
const DEFAULT_KEY_FILE = "secrets/bing-webmaster-api-key.txt";
const DEFAULT_COUNTRIES = [
  "us", "in", "gb", "ca", "au", "de", "fr", "es", "tw", "cn",
  "tr", "br", "mx", "ph", "pk", "bd", "id", "ng", "za", "it",
  "nl", "se", "no", "dk", "pl", "jp", "kr", "vn", "th", "my", "sg"
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function readBingWebmasterApiKey(filePath = DEFAULT_KEY_FILE) {
  const keys = await readBingWebmasterApiKeys(filePath);
  return keys[0] || "";
}

export async function readBingWebmasterApiKeys(filePath = DEFAULT_KEY_FILE) {
  const envKey = process.env.BING_WEBMASTER_API_KEY?.trim();
  if (envKey) {
    return envKey.split(/[\r\n,]+/).map((key) => key.trim()).filter(Boolean);
  }
  return (await fs.readFile(filePath, "utf8"))
    .split(/\r?\n/)
    .map((key) => key.trim())
    .filter(Boolean);
}

function parseApiDate(value) {
  const match = String(value || "").match(/\/Date\((\d+)\)\//);
  return match ? Number(match[1]) : 0;
}

function countryNameFromCode(code) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) {
    return "";
  }
  if (normalized === "UK") {
    return "United Kingdom";
  }
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(normalized) || normalized;
  } catch {
    return normalized;
  }
}

function latestWeeks(rows, weeks = 13) {
  return [...rows]
    .sort((a, b) => parseApiDate(a.Date) - parseApiDate(b.Date))
    .slice(-weeks);
}

export function summarizeKeywordStats(rows, weeks = 13) {
  const selected = latestWeeks(rows || [], weeks);
  return {
    weeks: selected.length,
    impressions: selected.reduce((sum, row) => sum + (Number(row.Impressions) || 0), 0),
    broadImpressions: selected.reduce((sum, row) => sum + (Number(row.BroadImpressions) || 0), 0),
    latestDate: selected.at(-1)?.Date || ""
  };
}

export async function getKeywordStats({ apiKey, keyword, country = "", language = "" }) {
  const url = new URL(KEYWORD_STATS_ENDPOINT);
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("q", keyword);
  if (country) {
    url.searchParams.set("country", country);
  }
  if (language) {
    url.searchParams.set("language", language);
  }
  const response = await fetch(url);
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Bing Webmaster API returned non-json: ${text.slice(0, 200)}`);
  }
  if (!response.ok || data?.ErrorCode || data?.Message) {
    throw createBingApiError(data, response.status);
  }
  return data.d || [];
}

function createBingApiError(data, status) {
  const code = data?.ErrorCode || "";
  const message = data?.Message || code || String(status);
  const error = new Error(`Bing Webmaster API error: ${message}`);
  error.name = "BingWebmasterApiError";
  error.bingCode = code;
  error.bingMessage = message;
  error.status = status;
  return error;
}

export function isBingThrottleError(error) {
  return /ThrottleUser|throttle|too many requests|rate/i.test(
    `${error?.bingCode || ""} ${error?.bingMessage || ""} ${error?.message || String(error)}`
  );
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function getRelatedKeywords({
  apiKey,
  keyword,
  country = "",
  language = "",
  startDate = "",
  endDate = ""
}) {
  const url = new URL(RELATED_KEYWORDS_ENDPOINT);
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("q", keyword);
  if (country) {
    url.searchParams.set("country", country);
  }
  if (language) {
    url.searchParams.set("language", language);
  }
  if (startDate) {
    url.searchParams.set("startDate", startDate);
  }
  if (endDate) {
    url.searchParams.set("endDate", endDate);
  }
  const response = await fetch(url);
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Bing Webmaster API returned non-json: ${text.slice(0, 200)}`);
  }
  if (!response.ok || data?.ErrorCode || data?.Message) {
    throw createBingApiError(data, response.status);
  }
  return data.d || [];
}

export async function getKeywordResearchMetrics({
  apiKey,
  keyword,
  countryCodes = DEFAULT_COUNTRIES,
  weeks = 13,
  countryConcurrency = 8,
  countryRequestDelayMs = 0
}) {
  const globalRows = await getKeywordStats({ apiKey, keyword });
  const global = summarizeKeywordStats(globalRows, weeks);
  const countryResults = await mapLimit(countryCodes, countryConcurrency, async (countryCode) => {
    if (countryRequestDelayMs > 0) {
      await sleep(countryRequestDelayMs);
    }
    const rows = await getKeywordStats({ apiKey, keyword, country: countryCode }).catch((error) => {
      if (isBingThrottleError(error)) {
        throw error;
      }
      return [];
    });
    const summary = summarizeKeywordStats(rows, weeks);
    if (summary.impressions > 0) {
      return {
        country: countryNameFromCode(countryCode),
        countryCode,
        impressions: String(summary.impressions),
        impressionsNumber: summary.impressions
      };
    }
    return null;
  });
  const countries = countryResults.filter(Boolean);
  countries.sort((a, b) => b.impressionsNumber - a.impressionsNumber);
  return {
    impressions: global.impressions,
    impressionsText: String(global.impressions),
    broadImpressions: global.broadImpressions,
    countryRows: countries,
    weeks: global.weeks,
    latestDate: global.latestDate
  };
}

export async function getKeywordCountryRows({
  apiKey,
  keyword,
  countryCodes = DEFAULT_COUNTRIES,
  weeks = 13,
  countryConcurrency = 8,
  countryRequestDelayMs = 0
}) {
  const countryResults = await mapLimit(countryCodes, countryConcurrency, async (countryCode) => {
    if (countryRequestDelayMs > 0) {
      await sleep(countryRequestDelayMs);
    }
    const rows = await getKeywordStats({ apiKey, keyword, country: countryCode }).catch((error) => {
      if (isBingThrottleError(error)) {
        throw error;
      }
      return [];
    });
    const summary = summarizeKeywordStats(rows, weeks);
    if (summary.impressions > 0) {
      return {
        country: countryNameFromCode(countryCode),
        countryCode,
        impressions: String(summary.impressions),
        impressionsNumber: summary.impressions
      };
    }
    return null;
  });
  return countryResults
    .filter(Boolean)
    .sort((a, b) => b.impressionsNumber - a.impressionsNumber);
}

export function shouldUseBingApiMetrics(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return !["0", "false", "no", "否", "off"].includes(normalized);
}

export function parseCountryCodes(value) {
  const parsed = String(value || "")
    .split(/[,\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return parsed.length ? parsed : DEFAULT_COUNTRIES;
}
