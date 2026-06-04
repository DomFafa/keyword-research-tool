export const DOMAIN_NOT_FOUND_STATUS = "未找到可用域名";

export const DOMAIN_CANDIDATE_RULES = [
  "keyword.com",
  "keyword.org",
  "keyword.net",
  "keyword1-keyword2-keyword3.com",
  "keyword1-keyword2-keyword3.org",
  "keyword1-keyword2-keyword3.net",
  "keyword.online",
  "keyword.app",
  "keyword.pro",
  "keyword.site"
];

export function keywordWordsForDomain(keyword) {
  return String(keyword || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\.[a-z]{2,}$/i, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function buildDomainCandidates(keyword) {
  const words = keywordWordsForDomain(keyword);
  if (words.length === 0) {
    return [];
  }
  const compact = words.join("");
  const dashed = words.join("-");
  return [
    `${compact}.com`,
    `${compact}.org`,
    `${compact}.net`,
    `${dashed}.com`,
    `${dashed}.org`,
    `${dashed}.net`,
    `${compact}.online`,
    `${compact}.app`,
    `${compact}.pro`,
    `${compact}.site`
  ].filter((value, index, values) => values.indexOf(value) === index);
}

export function isAWithoutDomainRecommendation(record = {}) {
  return String(record["评级"] || "").trim() === "A" &&
    !String(record["域名推荐"] || "").trim();
}

export function selectDomainResearchRows(rows, {
  fromRow = 0,
  toRow = 0,
  limit = 20,
  force = false
} = {}) {
  const selected = [];
  const skipped = [];
  for (const row of rows) {
    if (fromRow && row.rowNumber < fromRow) {
      continue;
    }
    if (toRow && row.rowNumber > toRow) {
      continue;
    }

    const keyword = String(row.record?.["关键词"] || "").trim();
    const rating = String(row.record?.["评级"] || "").trim();
    const existingDomain = String(row.record?.["域名推荐"] || "").trim();
    if (rating !== "A") {
      skipped.push({ rowNumber: row.rowNumber, keyword, reason: "rating_not_a" });
      continue;
    }
    if (existingDomain && !force) {
      skipped.push({ rowNumber: row.rowNumber, keyword, reason: "domain_recommendation_exists" });
      continue;
    }
    selected.push(row);
    if (limit && selected.length >= limit) {
      break;
    }
  }
  return { selected, skipped };
}

export function parseAvailablePrice(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  const availableMatches = [...normalized.matchAll(/\bavailable\b/gi)];
  if (availableMatches.length === 0) {
    return "";
  }
  const availableIndex = availableMatches[availableMatches.length - 1].index;
  const after = normalized.slice(availableIndex + "available".length).trim();
  return after.match(/^[^\s]+(?:\s+[A-Z]{3})?\/year/i)?.[0] ||
    after.match(/^[₺$€£¥]?\s?[\d,.]+(?:\s+[A-Z]{3})?\s*\/year/i)?.[0] ||
    "";
}

export function isWorkspaceNoLongerAvailableMessage(text) {
  return /selected domain name is no longer available/i.test(String(text || ""));
}

export function parseWorkspaceDomainConfirmation(text, expectedDomain = "") {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  const hasAvailable = /\bavailable\b/i.test(normalized);
  if (!hasAvailable) {
    return { available: false, domain: "", price: "", reason: "available_text_not_found" };
  }
  if (expectedDomain && !normalized.toLowerCase().includes(String(expectedDomain).toLowerCase())) {
    return { available: false, domain: "", price: "", reason: "expected_domain_not_found" };
  }
  const domain = expectedDomain ||
    normalized.match(/\b[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z]{2,})+\b/i)?.[0] ||
    "";
  return {
    available: true,
    domain,
    price: parseAvailablePrice(normalized),
    reason: ""
  };
}
