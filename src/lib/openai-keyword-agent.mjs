import { AGENT_STATUS_COLUMN } from "./keyword-agent-rules.mjs";
import { summarizeResearchForPrompt } from "./keyword-agent-research.mjs";

const DEFAULT_MODEL = "gpt-5.4-mini";
export { AGENT_STATUS_COLUMN };

export const KEYWORD_AGENT_SYSTEM_PROMPT = `你是关键词产品机会判断 agent，不是流量筛选器。

输入信任边界：
这些 rows 已经通过前置流程：Semrush 词根拓展、机器粗筛、Bing Webmaster 3M展示门槛、Bing SERP top5 根域名竞争筛选。
不要重新设置搜索量、KD、Bing展示、竞争度门槛。只做最后产品判断：真实意图、是否值得做站、技术难度、变现渠道、是否匹配客户能力。

真实意图优先：
不要只看词尾。generator/calculator/checker/converter 可能是在线工具，也可能是实体商品、品牌官方工具、购买词、服务词。
必须判断用户是否真的想打开网页输入内容或参数并得到结果。

动态客户意图：
customerConfig.desiredIntent 是客户目标意图。输出 intent 只能是 customerConfig.desiredIntent 或 其他。
不能硬贴 customerConfig.desiredIntent。必须先判断关键词真实意图：
- 真实意图匹配客户目标：intent=customerConfig.desiredIntent，firstJudgement=继续
- 真实意图不匹配：intent=其他，firstJudgement=排除
例子：
- invoice generator + 工具站 => 继续
- invoice generator + B端展示站 => 排除
- gaming microphone manufacturer + B端展示站 => 继续
- memory chip distributor + 工具站 => 排除

工具站定义：
用户希望打开网页输入内容/参数并得到结果。
例子：signature generator, mla citation generator, color contrast checker, invoice generator, 401k calculator, retirement calculator, random word generator。

B端展示站定义：
用户在找供应商、厂家、OEM/ODM、批发、企业服务、报价、RFQ、行业解决方案。
例子：gaming microphone manufacturer, fpv drone supplier, memory chip distributor, custom pcb manufacturer, oem microphone factory, industrial camera supplier。

直接排除：
以下 firstJudgement=排除：成人/NSFW、赌博/博彩、破解/盗版/绕过付费、医疗诊断或药物剂量、单位换算如 cm to inches、货币换算如 usd to cny、简单数学如 percentage calculator、日期时间简单计算如 days between dates calculator/date calculator/calendar calculator、实体商品、购买、价格、manual、parts、repair、installation、本地服务、招聘、工资、职位类关键词、best/free/review/list 型 video editor 推荐/对比内容意图。

软排除项：
法律/税务高风险、tax calculator、IRS、lawyer、lawsuit、stock、crypto、forex、trading、investment、option profit、day trading 不直接按普通难度评级；只有 difficulty 轻开头时评级固定为 C。如果 difficulty 中/重开头，则排除。如果同时涉及品牌、商标、版权或官方授权风险，也从 C 降级为排除。

健康教育估算器例外：
pregnancy calculator、due date calculator、pregnancy due date calculator、ivf due date calculator、ovulation calculator、conception calculator、BMI/body fat/calorie/recipe calorie/TDEE calculator 可以继续。
这些只能做健康教育估算，必须提示 YMYL / 免责声明 / 避免医疗建议。drug / dosage / diagnosis / symptom 仍然排除。

金融教育估算器例外：
不要把 401k calculator、401(k) calculator、retirement calculator、mortgage calculator、loan calculator、compound interest calculator、savings calculator、debt payoff calculator、cd calculator、certificate of deposit calculator、roth ira calculator、ira calculator、paycheck calculator、salary paycheck calculator 一刀切排除。
这些可以继续，但必须只定位为教育估算器，不提供财务/税务建议，并在 recommendation 或 rationale 中提示 YMYL / 教育估算 / 免责声明 / 避免财务建议。investment/stock/crypto/forex/trading/tax 属软排除项；轻难度固定 C，中/重难度排除，叠加品牌/版权/官方授权风险也排除。

实体 generator 例子：
honda generator、solar generator、portable generator、generac generator、whole house generator、inverter generator 是实体商品或购买意图，不是在线工具，必须排除。

品牌词：
品牌词不自动排除。但 recommendation 或 rationale 必须包含品牌/商标风险提示。
只有关键词明确包含品牌信号时，才提示品牌/商标风险。不要把 generic tool keyword 误判成品牌词。
signature generator、cursive generator、mla citation generator 不是品牌词，不要提示品牌风险。
例子：canva qr code generator, adobe qr code generator, chipotle nutrition calculator, desmos graphing calculator, lastpass password generator, suno ai music generator, scribbr citation generator, perchance ai story generator, starbucks calorie calculator, smartasset paycheck calculator, dave ramsey mortgage calculator, capcut video editor。

技术难度：
difficulty 必须是 轻：原因 / 中：原因 / 重：原因。
轻：前端计算、模板生成、简单文本处理、简单文件转换；Cloudflare Pages / Workers / KV / D1 / R2 可实现；不需要登录或登录可选。
中：需要少量数据源、模板库、导出、轻量账号或轻量状态；边缘部署可做但需要验证。
重：GPU、AI 图片/视频/音乐生成、复杂爬虫、官方授权或版权数据、实时第三方数据、复杂账号体系/队列/状态、高风险专业判断。
AI 图片/视频/音乐/语音/故事生成器、video editor、map calculator、UPC generator 不要轻易给 A；默认中/重，需要提示 API/数据/版权/成本/校验风险。best/free/review/list 型 video editor 词是真实推荐/对比内容意图，不是工具站需求，应排除。

第二次判断：
技术轻或中，且匹配 customerConfig.abilities，输出 推荐。技术重或明显不匹配能力，输出 不推荐。abilities 为空时，不要因为能力为空而拒绝。

变现渠道：
monetization 只能是 广告 / 轻saas / 其他。
广告：一次性免费工具，高频搜索，用户付费意愿弱，适合 EMD + Bing + Adsense。
轻saas：必须有订阅理由，如保存历史、批量处理、导出 PDF/CSV/图片、团队协作、API、高级模板、高级参数、职业工作流。
其他：电商、联盟、线索、询盘、品牌截流、实体商品、无清晰广告/SaaS路径、灰色高风险方向。B端展示站通常是 其他，因为更适合询盘/线索/RFQ。

第三次判断：
如果 monetization 不在 customerConfig.allowedMonetizationChannels 中，thirdJudgement=不推荐。
如果 monetization=其他，默认不推荐。但 B端展示站 + 客户允许 其他 + 有清晰询盘/线索路径时，可以推荐。

评级：
不要自由发挥。基础评级只看 difficulty：轻开头 => A；中开头 => B；重开头 => C。
如果属于软排除项，只有轻难度固定 C，中/重难度排除。其他行基础评级只看 difficulty：轻开头 => A；中开头 => B；重开头 => C。
如果 recommendation/rationale/keyword 中涉及品牌、商标、版权或官方授权风险，则降一级：A=>B，B=>C，C=>排除。
firstJudgement=排除 时 rating 必须为空字符串。

排除行：
如果 firstJudgement=排除：intent=其他，difficulty=""，secondJudgement=""，monetization=""，thirdJudgement=""，recommendation=""，rating=""，rationale 写 8-80 字中文原因。

输出风格：
只返回 JSON Schema 要求的 JSON。不要输出 Markdown。recommendation 中文，50字以内。rationale 中文，80字以内。
宁可保守，不要把实体商品词、错配意图词、灰色词、重技术词误判成 A。`;

