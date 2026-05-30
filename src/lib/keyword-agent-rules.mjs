const TARGET_COLUMNS = [
  "意图",
  "第一次判断",
  "难度",
  "第二次判断",
  "变现渠道",
  "第三次判断",
  "建议",
  "判断依据",
  "评级"
];
export const AGENT_STATUS_COLUMN = "agent状态";

const TOOL_SUFFIXES = new Set([
  "calculator",
  "checker",
  "converter",
  "generator",
  "compiler",
  "editor",
  "tester",
  "interpreter",
  "formatter",
  "creator",
  "maker",
  "planner",
  "tracker",
  "timer"
]);

const DOMAIN_SUFFIXES = new Set(["online", "pro", "tool", "app"]);

const BRAND_PATTERNS = [
  /\badobe\b/,
  /\bdesmos\b/,
  /\bchipotle\b/,
  /\bcanva\b/,
  /\badp\b/,
  /\blastpass\b/,
  /\bnorton\b/,
  /\brunway\b/,
  /\bchatgpt\b/,
  /\bchat\s*gpt\b/,
  /\bgemini\b/,
  /\bsuno\b/,
  /\bscribbr\b/,
  /\bgenerac\b/,
  /\bhonda\b/,
  /\bjackery\b/,
  /\bperchance\b/
];

const EXCLUSION_PATTERNS = [
  { type: "成人敏感", pattern: /\b(porn|porno|nsfw|adult|nude|xxx|hentai|erotic|sex)\b/ },
  { type: "赌博博彩", pattern: /\b(casino|slots?|sportsbook|betting|gambling|lottery|poker)\b/ },
  { type: "破解盗版", pattern: /\b(cracks?|cracked|torrent|pirate|mod\s*apk|keygen|activation|bypass|unlocker?)\b/ },
  { type: "医疗高风险", pattern: /\b(dosage|dose|drug|medication|symptom|diagnosis|peptide)\b/ },
  { type: "法律税务高风险", pattern: /\b(legal|lawyer|lawsuit|tax|irs)\b/ },
  { type: "金融投资建议", pattern: /\b(stock|crypto|forex|trading|investment|401k|retirement|option\s*profit)\b/ },
  { type: "实体发电机/商品词", pattern: /\b(honda|generac|jackery|portable|solar|powered|power|inverter|whole\s+house|standby|diesel|gas|propane|ozone)\s+generator\b|\bgenerator\s+(for\s+sale|price|parts|manual|oil|battery|repair)\b/ }
];

const SIMPLE_AI_REPLACED_PATTERNS = [
  { type: "单位换算", pattern: /\b(cm|centimeter|inches?|inch|kg|kilogram|lbs?|pounds?|mile|km|kilometer|meter|feet|foot|fahrenheit|celsius)\s+to\s+(cm|centimeter|inches?|inch|kg|kilogram|lbs?|pounds?|mile|km|kilometer|meter|feet|foot|fahrenheit|celsius)\b/ },
  { type: "货币换算", pattern: /\b(usd|eur|gbp|jpy|cny|rmb|cad|aud|hkd)\s+to\s+(usd|eur|gbp|jpy|cny|rmb|cad|aud|hkd)\b|\bcurrency\s+(converter|calculator)\b|\bexchange\s+rate\b/ },
  { type: "简单数学", pattern: /\b(percent|percentage)\b/ },
  { type: "日期时间", pattern: /\b(days?\s+between|date\s+calculator|time\s+duration|hours?\s+calculator|minutes?\s+calculator)\b/ }
];

const LIGHT_PATTERNS = [
  /\b(text|font|cursive|bold|italic|tiny|ascii|zalgo|glitch|morse|signature|barcode|qr|password|random|name|word|letter|color|team|group|bingo|bracket|citation|mla|apa|chicago|acs|ama|ieee|invoice|grade|gpa|tip|body\s*fat|bmi|tdee|calorie|1rm|one\s+rep|max|pace|sleep|pregnancy|due\s+date|concrete|square\s+footage|fraction|average|standard\s+deviation|compound\s+interest)\b/
];

