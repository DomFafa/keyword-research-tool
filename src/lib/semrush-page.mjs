import { evaluate, navigateAndWait } from "./cdp.mjs";
import { clickByText, setInputValue, sleep, waitForCondition } from "./browser-actions.mjs";

const COUNTRY_DATABASE_CODES = {
  美国: "us",
  "United States": "us",
  US: "us",
  USA: "us",
  英国: "uk",
  "United Kingdom": "uk",
  UK: "uk",
  GB: "uk",
  澳大利亚: "au",
  Australia: "au",
  AU: "au",
  德国: "de",
  Germany: "de",
  DE: "de",
  法国: "fr",
  France: "fr",
  FR: "fr",
  西班牙: "es",
  Spain: "es",
  ES: "es",
  中国台湾: "tw",
  台湾: "tw",
  Taiwan: "tw",
  TW: "tw",
  加拿大: "ca",
  Canada: "ca",
  CA: "ca",
  印度: "in",
  India: "in",
  IN: "in",
  日本: "jp",
  Japan: "jp",
  JP: "jp",
  巴西: "br",
  Brazil: "br",
  BR: "br",
  意大利: "it",
  Italy: "it",
  IT: "it",
  荷兰: "nl",
  Netherlands: "nl",
  NL: "nl",
  墨西哥: "mx",
  Mexico: "mx",
  MX: "mx"
};

const KEYWORD_MAGIC_MODES = {
  "": 0,
  广泛匹配: 0,
  词组匹配: 1,
  完全匹配: 2,
  相关性: 3,
  所有关键词: 4
};

const KEYWORD_MAGIC_PAGE_SIZE = 100;

export function countryDatabaseCode(country) {
  const value = String(country || "").trim();
  if (!value) {
    return "";
  }
  return COUNTRY_DATABASE_CODES[value] || COUNTRY_DATABASE_CODES[value.toUpperCase()] || value.toLowerCase();
}

export function keywordMagicMode(matchType = "") {
  const key = String(matchType || "").trim();
  if (!(key in KEYWORD_MAGIC_MODES)) {
    throw new Error(`Unsupported 匹配类型: ${key}`);
  }
  return KEYWORD_MAGIC_MODES[key];
}

export async function detectPage(cdp, sessionId) {
  return evaluate(
    cdp,
    sessionId,
    `(() => {
      const url = location.href;
      const has = (selector) => Boolean(document.querySelector(selector));
      const text = document.body?.innerText || "";

      let kind = "unknown";
      if (url.includes("sem.3ue.com") && /Error code 520|Web server is returning an unknown error/i.test(text)) {
        kind = "semrush_error";
      } else if (url.includes("dash.3ue.com") && (url.includes("/login") || has("#input-username"))) {
        kind = "dash_login";
      } else if (url.includes("dash.3ue.com") && (url.includes("/page/m/home") || text.includes("SEMRUSH"))) {
        kind = "dash_home";
      } else if (url.includes("sem.3ue.com/analytics/keywordoverview")) {
        kind = "semrush_keyword_overview";
      } else if (url.includes("sem.3ue.com/analytics/keywordmagic")) {
        kind = "semrush_keyword_magic";
      } else if (url.includes("sem.3ue.com")) {
        kind = "semrush_home";
      }

      return {
        kind,
        url,
        query: new URL(url).searchParams.get("q") || "",
        db: new URL(url).searchParams.get("db") || "",
        title: document.title
      };
    })()`
  );
}

export async function loginDash(cdp, sessionId, username, password) {
  await waitForCondition(cdp, sessionId, "Boolean(document.querySelector('#input-username') && document.querySelector('#input-password'))", 30000);
  await setInputValue(cdp, sessionId, "#input-username", username);
  await setInputValue(cdp, sessionId, "#input-password", password);
  await clickByText(cdp, sessionId, { selector: "button", text: "登录" });
  await sleep(3000);
}

export async function openSemrushFromDash(cdp, sessionId) {
  await waitForCondition(
    cdp,
    sessionId,
    `Boolean([...document.querySelectorAll("button")].find((button) => /打开/.test(button.innerText || button.textContent || "")))`,
    30000
  );
  await selectHealthySemrushNode(cdp, sessionId);
  await clickByText(cdp, sessionId, { selector: "button", text: "打开", includes: true });
  await sleep(5000);
}

