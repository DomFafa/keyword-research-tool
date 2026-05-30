import fs from "node:fs";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const DEFAULT_CONFIG_PATH = "secrets/hubstudio/config.json";
const DEFAULT_BASE_URL = "http://127.0.0.1:6873";
const DEFAULT_FINGERPRINT_CACHE_PATH = "cache/hubstudio-fingerprints.json";
const DEFAULT_BROWSER_SESSION_CACHE_PATH = "cache/hubstudio-browser-sessions.json";
const DEFAULT_PROXY_API_KEY_ENV = "RUBYLINKTO_PROXY_API_KEY";
const DEFAULT_PROXY_API_URL_TEMPLATE = "https://rubylinkto.com/api/get_proxy.php?api_key={api_key}&region={region}";
const DEFAULT_PROXY_IP_CHECK_URL = "https://api.ipify.org?format=json";
const REGION_ALIASES = new Map([
  ["弗吉尼亚", "us-east-1"],
  ["弗吉尼亚州", "us-east-1"],
  ["virginia", "us-east-1"],
  ["us-east-1", "us-east-1"],
  ["俄亥俄", "us-east-2"],
  ["俄亥俄州", "us-east-2"],
  ["ohio", "us-east-2"],
  ["us-east-2", "us-east-2"],
  ["加利福尼亚", "us-west-1"],
  ["加利福尼亚州", "us-west-1"],
  ["california", "us-west-1"],
  ["us-west-1", "us-west-1"],
  ["俄勒冈", "us-west-2"],
  ["俄勒冈州", "us-west-2"],
  ["oregon", "us-west-2"],
  ["us-west-2", "us-west-2"]
]);
const execFileAsync = promisify(execFile);

function readJsonFileIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJsonFile(filePath, data) {
  fs.mkdirSync(filePath.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmpPath, filePath);
}

function normalizeHubstudioEnvironment(env) {
  if (!env) return null;
  const serialNumber = Number(env.serialNumber);
  const containerCode = env.containerCode ? String(env.containerCode) : "";
  if (!Number.isFinite(serialNumber) || serialNumber <= 0 || !containerCode) {
    return null;
  }
  return {
    ...env,
    serialNumber,
    containerCode,
    containerName: env.containerName || "",
    coreVersion: env.coreVersion ?? null
  };
}

export function readHubstudioConfig(configPath = DEFAULT_CONFIG_PATH) {
  const config = readJsonFileIfExists(configPath);
  const proxy = config.proxy || {};
  const apiKeyEnv = proxy.apiKeyEnv || DEFAULT_PROXY_API_KEY_ENV;
  return {
    baseUrl: process.env.HUBSTUDIO_BASE_URL || config.baseUrl || DEFAULT_BASE_URL,
    authorization: process.env.HUBSTUDIO_AUTHORIZATION || config.authorization || config.apiKey || "NULL",
    proxy: {
      enabled: proxy.enabled ?? true,
      apiKeyEnv,
      apiKey: process.env[apiKeyEnv] || process.env.HUBSTUDIO_PROXY_API_KEY || proxy.apiKey || "",
      apiUrlTemplate: proxy.apiUrlTemplate || DEFAULT_PROXY_API_URL_TEMPLATE,
      linkCode: process.env.HUBSTUDIO_PROXY_LINK_CODE || proxy.linkCode || "",
      proxyTypeName: proxy.proxyTypeName || "Socks5_通用api",
      ipGetRuleType: proxy.ipGetRuleType ?? 2,
      ipCheckUrl: proxy.ipCheckUrl || DEFAULT_PROXY_IP_CHECK_URL,
      ipCheckTimeoutMs: Number(proxy.ipCheckTimeoutMs || proxy.ipCheckTimeoutSeconds * 1000 || 12000),
      directGuardEnabled: proxy.directGuardEnabled ?? true,
      directGuardSwitchMaxAttempts: Number(proxy.directGuardSwitchMaxAttempts || 3),
      regions: Array.isArray(proxy.regions) && proxy.regions.length
        ? proxy.regions
        : ["us-west-2", "us-west-1", "us-east-2", "us-east-1"]
    }
  };
}

export function readHubstudioFingerprintCache(cachePath = DEFAULT_FINGERPRINT_CACHE_PATH) {
  const data = readJsonFileIfExists(cachePath);
  return data.fingerprints && typeof data.fingerprints === "object"
    ? data
    : { fingerprints: {}, updatedAt: 0 };
}