const HEAVY_PATTERNS = [
  /\b(ai|image|video|music|song|lyrics|chatgpt|chat\s*gpt|gemini|runway|suno|perchance|tattoo|map|upc|desmos|scientific)\b/
];

const SAAS_SIGNAL_PATTERNS = [
  /\b(invoice|email\s+signature|signature|citation|mla|apa|chicago|acs|ama|ieee|resume|cover\s+letter|barcode|qr|time\s+card|time\s+clock|grade|gpa|pdf|csv|api|bulk|batch|template|tracker|planner|editor|compiler|formatter|checker)\b/
];

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value) {
  const text = normalize(value);
  return text ? text.split(" ") : [];
}

function firstMatch(patterns, text) {
  return patterns.find((item) => item.pattern.test(text)) || null;
}

function hasAny(patterns, text) {
  return patterns.some((pattern) => pattern.test(text));
}

function compactText(parts, limit = 50) {
  const text = parts.filter(Boolean).join("；");
  return text.length <= limit ? text : text.slice(0, limit - 1);
}

function exclusionRationale(keyword, reason) {
  if (reason === "实体发电机/商品词") {
    return "真实意图是实体发电机/商品词，不是在线工具需求";
  }
  if (String(reason || "").includes("可被AI直接满足")) {
    return reason;
  }
  return compactText([reason || "不符合客户目标意图"], 80);
}

function parseChannels(rule) {
  return [rule?.["变现渠道1"], rule?.["变现渠道2"]]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean)
    .map((value) => value === "轻saas" || value === "轻SaaS".toLowerCase() ? "轻saas" : value);
}

function targetIntent(rule) {
  return String(rule?.["意图"] || "工具站").trim() || "工具站";
}

