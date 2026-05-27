export const KEYWORD_TOTAL_HEADERS = ["词根", "关键词", "国家", "搜索量", "KD", "判断"];

function normalizeCell(value) {
  return String(value ?? "").trim();
}

export function keywordTotalColumnIndexes(headers) {
  return KEYWORD_TOTAL_HEADERS.map((header) => headers.indexOf(header));
}

export function findKeywordTotalAppendStartRow(sheet) {
  const headers = sheet?.headers || [];
  const indexes = keywordTotalColumnIndexes(headers);
  const missing = KEYWORD_TOTAL_HEADERS.filter((_, index) => indexes[index] === -1);
  if (missing.length > 0) {
    throw new Error(`关键词总表缺少表头: ${missing.join(", ")}`);
  }

  const rawRows = sheet?.rawRows || [];
  let lastDataRowNumber = 1;
  for (let index = 1; index < rawRows.length; index += 1) {
    const row = rawRows[index] || [];
    const hasKeywordTotalData = indexes.some((columnIndex) => normalizeCell(row[columnIndex]));
    if (hasKeywordTotalData) {
      lastDataRowNumber = index + 1;
    }
  }

  return lastDataRowNumber + 1;
}

export function buildKeywordTotalTsv(rows, { includeHeader = false } = {}) {
  const lines = rows.map((row) => [row.词根, row.关键词, row.国家, row.搜索量, row.KD, row.判断].join("\t"));
  if (includeHeader) {
    lines.unshift(KEYWORD_TOTAL_HEADERS.join("\t"));
  }
  return lines.join("\n");
}

export function buildKeywordTotalValues(rows, { includeHeader = false } = {}) {
  const values = rows.map((row) => [row.词根, row.关键词, row.国家, row.搜索量, row.KD, row.判断]);
  if (includeHeader) {
    values.unshift(KEYWORD_TOTAL_HEADERS);
  }
  return values;
}

export function isKeywordTotalHeaderRow(row) {
  return KEYWORD_TOTAL_HEADERS.every((header, index) => normalizeCell(row?.[index]) === header);
}
