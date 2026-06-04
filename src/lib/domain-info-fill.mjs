import { keywordRowsForTask } from "./task-status-summary.mjs";

export const DOMAIN_INFO_NOT_FOUND = "未找到可用域名";

export const DOMAIN_INFO_HEADERS = [
  "关键词",
  "目标域名",
  "公司名称",
  "地址",
  "邮编",
  "城市",
  "州",
  "电话"
];

function trim(value) {
  return String(value || "").trim();
}

function lower(value) {
  return trim(value).toLowerCase();
}

export function isValidDomainRecommendation(value) {
  const domain = lower(value);
  return Boolean(domain) &&
    domain !== DOMAIN_INFO_NOT_FOUND &&
    /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/i.test(domain);
}

export function companyNameFromDomain(domain) {
  const parts = lower(domain).split(".").filter(Boolean);
  if (parts.length <= 1) {
    return parts[0] || "";
  }
  return parts.slice(0, -1).join(".");
}

export function normalizeTurkishPhone(value) {
  const text = trim(value);
  if (!text) {
    return "";
  }
  const digits = text.replace(/\D/g, "");
  return digits || "";
}

export function parseTurkishAddress(value, fallbackCity = "") {
  const text = trim(value).replace(/\s+/g, " ");
  const match = text.match(/^(.*?),\s*(\d{5})\s+([^/,]+)\/([^,]+),\s*Turkey$/i);
  if (match) {
    return {
      address: trim(match[1]),
      postalCode: trim(match[2]),
      city: trim(match[3]),
      state: trim(match[4])
    };
  }

  const postalMatch = text.match(/^(.*?),\s*(\d{5})\s+([^,]+),\s*Turkey$/i);
  if (postalMatch) {
    return {
      address: trim(postalMatch[1]),
      postalCode: trim(postalMatch[2]),
      city: trim(fallbackCity || postalMatch[3]),
      state: trim(postalMatch[3])
    };
  }

  return {
    address: text.replace(/,\s*Turkey$/i, ""),
    postalCode: "",
    city: trim(fallbackCity),
    state: ""
  };
}

export function normalizeAddressInfo(raw = {}) {
  const parsed = parseTurkishAddress(raw.street || raw.address || "", raw.city);
  return {
    address: parsed.address,
    postalCode: parsed.postalCode || trim(raw.postalCode),
    city: parsed.city || trim(raw.district || raw.city),
    state: parsed.state || trim(raw.city),
    phone: normalizeTurkishPhone(raw.phone)
  };
}

export function hasCompleteAddressInfo(info = {}) {
  return Boolean(
    trim(info.address) &&
    /^\d{5}$/.test(trim(info.postalCode)) &&
    trim(info.city) &&
    trim(info.state) &&
    /^\d+$/.test(trim(info.phone))
  );
}

export function domainInfoKey({ keyword, targetDomain }) {
  return `${lower(keyword)}\u0000${lower(targetDomain)}`;
}

export function buildExistingDomainInfoIndex(domainInfoRows = []) {
  const index = new Map();
  for (const row of domainInfoRows) {
    const keyword = row.record?.["关键词"];
    const targetDomain = row.record?.["目标域名"];
    if (!trim(keyword) || !trim(targetDomain)) {
      continue;
    }
    index.set(domainInfoKey({ keyword, targetDomain }), row);
  }
  return index;
}

export function hasCompleteDomainInfo(record = {}) {
  return DOMAIN_INFO_HEADERS.every((header) => trim(record[header]));
}

export function selectDomainInfoFillRows(keywordRows = [], domainInfoRows = [], {
  force = false,
  limit = 20,
  fromRow = 0,
  toRow = 0
} = {}) {
  const selected = [];
  const skipped = [];
  const existing = buildExistingDomainInfoIndex(domainInfoRows);

  for (const row of keywordRows) {
    if (fromRow && row.rowNumber < fromRow) {
      continue;
    }
    if (toRow && row.rowNumber > toRow) {
      continue;
    }

    const keyword = trim(row.record?.["关键词"]);
    const rating = trim(row.record?.["评级"]);
    const targetDomain = lower(row.record?.["域名推荐"]);
    if (rating !== "A") {
      skipped.push({ rowNumber: row.rowNumber, keyword, reason: "rating_not_a" });
      continue;
    }
    if (!isValidDomainRecommendation(targetDomain)) {
      skipped.push({ rowNumber: row.rowNumber, keyword, reason: "invalid_domain_recommendation" });
      continue;
    }

    const existingRow = existing.get(domainInfoKey({ keyword, targetDomain }));
    if (existingRow && hasCompleteDomainInfo(existingRow.record) && !force) {
      skipped.push({ rowNumber: row.rowNumber, keyword, reason: "domain_info_complete" });
      continue;
    }

    selected.push({
      keywordRow: row,
      existingRow,
      keyword,
      targetDomain,
      companyName: companyNameFromDomain(targetDomain)
    });
    if (limit && selected.length >= limit) {
      break;
    }
  }

  return { selected, skipped };
}

export function findAppendStartRow(rows = []) {
  const populatedRows = rows.filter((row) =>
    Object.values(row.record || {}).some((value) => trim(value))
  );
  if (populatedRows.length === 0) {
    return 2;
  }
  return Math.max(...populatedRows.map((row) => row.rowNumber)) + 1;
}

export function buildDomainInfoValues(headers, existingValues = [], values = {}) {
  const rowValues = [...existingValues];
  headers.forEach((header, index) => {
    if (Object.prototype.hasOwnProperty.call(values, header)) {
      rowValues[index] = values[header] || "";
    } else if (rowValues[index] === undefined) {
      rowValues[index] = "";
    }
  });
  return rowValues.slice(0, headers.length);
}

function keywordDone(domainInfoIndex, row) {
  const keyword = row.record?.["关键词"];
  const targetDomain = row.record?.["域名推荐"];
  if (!isValidDomainRecommendation(targetDomain)) {
    return false;
  }
  const domainInfoRow = domainInfoIndex.get(domainInfoKey({ keyword, targetDomain }));
  return Boolean(domainInfoRow && hasCompleteDomainInfo(domainInfoRow.record));
}

export function summarizeDomainInfoStatus(taskRow, keywordRows, domainInfoRows) {
  const rows = keywordRowsForTask(taskRow, keywordRows)
    .filter((row) => trim(row.record?.["评级"]) === "A");
  if (rows.length === 0) {
    return trim(taskRow.record?.["域名信息补全"]);
  }
  const domainInfoIndex = buildExistingDomainInfoIndex(domainInfoRows);
  const done = rows.filter((row) => keywordDone(domainInfoIndex, row)).length;
  return `已完成${done}个，总数${rows.length}个`;
}

export function buildDomainInfoStatusUpdates(taskTable, keywordTable, domainInfoTable, {
  touchedKeywordRows = null,
  includeExistingStatus = true
} = {}) {
  return taskTable.rows
    .filter((row) => trim(row.record?.["词根"]) || trim(row.record?.["关键词"]))
    .filter((row) => {
      if (!Array.isArray(touchedKeywordRows)) {
        return true;
      }
      const hasExistingStatus = Boolean(trim(row.record?.["域名信息补全"]));
      const isTouched = keywordRowsForTask(row, touchedKeywordRows).length > 0;
      return isTouched || (includeExistingStatus && hasExistingStatus);
    })
    .map((row) => ({
      rowNumber: row.rowNumber,
      root: trim(row.record?.["词根"]),
      keyword: trim(row.record?.["关键词"]),
      value: summarizeDomainInfoStatus(row, keywordTable.rows, domainInfoTable.rows)
    }));
}
