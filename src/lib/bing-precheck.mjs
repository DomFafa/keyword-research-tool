const LOCALE_SEGMENT = /^(?:[a-z]{2})(?:-[a-z]{2})?$/i;

const COMMON_PREFIXES = new Set(["www", "m"]);

export function parseCompactNumber(value) {
  const text = String(value || "")
    .replace(/,/g, "")
    .replace(/\s+/g, "")
    .trim();
  if (!text) {
    return null;
  }
  const match = text.match(/^(\d+(?:\.\d+)?)([KMB])?$/i);
  if (!match) {
    return null;
  }
  const multiplier = {
    K: 1000,
    M: 1000000,
    B: 1000000000
  }[match[2]?.toUpperCase()] || 1;
  return Math.round(Number(match[1]) * multiplier);
}

export function formatInteger(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  const number = typeof value === "number" ? value : parseCompactNumber(value);
  if (number === null || Number.isNaN(number)) {
    return String(value);
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(number);
}

export function rootHost(hostname) {
  const parts = String(hostname || "")
    .toLowerCase()
    .replace(/\.$/, "")
    .split(".")
    .filter(Boolean);
  while (parts.length > 2 && COMMON_PREFIXES.has(parts[0])) {
    parts.shift();
  }
  return parts.join(".");
}

export function competitionKeyFromUrl(url) {
  try {
    const parsed = new URL(url);
    const host = rootHost(parsed.hostname);
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length === 0) {
      return host;
    }
    const firstSegment = segments[0] || "";
    if (segments.length === 1 && LOCALE_SEGMENT.test(firstSegment)) {
      return `${host}/${firstSegment.toLowerCase()}`;
    }
    return "";
  } catch {
    return "";
  }
}

export function summarizeTopUrlCompetition(urls, limit = 5) {
  const domains = [];
  const seen = new Set();
  urls.slice(0, limit).forEach((url, index) => {
    const key = competitionKeyFromUrl(url);
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    domains.push({
      domain: key,
      rank: index + 1
    });
  });
  return {
    count: domains.length,
    domains
  };
}

export function sortCountryBreakdown(rows) {
  return [...rows]
    .map((row) => ({
      country: String(row.country || "").trim(),
      impressions: String(row.impressions || "").trim(),
      impressionsNumber: Number.isFinite(Number(row.impressionsNumber))
        ? Number(row.impressionsNumber)
        : parseCompactNumber(row.impressions)
    }))
    .filter((row) => row.country && row.impressionsNumber !== null)
    .sort((a, b) => b.impressionsNumber - a.impressionsNumber);
}

export function evaluateBingPrecheck({
  impressions,
  minImpressions,
  top5DomainCount,
  maxTop5Domains
}) {
  const impressionsNumber = parseCompactNumber(impressions);
  const minImpressionsNumber = parseCompactNumber(minImpressions);
  const domainCountNumber = Number(top5DomainCount);
  const maxDomainNumber = Number(maxTop5Domains);

  const impressionFailed =
    minImpressionsNumber !== null &&
    impressionsNumber !== null &&
    impressionsNumber < minImpressionsNumber;
  const top5DomainFailed =
    Number.isFinite(domainCountNumber) &&
    Number.isFinite(maxDomainNumber) &&
    domainCountNumber > maxDomainNumber;
  const top5DomainPending =
    !top5DomainFailed &&
    Number.isFinite(domainCountNumber) &&
    domainCountNumber === 2;

  return {
    judgement: impressionFailed || top5DomainFailed ? "拒绝" : top5DomainPending ? "待定" : "继续",
    impressionFailed,
    top5DomainFailed,
    top5DomainPending,
    impressionsNumber,
    minImpressionsNumber,
    domainCountNumber,
    maxDomainNumber
  };
}
