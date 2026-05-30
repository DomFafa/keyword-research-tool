const BRAND_PATTERNS = [
  /\bcanva\b/,
  /\badobe\b/,
  /\bchipotle\b/,
  /\bdesmos\b/,
  /\blastpass\b/,
  /\bnorton\b/,
  /\badp\b/,
  /\bscribbr\b/,
  /\bchatgpt\b/,
  /\bchat\s*gpt\b/,
  /\bgemini\b/,
  /\brunway\b/,
  /\bsuno\b/,
  /\bperplexity\b/
];

const AMBIGUOUS_SUFFIX_PATTERNS = [
  /\bgenerator\b/,
  /\bmaker\b/,
  /\bcreator\b/,
  /\bbuilder\b/,
  /\bplanner\b/
];

const TECHNICAL_UNCERTAINTY_PATTERNS = [
  /\bai\b/,
  /\bimage\b/,
  /\bvideo\b/,
  /\bmusic\b/,
  /\bsong\b/,
  /\bvoice\b/,
  /\bmap\b/,
  /\bupc\b/,
  /\bapi\b/,
  /\bdataset\b/,
  /\brealtime\b/,
  /\blive\b/,
  /\bscanner\b/,
  /\brecognition\b/
];

const SAAS_SIGNAL_PATTERNS = [
  /\bbatch\b/,
  /\bbulk\b/,
  /\bexport\b/,
  /\bapi\b/,
  /\btemplate\b/,
  /\bhistory\b/,
  /\bteam\b/,
  /\bpdf\b/,
  /\bcsv\b/,
  /\bdashboard\b/,
  /\bworkflow\b/
];

const AI_ANSWER_UNCERTAINTY_PATTERNS = [
  /\bsimple\b/,
  /\bquick\b/,
  /\bfree\b/,
  /\brandom\b/,
  /\bname\b/,
  /\bword\b/,
  /\bsentence\b/
];

const HARD_EXCLUDED_PATTERNS = [
  /\bhonda\s+generator\b/,
  /\bsolar\s+generator\b/,
  /\bportable\s+generator\b/,
  /\bgenerac\s+generator\b/,
  /\bwhole\s+house\s+generator\b/,
  /\btax\s+calculator\b/,
  /\bstock\s+calculator\b/,
  /\bcrypto\s+calculator\b/,
  /\bforex\s+trading\s+calculator\b/,
  /\boption\s+profit\s+calculator\b/,
  /\bpercentage\s+calculator\b/,
  /\bcm\s+to\s+inches\b/,
  /\busd\s+to\s+cny\b/,
  /\bdays\s+between\s+dates\s+calculator\b/
];

const FINANCIAL_EDUCATION_PATTERNS = [
  /\b401\s*k\s+calculator\b/,
  /\b401k\s+calculator\b/,
  /\bretirement\s+calculator\b/,
  /\bmortgage\s+calculator\b/,
  /\bloan\s+calculator\b/,
  /\bcompound\s+interest\s+calculator\b/,
  /\bdebt\s+payoff\s+calculator\b/
];

const B2B_CLEAR_PATTERNS = [
  /\bmanufacturer\b/,
  /\bsupplier\b/,
  /\bdistributor\b/,
  /\bfactory\b/,
  /\boem\b/,
  /\bodm\b/,
  /\brfq\b/,
  /\bquote\b/
];

function hasAny(patterns, text) {
  return patterns.some((pattern) => pattern.test(text));
}

function ruleAllowsSaas(rule) {
  const channels = [rule?.["变现渠道1"], rule?.["变现渠道2"]]
    .map((value) => String(value || "").trim().toLowerCase());
  return channels.includes("轻saas") || channels.includes("轻SaaS".toLowerCase());
}

function levelForReasons(reasons) {
  if (reasons.includes("brand_boundary") || reasons.includes("technical_uncertainty")) {
    return "medium";
  }
  if (reasons.length > 0) {
    return "low";
  }
  return "none";
}

export function normalizeKeywordText(keyword) {
  return String(keyword || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function detectResearchNeeds({ keyword, rule = {}, keywordRecord = {} } = {}) {
  const text = normalizeKeywordText(keyword || keywordRecord["关键词"] || "");
  const reasons = [];

  if (!text || hasAny(HARD_EXCLUDED_PATTERNS, text) || hasAny(FINANCIAL_EDUCATION_PATTERNS, text)) {
    return { needed: false, reasons, level: "none" };
  }

  const clearB2b = hasAny(B2B_CLEAR_PATTERNS, text);
  const brandBoundary = hasAny(BRAND_PATTERNS, text);
  const technicalUncertainty = hasAny(TECHNICAL_UNCERTAINTY_PATTERNS, text);
  if (clearB2b && !brandBoundary && !technicalUncertainty) {
    return { needed: false, reasons, level: "none" };
  }

  if (brandBoundary) {
    reasons.push("brand_boundary");
  }
  if (hasAny(AMBIGUOUS_SUFFIX_PATTERNS, text)) {
    reasons.push("ambiguous_suffix");
  }
  if (technicalUncertainty) {
    reasons.push("technical_uncertainty");
  }
  if (ruleAllowsSaas(rule) && !hasAny(SAAS_SIGNAL_PATTERNS, text)) {
    reasons.push("saas_uncertainty");
  }
  if (hasAny(AI_ANSWER_UNCERTAINTY_PATTERNS, text)) {
    reasons.push("ai_answer_uncertainty");
  }

  return {
    needed: reasons.length > 0,
    reasons,
    level: levelForReasons(reasons)
  };
}