const VALID_MONETIZATION_CHANNELS = ["广告", "轻saas", "其他"];
const VALID_JUDGEMENTS = ["推荐", "不推荐"];
const VALID_RATINGS = ["A", "B", "C"];
const DEFAULT_EXCLUDED_RATIONALE = "LLM判定为排除，原始判断依据不足，需人工复核";
const DEFAULT_CONTINUE_RATIONALE = "LLM判断依据不足，已按客户配置完成字段兜底";
const EXPLICIT_BRAND_KEYWORDS = [
  "adobe",
  "canva",
  "chipotle",
  "desmos",
  "lastpass",
  "norton",
  "adp",
  "scribbr",
  "chatgpt",
  "gemini",
  "runway",
  "suno",
  "perplexity",
  "generac",
  "honda",
  "jackery",
  "perchance",
  "starbucks",
  "smartasset",
  "dave ramsey",
  "capcut"
];
const BRAND_RISK_PATTERN = /品牌|商标|误导|同名站|截流|brand|trademark/i;
const HEALTH_RISK_PATTERN = /健康教育|YMYL|免责声明|医疗建议|仅作教育|教育用途/i;
const FINANCIAL_RISK_PATTERN = /金融教育|工资|税务估算|YMYL|免责声明|财务建议|税务建议|教育估算|仅供参考|Certificate of Deposit/i;
const HEAVY_RISK_PATTERN = /AI|第三方|版权|成本|地图|地理编码|API|UPC|编码|校验|数据|视频编辑|重能力/i;

const OUTPUT_SCHEMA = {
  name: "keyword_agent_batch_decision",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["decisions"],
    properties: {
      decisions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "rowNumber",
            "intent",
            "firstJudgement",
            "difficulty",
            "secondJudgement",
            "monetization",
            "thirdJudgement",
            "recommendation",
            "rationale",
            "rating"
          ],
          properties: {
            rowNumber: { type: "integer" },
            intent: { type: "string" },
            firstJudgement: { type: "string", enum: ["继续", "排除"] },
            difficulty: { type: "string" },
            secondJudgement: { type: "string", enum: ["推荐", "不推荐", ""] },
            monetization: { type: "string", enum: ["广告", "轻saas", "其他", ""] },
            thirdJudgement: { type: "string", enum: ["推荐", "不推荐", ""] },
            recommendation: { type: "string" },
            rationale: { type: "string" },
            rating: { type: "string", enum: ["A", "B", "C", ""] }
          }
        }
      }
    }
  }
};

function compactRecord(record, headers) {
  return Object.fromEntries(headers.map((header) => [header, record?.[header] || ""]));
}

