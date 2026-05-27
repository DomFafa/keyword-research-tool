const HARD_EXCLUSION_PATTERNS = [
  /\bnear\s+me\b/,
  /\bporn\b/,
  /\badult\b/,
  /\bnude\b/,
  /\binstallation\b/,
  /\binstaller\b/,
  /\brepair\b/,
  /\bservice\b/,
  /\bcontractor\b/,
  /\bjobs?\b/,
  /\bsalary\b/
];

const DOMAIN_SUFFIX_WORDS = new Set(["online", "pro", "tool", "app"]);
const TOOL_INTENT_SUFFIX_WORDS = new Set([
  "calculator",
  "checker",
  "converter",
  "generator",
  "compiler",
  "editor",
  "tester",
  "interpreter",
  "formatter"
]);

function normalizeKeyword(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  const normalized = normalizeKeyword(value);
  return normalized ? normalized.split(" ") : [];
}

function normalizeRoot(value) {
  const tokens = tokenize(value);
  return tokens[tokens.length - 1] || "";
}

export function evaluateKeywordForToolSite(row, task) {
  const keyword = row?.关键词 || row?.keyword || "";
  const root = normalizeRoot(task?.rootKeyword || task?.query || row?.词根 || row?.root || "");
  const normalizedKeyword = normalizeKeyword(keyword);
  const tokens = tokenize(keyword);
  const lastToken = tokens[tokens.length - 1] || "";

  if (!normalizedKeyword || tokens.length === 0) {
    return { accepted: false, reason: "empty_keyword" };
  }

  const exclusion = HARD_EXCLUSION_PATTERNS.find((pattern) => pattern.test(normalizedKeyword));
  if (exclusion) {
    return { accepted: false, reason: `contains_excluded_term:${exclusion.source}` };
  }

  if (root && normalizedKeyword === root) {
    return { accepted: false, reason: "exact_root_only" };
  }

  if (tokens.length > 6) {
    return { accepted: false, reason: "too_many_words" };
  }

  const endsWithRoot = Boolean(root && lastToken === root);
  const endsWithDomainSuffix = DOMAIN_SUFFIX_WORDS.has(lastToken);
  const endsWithToolIntent = TOOL_INTENT_SUFFIX_WORDS.has(lastToken);
  if (!endsWithRoot && !endsWithDomainSuffix && !endsWithToolIntent) {
    return {
      accepted: false,
      reason: `unsupported_suffix:${lastToken || "none"}`
    };
  }

  return {
    accepted: true,
    reason: endsWithRoot
      ? "ends_with_root"
      : endsWithDomainSuffix
        ? `ends_with_domain_suffix:${lastToken}`
        : `ends_with_tool_suffix:${lastToken}`
  };
}

export function filterKeywordRowsForToolSites(rows, task) {
  const machineFilter = String(task?.machineFilter || "").trim();
  const enabled = machineFilter !== "否";
  const accepted = [];
  const rejected = [];
  const annotatedRows = [];

  for (const row of rows) {
    const evaluation = enabled
      ? evaluateKeywordForToolSite(row, task)
      : { accepted: true, reason: "machine_filter_disabled" };
    const annotated = {
      ...row,
      判断: evaluation.accepted ? "继续" : "拒绝",
      机器筛选状态: evaluation.accepted ? "通过" : "拒绝",
      机器筛选原因: evaluation.reason
    };
    annotatedRows.push(annotated);
    if (evaluation.accepted) {
      accepted.push(annotated);
    } else {
      rejected.push(annotated);
    }
  }

  return {
    rows: annotatedRows,
    accepted,
    rejected,
    summary: {
      enabled,
      rawRows: rows.length,
      acceptedRows: accepted.length,
      rejectedRows: rejected.length
    }
  };
}
