#!/usr/bin/env node
import { readArg, readFlag } from "./lib/args.mjs";
import {
  CdpClient,
  createChromePage,
  detachChromePage,
  navigateAndWait,
  readDebuggerEndpointFromPort
} from "./lib/cdp.mjs";
import { readHubstudioConfig, startHubstudioBrowser } from "./lib/hubstudio-api.mjs";

async function main() {
  const configPath = readArg("config", "secrets/hubstudio/config.json");
  const containerCode = readArg("container-code", "");
  const url = readArg("url", "about:blank");
  const headless = readFlag("headless");
  const config = readHubstudioConfig(configPath);
  const started = await startHubstudioBrowser({
    config,
    containerCode,
    isHeadless: headless
  });
  const endpoint = readDebuggerEndpointFromPort(started.debuggingPort);
  if (!endpoint) {
    throw new Error(`Hubstudio 浏览器已启动，但无法读取 CDP endpoint: ${started.debuggingPort}`);
  }

  const cdp = new CdpClient(endpoint);
  await cdp.connect();
  let page;
  try {
    page = await createChromePage(cdp, "about:blank");
    if (url && url !== "about:blank") {
      await navigateAndWait(cdp, page.sessionId, url, 45000).catch(() => {});
    }
    console.log(JSON.stringify({
      ok: true,
      containerCode,
      debuggingPort: started.debuggingPort,
      webSocketDebuggerUrl: endpoint,
      targetId: page.targetId,
      url
    }, null, 2));
  } finally {
    if (page?.sessionId) {
      await detachChromePage(cdp, page.sessionId).catch(() => {});
    }
    cdp.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error.message || String(error)
  }, null, 2));
  process.exitCode = 1;
});