export function cacheHubstudioEnvironment(env, cachePath = DEFAULT_FINGERPRINT_CACHE_PATH) {
  const normalized = normalizeHubstudioEnvironment(env);
  if (!normalized) return false;
  const cache = readHubstudioFingerprintCache(cachePath);
  cache.fingerprints[String(normalized.serialNumber)] = {
    serialNumber: normalized.serialNumber,
    containerCode: normalized.containerCode,
    containerName: normalized.containerName,
    coreVersion: normalized.coreVersion
  };
  cache.updatedAt = Date.now();
  writeJsonFile(cachePath, cache);
  return true;
}

export function readCachedHubstudioEnvironment(serialNumber, cachePath = DEFAULT_FINGERPRINT_CACHE_PATH) {
  const targetSerial = Number(serialNumber);
  if (!Number.isFinite(targetSerial) || targetSerial <= 0) return null;
  const cache = readHubstudioFingerprintCache(cachePath);
  return normalizeHubstudioEnvironment(cache.fingerprints[String(targetSerial)]);
}

export function readHubstudioBrowserSessionCache(cachePath = DEFAULT_BROWSER_SESSION_CACHE_PATH) {
  const data = readJsonFileIfExists(cachePath);
  return data.sessions && typeof data.sessions === "object"
    ? data
    : { sessions: {}, updatedAt: 0 };
}

export function cacheHubstudioBrowserSession({
  serialNumber,
  containerCode,
  debuggingPort
}, cachePath = DEFAULT_BROWSER_SESSION_CACHE_PATH) {
  const port = Number(debuggingPort);
  const code = containerCode ? String(containerCode) : "";
  if (!code || !Number.isFinite(port) || port <= 0) return false;
  const cache = readHubstudioBrowserSessionCache(cachePath);
  cache.sessions[code] = {
    serialNumber: Number(serialNumber) || null,
    containerCode: code,
    debuggingPort: port,
    updatedAt: Date.now()
  };
  cache.updatedAt = Date.now();
  writeJsonFile(cachePath, cache);
  return true;
}

export function readCachedHubstudioBrowserSession(containerCode, cachePath = DEFAULT_BROWSER_SESSION_CACHE_PATH) {
  const code = containerCode ? String(containerCode) : "";
  if (!code) return null;
  const cache = readHubstudioBrowserSessionCache(cachePath);
  const session = cache.sessions[code];
  if (!session) return null;
  const port = Number(session.debuggingPort);
  return Number.isFinite(port) && port > 0 ? { ...session, debuggingPort: port } : null;
}

export function forgetHubstudioBrowserSession(containerCode, cachePath = DEFAULT_BROWSER_SESSION_CACHE_PATH) {
  const code = containerCode ? String(containerCode) : "";
  if (!code) return false;
  const cache = readHubstudioBrowserSessionCache(cachePath);
  if (!cache.sessions[code]) return false;
  delete cache.sessions[code];
  cache.updatedAt = Date.now();
  writeJsonFile(cachePath, cache);
  return true;
}

async function fetchHubstudioJson(url, options, timeoutMs = 30000) {
  const curlTimeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  const args = [
    "-sS",
    "--max-time",
    String(curlTimeoutSeconds),
    "-X",
    options.method || "POST",
    url
  ];
  for (const [key, value] of Object.entries(options.headers || {})) {
    args.push("-H", `${key}: ${value}`);
  }
  if (options.body !== undefined) {
    args.push("--data", options.body);
  }
  args.push("-w", "\n%{http_code}");

  let stdout = "";
  try {
    ({ stdout } = await execFileAsync("curl", args, {
      encoding: "utf8",
      timeout: timeoutMs + 2000,
      maxBuffer: 10 * 1024 * 1024
    }));
  } catch (error) {
    if (error?.killed || /timed out|Operation timed out|Timeout/i.test(error?.message || "")) {
      throw new Error(`Hubstudio Local API 超时 ${timeoutMs}ms: ${url}`);
    }
    const detail = error.stderr || error.message || String(error);
    throw new Error(`Hubstudio Local API 连接失败，请确认客户端 API 已启动: ${detail}`);
  }

  const separator = stdout.lastIndexOf("\n");
  const text = separator >= 0 ? stdout.slice(0, separator) : stdout;
  const status = separator >= 0 ? Number(stdout.slice(separator + 1).trim()) : 0;
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (status < 200 || status >= 300 || (Number.isFinite(Number(data.code)) && Number(data.code) !== 0)) {
    const error = new Error(data.msg || data.message || `HTTP ${status}` || "hubstudio_api_error");
    error.status = status;
    error.code = data.code;
    error.data = data;
    throw error;
  }
  return data;
}

