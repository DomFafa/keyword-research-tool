import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const DEFAULT_CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEFAULT_USER_DATA_DIR = path.join(
  os.homedir(),
  "Library/Application Support/keyword-research-tool/semrush-chrome"
);

export const DASH_LOGIN_URL = "https://dash.3ue.com/zh-Hans/#/login";

export function semrushChromePath() {
  return process.env.SEMRUSH_CHROME_PATH || process.env.CHROME_PATH || DEFAULT_CHROME_PATH;
}

export function semrushUserDataDir() {
  return process.env.SEMRUSH_CHROME_USER_DATA_DIR || DEFAULT_USER_DATA_DIR;
}

export function buildSemrushLaunchOptions({
  chromePath = semrushChromePath(),
  headless = false
} = {}) {
  return {
    executablePath: chromePath,
    headless,
    viewport: null,
    acceptDownloads: true,
    args: [
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-save-password-bubble",
      "--disable-password-generation",
      "--password-store=basic",
      "--disable-features=PasswordManagerOnboarding,PasswordLeakDetection,PasswordCheck,AutofillServerCommunication"
    ]
  };
}

export async function launchSemrushContext(options = {}) {
  return chromium.launchPersistentContext(
    options.userDataDir || semrushUserDataDir(),
    buildSemrushLaunchOptions(options)
  );
}

export async function openSemrushLoginPage(context) {
  const existing = context.pages().find((page) => !page.isClosed());
  const page = existing || await context.newPage();
  await page.goto(DASH_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  await page.bringToFront().catch(() => {});
  return page;
}