function abilities(rule) {
  return [rule?.["能力1"], rule?.["能力2"]]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function isBrandKeyword(text) {
  return hasAny(BRAND_PATTERNS, text);
}

function classifyIntent(keyword, rule) {
  const text = normalize(keyword);
  const desiredIntent = targetIntent(rule);
  const excluded = firstMatch(EXCLUSION_PATTERNS, text);
  if (excluded) {
    return {
      intent: "其他",
      firstJudgement: "排除",
      stop: true,
      reason: excluded.type
    };
  }

  const aiReplaced = firstMatch(SIMPLE_AI_REPLACED_PATTERNS, text);
  if (aiReplaced) {
    return {
      intent: "其他",
      firstJudgement: "排除",
      stop: true,
      reason: `${aiReplaced.type}可被AI直接满足`
    };
  }

  const parts = tokens(keyword);
  const last = parts[parts.length - 1] || "";
  const isToolShaped =
    TOOL_SUFFIXES.has(last) ||
    DOMAIN_SUFFIXES.has(last) ||
    parts.some((part) => TOOL_SUFFIXES.has(part));

  if (!isToolShaped) {
    return {
      intent: "其他",
      firstJudgement: "排除",
      stop: true,
      reason: "不是明确工具/站点需求"
    };
  }

  return {
    intent: desiredIntent,
    firstJudgement: "继续",
    stop: false,
    reason: `匹配${desiredIntent}需求`
  };
}

function technicalDifficulty(keyword) {
  const text = normalize(keyword);
  if (hasAny(HEAVY_PATTERNS, text)) {
    return {
      level: "重",
      difficulty: "重：依赖AI/第三方/实时能力",
      recommended: false,
      reason: "难以仅靠CF边缘轻量交付"
    };
  }
  if (hasAny(LIGHT_PATTERNS, text)) {
    return {
      level: "轻",
      difficulty: "轻：纯前端或Workers可做",
      recommended: true,
      reason: "可用静态页/Workers/KV轻量实现"
    };
  }
  return {
    level: "中",
    difficulty: "中：需少量数据或模板逻辑",
    recommended: true,
    reason: "边缘部署可做但需验证数据来源"
  };
}

function abilityMatches(difficulty, rule) {
  const configuredAbilities = abilities(rule);
  if (configuredAbilities.length === 0) {
    return true;
  }
  const text = configuredAbilities.join(" ").toLowerCase();
  if (difficulty.level === "重") {
    return false;
  }
  if (/轻|tool|工具|saas|workers|cf|边缘|批量/.test(text)) {
    return true;
  }
  return difficulty.level === "轻";
}

function chooseMonetization(keyword) {
  const text = normalize(keyword);
  if (hasAny(SAAS_SIGNAL_PATTERNS, text)) {
    return {
      channel: "轻saas",
      reason: "存在保存/批量/导出/API/职业场景信号"
    };
  }
  if (hasAny(HEAVY_PATTERNS, text)) {
    return {
      channel: "其他",
      reason: "变现依赖外部平台或重能力"
    };
  }
  return {
    channel: "广告",
    reason: "一次性免费工具更适合广告承接"
  };
}

function rating(secondJudgement, thirdJudgement) {
  if (secondJudgement === "推荐" && thirdJudgement === "推荐") {
    return "A";
  }
  if (secondJudgement === "不推荐" && thirdJudgement === "不推荐") {
    return "C";
  }
  return "B";
}

function buildRecommendation({ keyword, difficulty, monetization, brand }) {
  const parts = [];
  if (monetization.channel === "轻saas") {
    parts.push("做免费入口+保存/批量/导出付费");
  } else if (monetization.channel === "广告") {
    parts.push("做免费轻工具页承接Bing流量");
  } else {
    parts.push("先验证非广告/非SaaS路径");
  }
  if (difficulty.level === "重") {
    parts.push("技术重不适合边缘轻站");
  }
  if (brand) {
    parts.push("涉及品牌词需避开商标误导");
  }
  if (/citation|mla|apa|chicago|acs|ama|ieee/.test(normalize(keyword))) {
    parts.push("强化格式模板和导出");
  }
  return compactText(parts, 50);
}

export function evaluateKeywordAgentRow(keywordRow, rule) {
  const keyword = keywordRow?.record?.["关键词"] || keywordRow?.["关键词"] || "";
  const intentResult = classifyIntent(keyword, rule);
  const result = {
    "意图": intentResult.intent,
    "第一次判断": intentResult.firstJudgement
  };

  if (intentResult.stop) {
    result["判断依据"] = exclusionRationale(keyword, intentResult.reason);
    result[AGENT_STATUS_COLUMN] = "排除";
    return {
      values: result,
      stopAfterFirstJudgement: true,
      summary: intentResult.reason
    };
  }

  const text = normalize(keyword);
  const brand = isBrandKeyword(text);
  const difficulty = technicalDifficulty(keyword);
  const secondRecommended = difficulty.recommended && abilityMatches(difficulty, rule);
  const secondJudgement = secondRecommended ? "推荐" : "不推荐";
  const monetization = chooseMonetization(keyword);
  const channels = parseChannels(rule);
  const channelAllowed = channels.length === 0 || channels.includes(monetization.channel);
  const thirdRecommended =
    monetization.channel !== "其他" &&
    channelAllowed &&
    secondJudgement === "推荐";
  const thirdJudgement = thirdRecommended ? "推荐" : "不推荐";

  result["难度"] = difficulty.difficulty;
  result["第二次判断"] = secondJudgement;
  result["变现渠道"] = monetization.channel;
  result["第三次判断"] = thirdJudgement;
  result["建议"] = buildRecommendation({ keyword, difficulty, monetization, brand });
  result["判断依据"] = compactText([
    intentResult.reason,
    difficulty.reason,
    monetization.reason,
    channelAllowed ? "" : "不匹配客户变现渠道",
    brand ? "品牌词风险" : ""
  ], 80);
  result["评级"] = rating(secondJudgement, thirdJudgement);
  result[AGENT_STATUS_COLUMN] = "完成";

  return {
    values: result,
    stopAfterFirstJudgement: false,
    summary: result["判断依据"]
  };
}

export function targetAgentColumns() {
  return [...TARGET_COLUMNS];
}
