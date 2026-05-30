#!/usr/bin/env node
import { readArg, readFlag } from "./lib/args.mjs";
import {
  foregroundHubstudioBrowser,
  listHubstudioEnvironments,
  readHubstudioConfig,
  startHubstudioBrowser
} from "./lib/hubstudio-api.mjs";

async function main() {
  const configPath = readArg("config", "secrets/hubstudio/config.json");
  const containerCode = readArg("container-code", "");
  const start = readFlag("start");
  const foreground = readFlag("foreground");
  const headless = readFlag("headless");
  const config = readHubstudioConfig(configPath);

  const envs = await listHubstudioEnvironments({ config });
  console.log(JSON.stringify({
    ok: true,
    step: "env_list",
    baseUrl: config.baseUrl,
    total: envs.total,
    environments: envs.environments.slice(0, 20).map((env) => ({
      containerCode: env.containerCode,
      containerName: env.containerName,
      tagName: env.tagName,
      proxyTypeName: env.proxyTypeName,
      lastCountry: env.lastCountry,
      lastUsedIp: env.lastUsedIp,
      openTime: env.openTime
    }))
  }, null, 2));

  if (containerCode && start) {
    const started = await startHubstudioBrowser({
      config,
      containerCode,
      isHeadless: headless
    });
    console.log(JSON.stringify({
      ok: true,
      step: "browser_start",
      containerCode,
      debuggingPort: started.debuggingPort,
      downloadPath: started.browser.downloadPath,
      ip: started.browser.ip,
      proxyType: started.browser.proxyType,
      webdriver: started.browser.webdriver
    }, null, 2));
  }

  if (containerCode && foreground) {
    const result = await foregroundHubstudioBrowser({ config, containerCode });
    console.log(JSON.stringify({
      ok: true,
      step: "browser_foreground",
      containerCode,
      data: result.data
    }, null, 2));
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error.message || String(error),
    status: error.status,
    code: error.code,
    data: error.data
  }, null, 2));
  process.exitCode = 1;
});