async function selectHealthySemrushNode(cdp, sessionId) {
  const result = await evaluate(
    cdp,
    sessionId,
    `(() => {
      const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim();
      const isVisible = (el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const current = [...document.querySelectorAll("button.select-button")]
        .find((button) => /节点/.test(clean(button.innerText || button.textContent)));
      const overlayOpen = Boolean(document.querySelector(".cdk-overlay-pane"));
      const currentText = clean(current?.innerText || current?.textContent);

      if (!overlayOpen) {
        current?.click();
      }
      return { ok: Boolean(current) || overlayOpen, opened: true, currentText };
    })()`
  );
  if (!result.ok) {
    return result;
  }

  await waitForCondition(
    cdp,
    sessionId,
    `Boolean([...document.querySelectorAll(".cdk-overlay-pane .text-size-normal, .cdk-overlay-pane div")]
      .find((item) => {
        const text = String(item.innerText || item.textContent || "").replace(/\\s+/g, " ").trim();
        return /节点/.test(text) && text.includes("✅") && !text.includes("❌");
      }))`,
    10000
  );

  const selected = await evaluate(
    cdp,
    sessionId,
    `(() => {
      const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim();
      const isVisible = (el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const options = [...document.querySelectorAll(".cdk-overlay-pane .text-size-normal, .cdk-overlay-pane div")]
        .filter(isVisible)
        .map((el) => ({ el, text: clean(el.innerText || el.textContent) }))
        .filter((item) => /^节点\\d+\\b/.test(item.text));
      const currentText = ${JSON.stringify(result.currentText || "")};
      const healthy = options.filter((item) => item.text.includes("✅") && !item.text.includes("❌"));
      const option = healthy.find((item) => item.text !== currentText) || healthy[0];
      if (!option) {
        return { ok: false, reason: "no healthy Semrush node option" };
      }
      option.el.click();
      return { ok: true, text: option.text };
    })()`
  );
  await sleep(700);
  return selected;
}

export async function closeSemrushCoachmark(cdp, sessionId) {
  return evaluate(
    cdp,
    sessionId,
    `(() => {
      const clean = (value) => (value || "").replace(/\\s+/g, " ").trim();
      const buttons = [...document.querySelectorAll("button")];
      const button = buttons.find((item) => /关闭|Got it|Skip|稍后|我知道了/.test(clean(item.innerText || item.textContent)));
      if (!button) return { skipped: true };
      button.click();
      return { closed: true, text: clean(button.innerText || button.textContent) };
    })()`
  ).catch(() => ({ skipped: true }));
}

function cleanNumber(value) {
  const text = String(value || "").replace(/,/g, "").trim();
  if (!text) {
    return "";
  }
  const number = Number(text);
  return Number.isFinite(number) ? number : "";
}

function rangeFilter(minValue, maxValue) {
  const filters = [];
  const min = cleanNumber(minValue);
  const max = cleanNumber(maxValue);
  if (min !== "") {
    filters.push({ inverted: false, operation: 5, value: min });
  }
  if (max !== "") {
    filters.push({ inverted: false, operation: 4, value: max });
  }
  return filters;
}

export function buildKeywordMagicRpcParams({
  query,
  country = "",
  matchType = "",
  volumeMin = "",
  volumeMax = "",
  kdMin = "",
  kdMax = "",
  page = 1
}) {
  return {
    phrase: query,
    database: countryDatabaseCode(country) || "us",
    mode: keywordMagicMode(matchType),
    domain: null,
    questions_only: false,
    groups: [],
    filter: {
      phrase: [],
      competition_level: [],
      cpc: [],
      difficulty: rangeFilter(kdMin, kdMax),
      results: [],
      serp_features: [{ inverted: false, value: [] }],
      volume: rangeFilter(volumeMin, volumeMax),
      words_count: [],
      phrase_include_logic: 0
    },
    currency: "USD",
    order: keywordMagicMode(matchType) === 3
      ? { field: "relation_level", direction: 1 }
      : { field: "volume", direction: 1 },
    page: {
      number: page,
      size: KEYWORD_MAGIC_PAGE_SIZE
    }
  };
}

function formatInteger(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return String(value);
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(number));
}

export function parseKeywordMagicRows({ root = "", sourceQuery = "", page = 1, response }) {
  const keywords = Array.isArray(response?.result?.keywords)
    ? response.result.keywords
    : Array.isArray(response?.result)
      ? response.result
      : [];

  return keywords
    .map((item) => ({
      root,
      source_query: sourceQuery,
      keyword: String(item.phrase || "").trim(),
      volume: formatInteger(item.volume),
      kd: item.difficulty === null || item.difficulty === undefined ? "" : String(item.difficulty),
      semrush_page: page
    }))
    .filter((row) => row.keyword && row.volume && row.kd);
}

function rpcUrlExpression(path) {
  return `(() => {
    const url = new URL(${JSON.stringify(path)}, location.origin);
    const gmitm = new URL(location.href).searchParams.get("__gmitm");
    if (gmitm) url.searchParams.set("__gmitm", gmitm);
    return url.pathname + url.search;
  })()`;
}

async function callSemrushRpc(cdp, sessionId, path, method, params) {
  return evaluate(
    cdp,
    sessionId,
    `(async () => {
      const endpoint = ${rpcUrlExpression(path)};
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: 1,
          jsonrpc: "2.0",
          method: ${JSON.stringify(method)},
          params: ${JSON.stringify(params)}
        })
      });
      const json = await response.json();
      return {
        ok: response.ok && !json.error,
        status: response.status,
        error: json.error || null,
        result: json.result,
        endpoint
      };
    })()`,
    90000
  );
}

