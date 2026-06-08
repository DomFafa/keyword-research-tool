#!/usr/bin/env node
import {
  DASH_LOGIN_URL,
  launchSemrushContext,
  openSemrushLoginPage,
  semrushChromePath,
  semrushUserDataDir
} from "./lib/semrush-browser.mjs";

const context = await launchSemrushContext();
await openSemrushLoginPage(context);

console.log(`Chrome: ${semrushChromePath()}`);
console.log(`Semrush Chrome profile: ${semrushUserDataDir()}`);
console.log(`Opened: ${DASH_LOGIN_URL}`);
console.log("Log in once, then close this Chrome window or press Ctrl-C.");

const shutdown = async () => {
  await context.close().catch(() => {});
  process.exit(0);
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await new Promise((resolve) => context.once("close", resolve));