export async function hubstudioApiFetch({
  config = readHubstudioConfig(),
  path,
  method = "POST",
  body = {},
  timeoutMs = 30000
}) {
  return fetchHubstudioJson(`${config.baseUrl}${path}`, {
    method,
    headers: {
      "accept-language": "zh-CN",
      authorization: config.authorization || "NULL",
      "content-type": "application/json"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  }, timeoutMs);
}

export async function listHubstudioEnvironments({ config = readHubstudioConfig(), body = {} } = {}) {
  const data = await hubstudioApiFetch({ config, path: "/api/v1/env/list", body });
  return {
    raw: data,
    environments: data.data?.list || [],
    total: Number(data.data?.total ?? data.data?.list?.length ?? 0)
  };
}

export async function waitForHubstudioDebuggerEndpoint({
  debuggingPort,
  timeoutMs = 30000,
  intervalMs = 1000,
  readEndpoint
}) {
  const port = Number(debuggingPort);
  if (!Number.isFinite(port) || port <= 0) return "";
  const reader = readEndpoint || ((targetPort) => {
    try {
      const output = execFileSync("curl", [
        "-fsS",
        `http://127.0.0.1:${targetPort}/json/version`
      ], {
        encoding: "utf8",
        timeout: 2000,
        stdio: ["ignore", "pipe", "ignore"]
      });
      return JSON.parse(output).webSocketDebuggerUrl || "";
    } catch {
      return "";
    }
  });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const endpoint = reader(port);
    if (endpoint) return endpoint;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return "";
}

export async function findHubstudioEnvironmentByExactName({
  config = readHubstudioConfig(),
  containerName
}) {
  const name = String(containerName || "").trim();
  if (!name) {
    throw new Error("缺少 Hubstudio 指纹名称");
  }
  const result = await listHubstudioEnvironments({
    config,
    body: { containerName: name }
  });
  const exact = result.environments.filter((env) => String(env.containerName || "").trim() === name);
  if (exact.length !== 1) {
    const preview = result.environments.slice(0, 10).map((env) => env.containerName).join(", ");
    throw new Error(
      `Hubstudio 指纹名称 ${name} ${exact.length === 0 ? "没有精确匹配" : "匹配不唯一"}。` +
        `接口返回 total=${result.total}，前几个名称: ${preview}`
    );
  }
  return exact[0];
}

export async function findHubstudioEnvironmentBySerialNumber({
  config = readHubstudioConfig(),
  serialNumber,
  pageSize = 100,
  cachePath = DEFAULT_FINGERPRINT_CACHE_PATH,
  useCache = true,
  emptyListRetries = 3
}) {
  const targetSerial = Number(serialNumber);
  if (!Number.isFinite(targetSerial) || targetSerial <= 0) {
    throw new Error(`缺少有效的 Hubstudio 序号: ${serialNumber || ""}`);
  }

  if (useCache) {
    const cached = readCachedHubstudioEnvironment(targetSerial, cachePath);
    if (cached) {
      return cached;
    }
  }

  const readPage = async (page) => {
    let lastResult = null;
    for (let attempt = 1; attempt <= emptyListRetries; attempt += 1) {
      const result = await listHubstudioEnvironments({
        config,
        body: { current: page, size: pageSize }
      });
      if (result.total > 0 || result.environments.length > 0 || attempt >= emptyListRetries) {
        for (const env of result.environments) {
          cacheHubstudioEnvironment(env, cachePath);
        }
        return result;
      }
      lastResult = result;
      await new Promise((resolve) => setTimeout(resolve, attempt * 3000));
    }
    return lastResult || { environments: [], total: 0 };
  };

  const firstPage = await readPage(1);
  const firstExact = firstPage.environments.find(
    (env) => Number(env.serialNumber) === targetSerial
  );
  if (firstExact) {
    cacheHubstudioEnvironment(firstExact, cachePath);
    return firstExact;
  }

  const cachedAfterFirstPage = readCachedHubstudioEnvironment(targetSerial, cachePath);
  if (cachedAfterFirstPage) {
    return cachedAfterFirstPage;
  }

  if (firstPage.total === 0 && firstPage.environments.length === 0) {
    throw new Error(`Hubstudio 序号 ${targetSerial} 没有找到。接口返回 total=0，前几个环境: `);
  }

  const firstSerial = Number(firstPage.environments[0]?.serialNumber);
  let estimatedPage = 0;
  if (Number.isFinite(firstSerial) && firstSerial >= targetSerial) {
    estimatedPage = Math.floor((firstSerial - targetSerial) / pageSize) + 1;
  } else if (firstPage.total > 0) {
    estimatedPage = Math.ceil(firstPage.total / pageSize);
  }

  const candidatePages = [
    firstPage.total > 0 ? Math.ceil(firstPage.total / pageSize) - Math.floor((targetSerial - 1) / pageSize) : 0,
    estimatedPage - 2,
    estimatedPage - 1,
    estimatedPage,
    estimatedPage + 1,
    estimatedPage + 2
  ].filter((page) => page > 1);
  const seenPages = new Set();
  for (const page of candidatePages) {
    if (seenPages.has(page)) continue;
    seenPages.add(page);
    const result = await readPage(page);
    const exact = result.environments.find(
      (env) => Number(env.serialNumber) === targetSerial
    );
    if (exact) {
      cacheHubstudioEnvironment(exact, cachePath);
      return exact;
    }
  }

  const cachedAfterCandidatePages = readCachedHubstudioEnvironment(targetSerial, cachePath);
  if (cachedAfterCandidatePages) {
    return cachedAfterCandidatePages;
  }

  const totalPages = Math.ceil((firstPage.total || 0) / pageSize);
  for (let page = 2; page <= totalPages; page += 1) {
    if (seenPages.has(page)) continue;
    const result = await readPage(page);
    const exact = result.environments.find(
      (env) => Number(env.serialNumber) === targetSerial
    );
    if (exact) {
      cacheHubstudioEnvironment(exact, cachePath);
      return exact;
    }
  }

  const preview = firstPage.environments
    .slice(0, 10)
    .map((env) => `${env.serialNumber}:${env.containerName}`)
    .join(", ");
  throw new Error(
    `Hubstudio 序号 ${targetSerial} 没有找到。接口返回 total=${firstPage.total}，前几个环境: ${preview}`
  );
}

export async function findHubstudioEnvironmentBySerialNumberWithoutCache({
  config = readHubstudioConfig(),
  serialNumber,
  pageSize = 100
}) {
  return findHubstudioEnvironmentBySerialNumber({
    config,
    serialNumber,
    pageSize,
    useCache: false
  });
}

export function isHubstudioStartPendingMessage(message) {
  return /startBrowser.*未执行结束|has not yet finished executing/i.test(String(message || ""));
}

export function resolveHubstudioProxyRegion(rawRegion, fallbackRegion = "us-east-1") {
  const raw = String(rawRegion || "").trim().toLowerCase();
  if (raw) {
    for (const [alias, region] of REGION_ALIASES.entries()) {
      if (raw.includes(alias.toLowerCase())) {
        return region;
      }
    }
  }
  return fallbackRegion || "us-east-1";
}

function replaceProxyTemplate(template, { apiKey, region }) {
  return String(template || DEFAULT_PROXY_API_URL_TEMPLATE)
    .replaceAll("{api_key}", encodeURIComponent(apiKey))
    .replaceAll("{apiKey}", encodeURIComponent(apiKey))
    .replaceAll("{region}", encodeURIComponent(region));
}

export function hasHubstudioApiProxyConfig(config = readHubstudioConfig()) {
  const proxy = config.proxy || {};
  return Boolean(proxy.enabled && (proxy.linkCode || proxy.apiKey));
}

export function buildHubstudioApiProxyPayload({
  config = readHubstudioConfig(),
  containerCode,
  containerName,
  region = "us-east-1",
  linkCode
}) {
  const code = containerCode ? String(containerCode) : "";
  if (!code) {
    throw new Error("缺少 Hubstudio containerCode");
  }
  const proxy = config.proxy || {};
  const selectedRegion = String(region || "us-east-1").trim() || "us-east-1";
  const resolvedLinkCode = linkCode || proxy.linkCode || (
    proxy.apiKey
      ? replaceProxyTemplate(proxy.apiUrlTemplate, { apiKey: proxy.apiKey, region: selectedRegion })
      : ""
  );
  if (!resolvedLinkCode) {
    const keyName = proxy.apiKeyEnv || DEFAULT_PROXY_API_KEY_ENV;
    throw new Error(`缺少 Hubstudio API 提取代理配置，请设置 ${keyName} 或 secrets/hubstudio/config.json 的 proxy.apiKey/linkCode`);
  }
  return {
    containerCode: code,
    containerName: containerName || `[auto]${code}`,
    asDynamicType: 2,
    proxyTypeName: proxy.proxyTypeName || "Socks5_通用api",
    ipGetRuleType: Number(proxy.ipGetRuleType ?? 2),
    linkCode: resolvedLinkCode,
    remark: `auto-updated-to-api-proxy; region=${selectedRegion}`
  };
}

export function extractIpAddress(text) {
  const value = String(text || "").trim();
  if (!value) return "";
  try {
    const data = JSON.parse(value);
    if (data && typeof data === "object") {
      for (const key of ["ip", "query", "origin"]) {
        if (typeof data[key] === "string") {
          const found = extractIpAddress(data[key]);
          if (found) return found;
        }
      }
    }
  } catch {
    // Fall through to regex scanning.
  }
  const match = value.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b|[0-9a-f:]{3,}/i);
  return match ? match[0].replace(/^[\[\]()]+|[\[\](),;]+$/g, "") : "";
}

