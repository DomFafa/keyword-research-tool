#!/usr/bin/env node
import {
  buildChromeLaunchArgs,
  ensureChromeWebSocketEndpoint,
  resolveChromeProfileDirectory
} from "./lib/cdp.mjs";

const SEMRUSH_START_URL = "https://dash.3ue.com/zh-Hans/#/login";

const profileDirectory = resolveChromeProfileDirectory();
const endpoint = await ensureChromeWebSocketEndpoint({ initialUrl: SEMRUSH_START_URL });
const args = buildChromeLaunchArgs({ profile: profileDirectory, initialUrl: SEMRUSH_START_URL });

console.log(`Chrome profile: ${profileDirectory}`);
console.log(`Chrome endpoint: ${endpoint}`);
console.log(`Chrome command: ${args.map((arg) => JSON.stringify(arg)).join(" ")}`);