function channelsFromRule(rule) {
  return [rule?.["变现渠道1"], rule?.["变现渠道2"]]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function abilitiesFromRule(rule) {
  return [rule?.["能力1"], rule?.["能力2"]]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function desiredIntent(rule) {
  return String(rule?.["意图"] || "工具站").trim() || "工具站";
}

function normalizeMonetization(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text === "轻saas" || text === "轻saas".toLowerCase()) {
    return "轻saas";
  }
  if (text === "广告" || text === "ad" || text === "ads" || text === "adsense") {
    return "广告";
  }
  if (text === "其他" || text === "other") {
    return "其他";
  }
  return "";
}

function normalizeAllowedChannels(channels) {
  return (Array.isArray(channels) ? channels : [])
    .map((channel) => normalizeMonetization(channel))
    .filter(Boolean);
}

function customerConfigFromRule(rule) {
  return {
    desiredIntent: desiredIntent(rule),
    allowedMonetizationChannels: normalizeAllowedChannels(channelsFromRule(rule))
  };
}

export function normalizeKeywordForBrand(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasExplicitBrandSignal(keyword) {
  const normalized = normalizeKeywordForBrand(keyword);
  return EXPLICIT_BRAND_KEYWORDS.some((brand) => new RegExp(`(^| )${brand}( |$)`).test(normalized));
}

export function containsBrandRiskText(text) {
  return BRAND_RISK_PATTERN.test(String(text || ""));
}

export function cleanupGenericBrandRiskText(text, fallback) {
  const cleaned = String(text || "")
    .split(/[；;。.]/)
    .map((part) => part.trim())
    .filter((part) => part && !containsBrandRiskText(part))
    .join("；")
    .trim();
  return cleaned.length >= 4 ? cleaned : fallback;
}

function includesAny(patterns, text) {
  return patterns.some((pattern) => pattern.test(text));
}

function keywordFromRow(row, decision) {
  return String(
    row?.keyword ||
    row?.keywordRecord?.["关键词"] ||
    row?.record?.["关键词"] ||
    decision?.keyword ||
    ""
  ).trim();
}

function normalizedKeyword(row, decision) {
  return normalizeKeywordForBrand(keywordFromRow(row, decision));
}

function isHardMedicalKeyword(keyword) {
  return /\b(drugs?|dosage|dose|diagnosis|symptoms?|medication|peptide)\b/.test(keyword);
}

function isHealthEducationCalculator(keyword) {
  return /\b(pregnancy\s+due\s+date|ivf\s+due\s+date|due\s+date|pregnancy|ovulation|conception|bmi|body\s+fat|recipe\s+calorie|calorie|tdee)\s+calculator\b/.test(keyword);
}

function isGenericHealthExclusion(reason) {
  return /健康|孕期|医疗|高风险|风险|medical|pregnancy|health/i.test(String(reason || ""));
}

function isHardFinancialOrTaxKeyword(keyword) {
  return /\b(investment|stock|crypto|forex|trading|option\s+profit|tax|irs)\b/.test(keyword);
}

function isSimpleAiReplacedKeyword(keyword) {
  return /\b(cm|centimeter|inches?|inch|kg|kilogram|lbs?|pounds?|mile|km|kilometer|meter|feet|foot|fahrenheit|celsius)\s+to\s+(cm|centimeter|inches?|inch|kg|kilogram|lbs?|pounds?|mile|km|kilometer|meter|feet|foot|fahrenheit|celsius)\b/.test(keyword) ||
    /\b(usd|eur|gbp|jpy|cny|rmb|cad|aud|hkd)\s+to\s+(usd|eur|gbp|jpy|cny|rmb|cad|aud|hkd)\b|\bcurrency\s+(converter|calculator)\b|\bexchange\s+rate\b/.test(keyword) ||
    /\b(percent|percentage)\b/.test(keyword) ||
    /\b(days?\s+between|date\s+calculator|calendar\s+calculator|time\s+duration|hours?\s+calculator|minutes?\s+calculator)\b/.test(keyword);
}

function isPhysicalProductKeyword(keyword) {
  return /\b(honda|generac|jackery|portable|solar|powered|power|inverter|whole\s+house|standby|diesel|gas|propane|ozone)\s+generator\b|\bgenerator\s+(for\s+sale|price|parts|manual|oil|battery|repair)\b/.test(keyword) ||
    /\b(for\s+sale|price|manual|parts|repair|installation|local\s+service)\b/.test(keyword);
}

function isJobSalaryKeyword(keyword) {
  if (isPaycheckCalculator(keyword)) {
    return false;
  }
  return /\b(jobs?|careers?|salary|salaries|positions?|hiring|recruit(?:ing|ment)?)\b/.test(keyword);
}

function directExclusionReason(keyword) {
  if (isSimpleAiReplacedKeyword(keyword)) return "简单直答/换算/日期时间计算，可被搜索或AI直接满足";
  if (/\b(porn|porno|nsfw|adult|nude|xxx|hentai|erotic|sex)\b/.test(keyword)) return "成人敏感内容，直接排除";
  if (/\b(casino|slots?|sportsbook|betting|gambling|lottery|poker)\b/.test(keyword)) return "赌博博彩内容，直接排除";
  if (/\b(cracks?|cracked|torrent|pirate|mod\s*apk|keygen|activation|bypass|unlocker?)\b/.test(keyword)) return "破解盗版或绕过付费内容，直接排除";
  if (isHardMedicalKeyword(keyword)) return "医疗诊断或药物剂量高风险，直接排除";
  if (isPhysicalProductKeyword(keyword)) return "实体商品/购买/维修安装意图，不是在线工具需求";
  if (isContentRecommendationIntent(keyword)) return "真实意图是推荐/对比内容，不是在线工具需求";
  if (isJobSalaryKeyword(keyword)) return "招聘/工资/职位类关键词，直接排除";
  return "";
}

function isSoftExclusionKeyword(keyword) {
  return isHardFinancialOrTaxKeyword(keyword);
}

function isFinancialEducationCalculator(keyword) {
  return /\b(401\s*k|401k|retirement|mortgage|loan|compound\s+interest|savings|debt\s+payoff|cd|certificate\s+of\s+deposit|roth\s+ira|ira|paycheck|salary\s+paycheck)\s+calculator\b/.test(keyword) && !isHardFinancialOrTaxKeyword(keyword);
}

function isPaycheckCalculator(keyword) {
  return /\bpaycheck\s+calculator\b|\bsalary\s+paycheck\s+calculator\b/.test(keyword);
}

function isCdCalculator(keyword) {
  return /\bcd\s+calculator\b|\bcertificate\s+of\s+deposit\s+calculator\b/.test(keyword);
}

function isContentRecommendationIntent(keyword) {
  return /\b(best|top|review|reviews|recommend(?:ed|ation)?|comparison)\s+(free\s+)?video\s+editors?\b|\bfree\s+video\s+editor\s+apps?\b/.test(keyword);
}

function detectHeavyOrDataCapabilityRisk(keyword) {
  if (isContentRecommendationIntent(keyword)) {
    return { matched: true, kind: "content", rationale: "真实意图是推荐/对比内容，不是在线工具需求" };
  }
  if (/\b(ai|image|video|music|song|voice)\b/.test(keyword) || /\bstory\s+generator\b/.test(keyword) || /\bonline\s+video\s+editor\b|\bvideo\s+editor\b/.test(keyword)) {
    return { matched: true, kind: "heavy", rationale: "AI/视频/音乐/故事能力依赖第三方、版权或成本，不能按轻工具评估" };
  }
  if (/\bmap\s+calculator\b/.test(keyword)) {
    return { matched: true, kind: "data", rationale: "地图计算需地理编码/API/数据来源验证，不能按轻工具评估" };
  }
  if (/\bupc(?:\s+barcode)?\s+generator\b/.test(keyword)) {
    return { matched: true, kind: "data", rationale: "UPC涉及编码规则、校验和真实商品码边界，不能按轻工具评估" };
  }
  if (/\b(scanner|recognition|tattoo)\b/.test(keyword)) {
    return { matched: true, kind: "heavy", rationale: "识别/扫描/生成类能力依赖重技术或第三方能力" };
  }
  return { matched: false, kind: "", rationale: "" };
}

function appendLimited(text, addition, limit) {
  const raw = String(text || "").trim();
  if (raw.includes(addition)) {
    return raw.slice(0, limit);
  }
  const separator = raw ? "；" : "";
  const combined = `${raw}${separator}${addition}`;
  return combined.length <= limit ? combined : combined.slice(0, limit);
}

function ensureRiskText({ recommendation, rationale, pattern, recommendationAddition, rationaleAddition, field, reason, warnings }) {
  if (pattern.test(`${recommendation} ${rationale}`)) {
    return { recommendation, rationale };
  }
  const nextRecommendation = appendLimited(recommendation, recommendationAddition, 50);
  const nextRationale = appendLimited(rationale, rationaleAddition, 80);
  warning(
    warnings,
    field,
    reason,
    `${recommendation} | ${rationale}`,
    `${nextRecommendation} | ${nextRationale}`
  );
  return {
    recommendation: nextRecommendation,
    rationale: nextRationale
  };
}

function normalizeCustomerConfig(row, customerConfig = {}) {
  const fromRule = customerConfigFromRule(row?.rule || {});
  const desired = String(customerConfig.desiredIntent || fromRule.desiredIntent || "工具站").trim() || "工具站";
  const channels = Array.isArray(customerConfig.allowedMonetizationChannels)
    ? customerConfig.allowedMonetizationChannels
    : fromRule.allowedMonetizationChannels;
  return {
    desiredIntent: desired,
    allowedMonetizationChannels: normalizeAllowedChannels(channels)
  };
}

function warning(warnings, field, reason, from, to) {
  warnings.push({
    field,
    reason,
    from: String(from ?? ""),
    to: String(to ?? "")
  });
}

function correctedValue({
  field,
  value,
  fallback,
  isValid,
  warnings,
  reason
}) {
  if (isValid(value)) {
    return value;
  }
  warning(warnings, field, reason, value, fallback);
  return fallback;
}

function correctedRationale({ value, fallback, maxLength = 80, minLength = 1, warnings }) {
  const raw = String(value || "").trim();
  if (!raw || raw.length < minLength) {
    const text = fallback.slice(0, maxLength);
    warning(warnings, "判断依据", "判断依据缺失或过短，已兜底", raw, text);
    return text;
  }
  if (raw.length > maxLength) {
    const text = raw.slice(0, maxLength);
    warning(warnings, "判断依据", "判断依据超过长度限制，已截断", raw, text);
    return text;
  }
  return raw;
}

function correctedRecommendation(value, warnings) {
  const raw = String(value || "").trim();
  if (!raw) {
    const fallback = "先做轻量MVP验证";
    warning(warnings, "建议", "建议缺失，已兜底", raw, fallback);
    return fallback;
  }
  if (raw.length > 50) {
    const text = raw.slice(0, 50);
    warning(warnings, "建议", "建议超过长度限制，已截断", raw, text);
    return text;
  }
  return raw;
}

function normalizedDifficulty(value, warnings) {
  const text = String(value || "").trim();
  if (/^[轻中重]：.+/.test(text)) {
    return text;
  }
  const fallback = "中：需人工复核实现难度";
  warning(warnings, "难度", "难度格式不合法，已兜底", text, fallback);
  return fallback;
}

function baseRatingFromDifficulty(difficulty) {
  const text = String(difficulty || "").trim();
  if (text.startsWith("轻")) return "A";
  if (text.startsWith("中")) return "B";
  if (text.startsWith("重")) return "C";
  return "B";
}

function containsCopyrightRiskText(text) {
  return /版权|授权|官方|copyright|license|licensing|official/i.test(String(text || ""));
}

function hasBrandOrCopyrightRisk({ keyword = "", recommendation = "", rationale = "", monetization = "", difficulty = "" } = {}) {
  const text = [recommendation, rationale, monetization, difficulty].join(" ");
  return hasExplicitBrandSignal(keyword) || containsBrandRiskText(text) || containsCopyrightRiskText(text);
}

function downgradeRatingForRisk(rating) {
  if (rating === "A") return "B";
  if (rating === "B") return "C";
  if (rating === "C") return "排除";
  return rating;
}

function computeRating(difficulty, riskContext = {}) {
  const baseRating = riskContext.softExclusion
    ? String(difficulty || "").trim().startsWith("轻") ? "C" : "排除"
    : baseRatingFromDifficulty(difficulty);
  return hasBrandOrCopyrightRisk(riskContext) ? downgradeRatingForRisk(baseRating) : baseRating;
}

function rowNumberFor(row, llmOutput) {
  return Number(llmOutput?.rowNumber || row?.rowNumber || row?.row?.rowNumber || 0);
}

export function buildPromptPayload(items) {
  return {
    task: "Classify keyword opportunities for a keyword research spreadsheet.",
    rules: {
      trafficAssumption: "Rows are already filtered to bing二次判断=继续 by Semrush expansion, machine prefilter, Bing Webmaster 3M impressions, and Bing SERP top5 root-domain competition. Do not add search volume, KD, Bing impressions, or competition thresholds.",
      firstJudgement: "Actual intent must match customerConfig.desiredIntent. Do not hard-map desiredIntent onto the keyword. If actual intent matches desiredIntent, intent=desiredIntent and firstJudgement=继续. If it does not match, intent=其他 and firstJudgement=排除.",
      dynamicIntent: "Customer desired intent comes from 词根拓展.意图 through customerConfig.desiredIntent. Output intent can only be customerConfig.desiredIntent or 其他. Examples: invoice generator + 工具站 => 继续; invoice generator + B端展示站 => 排除; gaming microphone manufacturer + B端展示站 => 继续; memory chip distributor + 工具站 => 排除.",
      actualIntent: {
        toolSite: "工具站 means the user wants to open a web page, input content/parameters, and get a result. Examples: signature generator, mla citation generator, color contrast checker, invoice generator, 401k calculator, retirement calculator, random word generator.",
        b2bShowcase: "B端展示站 means supplier/manufacturer/OEM/ODM/wholesale/distributor/vendor/enterprise service/RFQ/quote/quotation/industrial solution intent. Examples: gaming microphone manufacturer, fpv drone supplier, memory chip distributor, custom pcb manufacturer, oem microphone factory, industrial camera supplier."
      },
      exclude: [
        "adult/NSFW",
        "gambling/betting",
        "cracking/piracy/bypass paid products",
        "medical diagnosis or drug/dosage advice",
        "simple unit conversion such as cm to inches, currency conversion such as usd to cny, percentage math such as percentage calculator, or date/time arithmetic such as days between dates calculator/date calculator/calendar calculator",
        "physical products, purchase, price, manual, parts, repair, installation, local services, jobs, salary, position keywords"
      ],
      softExclusion: "Legal/tax high-risk and financial investment/trading keywords such as tax calculator, IRS, lawyer, lawsuit, stock, crypto, forex, trading, investment, option profit, and day trading are soft exclusion items: if difficulty starts with 轻, set rating=C; if difficulty starts with 中 or 重, exclude; if brand/trademark/copyright/authorization risk also appears, exclude.",
      healthEducationException: [
        "Do not hard-exclude pregnancy calculator, due date calculator, pregnancy due date calculator, IVF due date calculator, ovulation calculator, conception calculator, BMI calculator, body fat calculator, calorie calculator, recipe calorie calculator, or TDEE calculator.",
        "These may continue only as health education estimators. Recommendation/rationale must mention YMYL, disclaimer, education-only estimate, or avoiding medical advice. Drug/dosage/diagnosis/symptom calculators remain excluded."
      ],
      financialEducationException: [
        "Do not hard-exclude 401k calculator, 401(k) calculator, retirement calculator, mortgage calculator, loan calculator, compound interest calculator, savings calculator, debt payoff calculator, cd calculator, certificate of deposit calculator, Roth IRA calculator, IRA calculator, paycheck calculator, or salary paycheck calculator.",
        "These may continue as education-only estimators, but recommendation/rationale must mention YMYL, education estimate, disclaimer, or avoiding financial/tax advice. CD calculator means Certificate of Deposit calculator, not credit limit. Investment/stock/crypto/forex/trading/tax calculators are soft exclusion items: light difficulty => C; medium/heavy difficulty or brand/copyright risk => excluded."
      ],
      semanticWarnings: [
        "Do not classify by suffix alone. generator can mean an online content generator OR an electric generator product.",
        "honda generator, solar generator, portable generator, generac generator, whole house generator, inverter generator are physical product or purchase terms, not online tool-site demand.",
        "Brand terms are not automatically excluded, but recommendation and rationale must mention brand/trademark risk.",
        "Only mention brand/trademark risk when the keyword explicitly contains a brand signal. Do not treat generic tool keywords as brand terms: signature generator, cursive generator, and mla citation generator are not brand keywords. Canva QR code generator, Adobe QR code generator, Chipotle nutrition calculator, Desmos graphing calculator, LastPass password generator, Suno AI music generator, Scribbr citation generator, Perchance AI story generator, Starbucks calorie calculator, SmartAsset paycheck calculator, Dave Ramsey mortgage calculator, and CapCut video editor are brand keywords.",
        "AI image/video/music/voice/story generators, video editors, map calculator, UPC generator, and UPC barcode generator should not be rated A by default; mention API/data/copyright/cost/validation risk and downgrade when needed. Best/free/review/list video editor keywords are recommendation/comparison content intent, not direct tool-site intent."
      ],
      difficulty: "Use format 轻：reason, 中：reason, or 重：reason. 轻: frontend calculation/templates/simple text/file conversion and Cloudflare Pages/Workers/KV/D1/R2 feasible. 中: small datasets/templates/export/light account/light state, edge feasible but needs validation. 重: GPU, AI image/video/music, complex crawling, official authorization/copyright data, realtime third-party data, complex account/queue/state, high-risk professional judgement.",
      secondJudgement: "Recommend when difficulty is 轻 or 中 and compatible with customerConfig.abilities. If abilities are empty, do not reject because abilities are empty. Do not recommend when difficulty is 重 or clearly outside abilities.",
      monetization: "Choose exactly one of 广告, 轻saas, 其他. 广告 fits one-off free tools with weak willingness to pay and EMD+Bing+Adsense. 轻saas requires subscription reasons: saved history, batch processing, PDF/CSV/image export, team collaboration, API, advanced templates/parameters, professional workflow. 其他 covers ecommerce, affiliate, leads, inquiries, RFQ, brand interception, physical products, unclear ad/SaaS path, gray/high-risk directions. B端展示站 usually uses 其他 because it fits inquiry/lead/RFQ monetization.",
      saasSignals: "轻saas requires subscription reasons like saved history, batch processing, export PDF/CSV/image, team collaboration, API, advanced templates/parameters, or professional workflow.",
      thirdJudgement: "If monetization is not in customerConfig.allowedMonetizationChannels, thirdJudgement=不推荐. If monetization=其他, default 不推荐. Exception: B端展示站 + customer allows 其他 + clear inquiry/lead/RFQ path can be 推荐.",
      research: "research is read-only auxiliary context, not the final answer. If research shows official brand-tool dominance, mention brand/trademark risk. If research shows SERP is mostly physical products or purchase intent, exclude the row. If research is missing or skipped, do not invent external facts. Do not cite sources that are not present in research. Final output must still follow the JSON Schema and validator rules.",
      excludedRows: "If firstJudgement=排除, set intent=其他 and set difficulty, secondJudgement, monetization, thirdJudgement, recommendation, rating to empty strings. rationale must be an 8-80 Chinese character reason.",
      recommendation: "If not excluded, recommendation must be <=50 Chinese characters and include brand risk when relevant.",
      rationale: "rationale must be <=80 Chinese characters.",
      rating: "Do not improvise. Direct exclusion items must be excluded. Soft exclusion items are C only when difficulty starts with 轻; if soft exclusion difficulty starts with 中 or 重, exclude. Other non-excluded rows: difficulty starting with 轻 => A, 中 => B, 重 => C. If brand/trademark/copyright/authorization risk is present, downgrade one level: A=>B, B=>C, C=>排除. If firstJudgement=排除, rating must be an empty string."
    },
    rows: items.map((item) => ({
      rowNumber: item.rowNumber,
      keyword: item.keyword,
      keywordRow: compactRecord(item.keywordRecord, [
        "词根",
        "关键词",
        "国家",
        "搜索量",
        "KD",
        "3M展示",
        "top5根域名数量",
        "根域名1",
        "根域名1排名",
        "根域名2",
        "根域名2排名",
        "top 1国家",
        "top 1展示量"
      ]),
      customerConfig: {
        desiredIntent: desiredIntent(item.rule),
        allowedMonetizationChannels: channelsFromRule(item.rule),
        abilities: abilitiesFromRule(item.rule),
        root: item.rule?.["词根"] || "",
        rowIntent: item.rule?.["意图"] || ""
      },
      research: item.research ? summarizeResearchForPrompt(item.research) : { needed: false, reasons: [], confidence: "none", summary: "", topFindings: [] }
    }))
  };
}

export function validateLLMOutput(row, llmOutput, customerConfig = {}) {
  const config = normalizeCustomerConfig(row, customerConfig);
  const decision = llmOutput || {};
  const warnings = [];
  const outputRowNumber = rowNumberFor(row, decision);
  const keyword = normalizedKeyword(row, decision);
  let intent = String(decision.intent || "").trim();
  if (intent !== config.desiredIntent && intent !== "其他") {
    const fallback = decision.firstJudgement === "继续" ? config.desiredIntent : "其他";
    warning(warnings, "意图", "意图不在允许值内，已按客户配置兜底", intent, fallback);
    intent = fallback;
  }

  const firstJudgement = decision.firstJudgement === "继续" && intent !== "其他" ? "继续" : "排除";
  const excluded = firstJudgement === "排除";
  const healthEducation = isHealthEducationCalculator(keyword) && !isHardMedicalKeyword(keyword);
  const directReason = healthEducation ? "" : directExclusionReason(keyword);
  const softExclusion = !directReason && isSoftExclusionKeyword(keyword);
  if (excluded && healthEducation && isGenericHealthExclusion(decision.rationale)) {
    const monetization = config.allowedMonetizationChannels.includes("广告") || config.allowedMonetizationChannels.length === 0
      ? "广告"
      : config.allowedMonetizationChannels[0] || "广告";
    const thirdJudgement =
      config.allowedMonetizationChannels.length === 0 ||
      config.allowedMonetizationChannels.includes(monetization)
        ? "推荐"
        : "不推荐";
    const secondJudgement = "推荐";
    warning(
      warnings,
      "健康教育风险",
      "健康教育估算器被误排除，已修正",
      decision.rationale,
      "健康教育估算/YMYL，仅作教育用途，避免医疗建议"
    );
    return {
      rowNumber: outputRowNumber,
      values: {
        "意图": config.desiredIntent,
        "第一次判断": "继续",
        "难度": "中：需谨慎设计假设和免责声明",
        "第二次判断": secondJudgement,
        "变现渠道": monetization,
        "第三次判断": thirdJudgement,
        "建议": "做健康教育估算器，强化免责声明",
        "判断依据": "健康教育估算/YMYL，仅作教育用途，避免医疗建议",
        "评级": computeRating("中：需谨慎设计假设和免责声明", {
          keyword,
          recommendation: "做健康教育估算器，强化免责声明",
          rationale: "健康教育估算/YMYL，仅作教育用途，避免医疗建议"
        }),
        [AGENT_STATUS_COLUMN]: "完成"
      },
      modelRationale: String(decision.rationale || "").trim(),
      warnings
    };
  }

  if (excluded && softExclusion) {
    const difficulty = /^[轻中重]：.+/.test(String(decision.difficulty || "").trim())
      ? String(decision.difficulty || "").trim()
      : "重：软排除项缺少轻难度依据";
    const recommendation = "仅作人工复核，不建议优先做";
    const rationale = difficulty.startsWith("轻")
      ? "法律税务或金融投资软排除项，轻难度固定评级C"
      : "法律税务或金融投资软排除项，中重难度排除";
    const rating = computeRating(difficulty, {
      keyword,
      recommendation,
      rationale,
      softExclusion: true
    });
    warning(
      warnings,
      "排除项评级",
      difficulty.startsWith("轻") ? "轻难度软排除项固定评级C" : "中/重难度软排除项已排除",
      decision.rationale,
      rationale
    );
    if (rating === "排除") {
      return {
        rowNumber: outputRowNumber,
        values: {
          "意图": "其他",
          "第一次判断": "排除",
          "判断依据": appendLimited(rationale, "排除项中重难度或品牌/版权风险叠加，降级排除", 80),
          [AGENT_STATUS_COLUMN]: "排除"
        },
        modelRationale: String(decision.rationale || "").trim(),
        warnings
      };
    }
    return {
      rowNumber: outputRowNumber,
      values: {
        "意图": config.desiredIntent,
        "第一次判断": "继续",
        "难度": difficulty,
        "第二次判断": "不推荐",
        "变现渠道": "其他",
        "第三次判断": "不推荐",
        "建议": recommendation,
        "判断依据": rationale,
        "评级": rating,
        [AGENT_STATUS_COLUMN]: "完成"
      },
      modelRationale: String(decision.rationale || "").trim(),
      warnings
    };
  }

  if (excluded) {
    const rationale = correctedRationale({
      value: decision.rationale,
      fallback: DEFAULT_EXCLUDED_RATIONALE,
      minLength: 8,
      maxLength: 80,
      warnings
    });
    return {
      rowNumber: outputRowNumber,
      values: {
        "意图": "其他",
        "第一次判断": "排除",
        "判断依据": rationale,
        [AGENT_STATUS_COLUMN]: "排除"
      },
      modelRationale: String(decision.rationale || "").trim(),
      warnings
    };
  }
  if (directReason) {
    warning(warnings, "直接排除", "直接排除项被误判继续，已排除", decision.rationale, directReason);
    return {
      rowNumber: outputRowNumber,
      values: {
        "意图": "其他",
        "第一次判断": "排除",
        "判断依据": directReason,
        [AGENT_STATUS_COLUMN]: "排除"
      },
      modelRationale: String(decision.rationale || "").trim(),
      warnings
    };
  }

  intent = correctedValue({
    field: "意图",
    value: intent,
    fallback: config.desiredIntent,
    isValid: (value) => value === config.desiredIntent,
    warnings,
    reason: "继续行意图必须等于客户目标意图"
  });

  let difficulty = normalizedDifficulty(decision.difficulty, warnings);
  let secondJudgement = correctedValue({
    field: "第二次判断",
    value: decision.secondJudgement,
    fallback: "不推荐",
    isValid: (value) => VALID_JUDGEMENTS.includes(value),
    warnings,
    reason: "第二次判断不合法，已兜底"
  });
  let monetization = correctedValue({
    field: "变现渠道",
    value: normalizeMonetization(decision.monetization),
    fallback: "其他",
    isValid: (value) => VALID_MONETIZATION_CHANNELS.includes(value),
    warnings,
    reason: "变现渠道不合法，已兜底"
  });
  const llmThirdJudgement = VALID_JUDGEMENTS.includes(decision.thirdJudgement)
    ? decision.thirdJudgement
    : "不推荐";
  let channelAllowed =
    config.allowedMonetizationChannels.length === 0 ||
    config.allowedMonetizationChannels.includes(monetization);
  let thirdJudgement = channelAllowed ? llmThirdJudgement : "不推荐";
  if (!VALID_JUDGEMENTS.includes(decision.thirdJudgement)) {
    warning(warnings, "第三次判断", "第三次判断不合法，已兜底", decision.thirdJudgement, thirdJudgement);
  } else if (decision.thirdJudgement !== thirdJudgement) {
    warning(warnings, "第三次判断", "变现渠道不在客户允许范围，已重算为不推荐", decision.thirdJudgement, thirdJudgement);
  }

  let rationale = correctedRationale({
    value: decision.rationale,
    fallback: DEFAULT_CONTINUE_RATIONALE,
    maxLength: 80,
    warnings
  });
  let recommendation = correctedRecommendation(decision.recommendation, warnings);

  if (softExclusion) {
    const before = { difficulty, secondJudgement, monetization, thirdJudgement, rationale };
    secondJudgement = "不推荐";
    monetization = "其他";
    thirdJudgement = "不推荐";
    rationale = appendLimited(
      rationale,
      difficulty.startsWith("轻")
        ? "法律税务或金融投资软排除项，轻难度固定评级C"
        : "法律税务或金融投资软排除项，中重难度排除",
      80
    );
    warning(
      warnings,
      "排除项评级",
      difficulty.startsWith("轻") ? "轻难度软排除项固定评级C" : "中/重难度软排除项已排除",
      JSON.stringify(before),
      JSON.stringify({ difficulty, secondJudgement, monetization, thirdJudgement, rationale })
    );
  }

  const financialEducation = isFinancialEducationCalculator(keyword);
  if (financialEducation) {
    if (isCdCalculator(keyword)) {
      const before = `${recommendation} | ${rationale}`;
      recommendation = recommendation.replace(/信用额度/g, "Certificate of Deposit定存");
      rationale = rationale.replace(/信用额度/g, "Certificate of Deposit定存");
      if (!/Certificate of Deposit|金融教育|YMYL|免责声明|财务建议/.test(`${recommendation} ${rationale}`)) {
        rationale = appendLimited(rationale, "Certificate of Deposit金融教育估算，仅供参考", 80);
      }
      if (before !== `${recommendation} | ${rationale}`) {
        warning(warnings, "金融教育风险", "cd calculator 已按 Certificate of Deposit 解释", before, `${recommendation} | ${rationale}`);
      }
    }
    const ensured = ensureRiskText({
      recommendation,
      rationale,
      pattern: FINANCIAL_RISK_PATTERN,
      recommendationAddition: isPaycheckCalculator(keyword) ? "工资/税务估算需免责声明" : "金融教育估算需免责声明",
      rationaleAddition: isPaycheckCalculator(keyword)
        ? "工资/税务估算仅供参考，避免财务/税务建议"
        : "金融教育估算/YMYL，仅供参考，避免财务建议",
      field: "金融教育风险",
      reason: "金融/工资教育估算器缺少免责声明，已补充",
      warnings
    });
    recommendation = ensured.recommendation;
    rationale = ensured.rationale;
  }

  if (healthEducation) {
    const ensured = ensureRiskText({
      recommendation,
      rationale,
      pattern: HEALTH_RISK_PATTERN,
      recommendationAddition: "健康教育估算需免责声明",
      rationaleAddition: "健康教育估算/YMYL，仅作教育用途，避免医疗建议",
      field: "健康教育风险",
      reason: "健康教育估算器缺少免责声明，已补充",
      warnings
    });
    recommendation = ensured.recommendation;
    rationale = ensured.rationale;
  }

  const heavyRisk = detectHeavyOrDataCapabilityRisk(keyword);
  if (heavyRisk.matched && heavyRisk.kind !== "content") {
    const before = {
      difficulty,
      secondJudgement,
      thirdJudgement,
      rationale
    };
    difficulty = heavyRisk.kind === "data"
      ? "中：需验证API/数据来源和编码校验"
      : "重：依赖AI/第三方/版权/成本能力";
    secondJudgement = "不推荐";
    rationale = appendLimited(rationale, heavyRisk.rationale, 80);
    warning(
      warnings,
      "能力风险",
      "AI/视频/地图/UPC类不能轻易评为A，已降级",
      JSON.stringify(before),
      JSON.stringify({ difficulty, secondJudgement, thirdJudgement, rationale })
    );
  }

  if (hasExplicitBrandSignal(keyword)) {
    const ensured = ensureRiskText({
      recommendation,
      rationale,
      pattern: BRAND_RISK_PATTERN,
      recommendationAddition: "注意品牌/商标风险",
      rationaleAddition: "关键词含品牌信号，需避免商标误导",
      field: "品牌风险",
      reason: "品牌关键词缺少品牌/商标风险，已补充",
      warnings
    });
    recommendation = ensured.recommendation;
    rationale = ensured.rationale;
  } else if (containsBrandRiskText(recommendation) || containsBrandRiskText(rationale)) {
    const beforeRecommendation = recommendation;
    const beforeRationale = rationale;
    recommendation = cleanupGenericBrandRiskText(recommendation, "可做轻量工具页，避免夸大功能");
    rationale = cleanupGenericBrandRiskText(rationale, "真实工具意图明确，技术轻");
    warning(
      warnings,
      "品牌风险",
      "非品牌关键词误含品牌/商标风险，已清理",
      `${beforeRecommendation} | ${beforeRationale}`,
      `${recommendation} | ${rationale}`
    );
  }

  const rating = computeRating(difficulty, {
    keyword,
    recommendation,
    rationale,
    monetization,
    difficulty,
    softExclusion
  });
  if (rating === "排除") {
    const excludedRationale = appendLimited(
      rationale,
      softExclusion ? "排除项中重难度或品牌/版权风险叠加，降级排除" : "品牌/版权风险叠加重难度，降级排除",
      80
    );
    warning(
      warnings,
      "评级",
      softExclusion ? "软排除项中重难度或叠加品牌/版权风险，已排除" : "重难度且涉及品牌/版权风险，已从C降级为排除",
      decision.rating,
      "排除"
    );
    return {
      rowNumber: outputRowNumber,
      values: {
        "意图": "其他",
        "第一次判断": "排除",
        "判断依据": excludedRationale,
        [AGENT_STATUS_COLUMN]: "排除"
      },
      modelRationale: String(decision.rationale || "").trim(),
      warnings
    };
  }
  if (!VALID_RATINGS.includes(decision.rating) || decision.rating !== rating) {
    warning(warnings, "评级", "评级必须由难度并结合品牌/版权风险重算", decision.rating, rating);
  }

  return {
    rowNumber: outputRowNumber,
    values: {
      "意图": intent,
      "第一次判断": "继续",
      "难度": difficulty,
      "第二次判断": secondJudgement,
      "变现渠道": monetization,
      "第三次判断": thirdJudgement,
      "建议": recommendation,
      "判断依据": rationale,
      "评级": rating,
      [AGENT_STATUS_COLUMN]: "完成"
    },
    modelRationale: String(decision.rationale || "").trim(),
    warnings
  };
}

export function normalizeDecision(decision) {
  return validateLLMOutput(
    { rowNumber: decision?.rowNumber || 0 },
    decision,
    {
      desiredIntent: String(decision?.intent || "").trim() === "其他"
        ? "工具站"
        : String(decision?.intent || "工具站").trim(),
      allowedMonetizationChannels: VALID_MONETIZATION_CHANNELS
    }
  );
}

function extractJsonContent(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`OpenAI response missing message content: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return content;
}

export async function evaluateKeywordRowsWithOpenAI(items, {
  apiKey = process.env.OPENAI_API_KEY || "",
  model = process.env.OPENAI_MODEL || DEFAULT_MODEL
} = {}) {
  if (items.length === 0) {
    return [];
  }
  if (!apiKey) {
    throw new Error("缺少 OPENAI_API_KEY。要用大模型 agent，请先设置 OPENAI_API_KEY，或用 --mode=rules 跑规则兜底。");
  }

  const payload = buildPromptPayload(items);
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: KEYWORD_AGENT_SYSTEM_PROMPT
        },
        {
          role: "user",
          content: JSON.stringify(payload)
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: OUTPUT_SCHEMA
      }
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`OpenAI API failed: HTTP ${response.status} ${data?.error?.message || response.statusText}`);
  }

  const parsed = JSON.parse(extractJsonContent(data));
  const decisions = Array.isArray(parsed.decisions) ? parsed.decisions : [];
  const byRow = new Map(decisions.map((decision) => [Number(decision.rowNumber), decision]));
  return items.map((item) => {
    const decision = byRow.get(Number(item.rowNumber));
    if (!decision) {
      throw new Error(`OpenAI response missing decision for row ${item.rowNumber}`);
    }
    return validateLLMOutput(item, decision, customerConfigFromRule(item.rule));
  });
}