export function isPrivateOrLocalIp(ip) {
  const value = String(ip || "").trim();
  const ipv4 = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const [a, b] = ipv4.slice(1, 3).map(Number);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

export async function readPublicIp({
  ipCheckUrl = DEFAULT_PROXY_IP_CHECK_URL,
  timeoutMs = 12000,
  fetchText
} = {}) {
  const reader = fetchText || (async (url, timeout) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { signal: controller.signal });
      return await response.text();
    } finally {
      clearTimeout(timer);
    }
  });
  const text = await reader(ipCheckUrl, timeoutMs);
  const ip = extractIpAddress(text);
  return ip && !isPrivateOrLocalIp(ip) ? ip : "";
}

export function evaluateHubstudioProxyDirectGuard({ hostIp, browserIp }) {
  if (!hostIp) {
    return { ok: false, shouldSwitch: false, message: "代理异常：无法检测本机出口 IP，不能确认 HubStudio 不是本地直连" };
  }
  if (!browserIp) {
    return { ok: false, shouldSwitch: false, message: "代理异常：HubStudio 出口 IP 检测失败" };
  }
  if (isPrivateOrLocalIp(browserIp)) {
    return { ok: false, shouldSwitch: false, message: `代理异常：HubStudio 出口不是公网 IP (${browserIp})` };
  }
  if (browserIp === hostIp) {
    return { ok: false, shouldSwitch: true, message: `代理异常：疑似本地直连，HubStudio 出口 IP 与本机一致 (${browserIp})` };
  }
  return { ok: true, shouldSwitch: false, message: `HubStudio 出口 IP 检测通过: ${browserIp} (本机: ${hostIp})` };
}