async function navigateWithinSemrush(cdp, sessionId, pathname, query, country = "") {
  const databaseCode = countryDatabaseCode(country) || "us";
  const targetUrl = await evaluate(
    cdp,
    sessionId,
    `(() => {
      const current = new URL(location.href);
      const next = new URL(${JSON.stringify(pathname)}, current.origin);
      next.searchParams.set("q", ${JSON.stringify(query)});
      next.searchParams.set("db", ${JSON.stringify(databaseCode)});
      const gmitm = current.searchParams.get("__gmitm");
      if (gmitm) next.searchParams.set("__gmitm", gmitm);
      return next.toString();
    })()`
  );
  await navigateAndWait(cdp, sessionId, targetUrl, 45000).catch(async () => {
    await sleep(4000);
  });
}

async function ensureKeywordMagicPage(cdp, sessionId, task) {
  const databaseCode = countryDatabaseCode(task.matchCountry) || "us";
  const isReady = await evaluate(
    cdp,
    sessionId,
    `(() => {
      const url = new URL(location.href);
      return url.hostname.includes("sem.3ue.com") &&
        url.pathname.includes("/analytics/keywordmagic") &&
        url.searchParams.get("q") === ${JSON.stringify(task.query)} &&
        url.searchParams.get("db") === ${JSON.stringify(databaseCode)};
    })()`
  );

  if (!isReady) {
    await navigateWithinSemrush(cdp, sessionId, "/analytics/keywordmagic/", task.query, databaseCode);
  }
  await waitForCondition(cdp, sessionId, "location.href.includes('/analytics/keywordmagic')", 45000);
}

export async function fetchKeywordMagicPage(cdp, sessionId, task, page = 1) {
  await ensureKeywordMagicPage(cdp, sessionId, task);
  const params = buildKeywordMagicRpcParams({
    query: task.query,
    country: task.matchCountry,
    matchType: task.matchType,
    volumeMin: task.volumeMin,
    volumeMax: task.volumeMax,
    kdMin: task.kdMin,
    kdMax: task.kdMax,
    page
  });
  const response = await callSemrushRpc(cdp, sessionId, "/kmtgw/v2/webapi", "ideas.GetKeywords", params);
  if (!response.ok) {
    throw new Error(`Semrush Keyword Magic RPC failed: ${response.error?.message || response.status}`);
  }
  return {
    rows: parseKeywordMagicRows({
      root: task.rootKeyword,
      sourceQuery: task.query,
      page,
      response
    }),
    endpoint: response.endpoint
  };
}

export async function fetchKeywordMagicSummary(cdp, sessionId, task) {
  await ensureKeywordMagicPage(cdp, sessionId, task);
  const params = buildKeywordMagicRpcParams({
    query: task.query,
    country: task.matchCountry,
    matchType: task.matchType,
    volumeMin: task.volumeMin,
    volumeMax: task.volumeMax,
    kdMin: task.kdMin,
    kdMax: task.kdMax,
    page: 1
  });
  delete params.page;
  const response = await callSemrushRpc(cdp, sessionId, "/kmtgw/v2/webapi", "ideas.GetKeywordsSummary", params);
  if (!response.ok) {
    throw new Error(`Semrush Keyword Magic summary RPC failed: ${response.error?.message || response.status}`);
  }
  return {
    total: Number(response.result?.total || 0),
    totalVolume: Number(response.result?.total_volume || 0)
  };
}

export async function fetchKeywordOverviewMetrics(cdp, sessionId, query, country = "") {
  const databaseCode = countryDatabaseCode(country) || "us";
  await navigateWithinSemrush(cdp, sessionId, "/analytics/keywordoverview/", query, databaseCode);
  await waitForCondition(cdp, sessionId, "location.href.includes('/analytics/keywordoverview')", 45000);
  const response = await callSemrushRpc(cdp, sessionId, "/kwogw/v2/webapi", "keywords.GetInfo", {
    device: 0,
    database: databaseCode,
    currency: "USD",
    phrase: query,
    date: ""
  });
  if (!response.ok) {
    throw new Error(`Semrush Keyword Overview RPC failed: ${response.error?.message || response.status}`);
  }

  const keywords = Array.isArray(response.result?.keywords) ? response.result.keywords : [];
  const local = keywords.find((item) => item.database === databaseCode && item.exact_match !== false) ||
    keywords.find((item) => item.database === databaseCode);
  const globalVolume = keywords.reduce((sum, item) => sum + (Number(item.volume) || 0), 0);

  if (!local) {
    throw new Error(`Semrush Keyword Overview RPC returned no ${databaseCode} row for ${query}`);
  }

  return {
    keyword: query,
    localVolume: formatInteger(local.volume),
    globalVolume: formatInteger(globalVolume || local.volume),
    kd: local.difficulty === null || local.difficulty === undefined ? "" : String(local.difficulty),
    url: await evaluate(cdp, sessionId, "location.href")
  };
}