export async function updateHubstudioApiProxy({
  config = readHubstudioConfig(),
  containerCode,
  containerName,
  region = "us-east-1",
  linkCode,
  timeoutMs = 30000
}) {
  const body = buildHubstudioApiProxyPayload({
    config,
    containerCode,
    containerName,
    region,
    linkCode
  });
  return hubstudioApiFetch({
    config,
    path: "/api/v1/env/proxy/update",
    body,
    timeoutMs
  });
}

export async function startHubstudioBrowser({
  config = readHubstudioConfig(),
  containerCode,
  isHeadless = false,
  args,
  timeoutMs = 30000
}) {
  if (!containerCode) {
    throw new Error("缺少 Hubstudio containerCode");
  }
  const body = {
    containerCode: String(containerCode),
    isHeadless: Boolean(isHeadless)
  };
  if (args?.length) {
    body.args = args;
  }
  const data = await hubstudioApiFetch({ config, path: "/api/v1/browser/start", body, timeoutMs });
  return {
    raw: data,
    browser: data.data || {},
    debuggingPort: data.data?.debuggingPort ? Number(data.data.debuggingPort) : null
  };
}

export async function stopHubstudioBrowser({
  config = readHubstudioConfig(),
  containerCode,
  timeoutMs = 10000
}) {
  if (!containerCode) {
    throw new Error("缺少 Hubstudio containerCode");
  }
  return hubstudioApiFetch({
    config,
    path: "/api/v1/browser/stop",
    body: { containerCode: String(containerCode) },
    timeoutMs
  });
}

export async function foregroundHubstudioBrowser({
  config = readHubstudioConfig(),
  containerCode
}) {
  if (!containerCode) {
    throw new Error("缺少 Hubstudio containerCode");
  }
  return hubstudioApiFetch({
    config,
    path: "/api/v1/browser/foreground",
    body: { containerCode: String(containerCode) }
  });
}
