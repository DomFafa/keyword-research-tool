import { evaluate, navigateAndWait } from "./cdp.mjs";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForCondition(cdp, sessionId, expression, timeoutMs = 30000) {
  const startedAt = Date.now();
  let lastValue;

  while (Date.now() - startedAt < timeoutMs) {
    lastValue = await evaluate(cdp, sessionId, expression).catch((error) => ({
      __error: error.message
    }));
    if (lastValue === true || (lastValue && lastValue.ok)) {
      return lastValue;
    }
    await sleep(500);
  }

  throw new Error(`Timed out waiting for condition: ${expression}. Last value: ${JSON.stringify(lastValue)}`);
}

export async function setInputValue(cdp, sessionId, selector, value) {
  return evaluate(
    cdp,
    sessionId,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { ok: false, reason: "selector not found", selector: ${JSON.stringify(selector)} };
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, "value")?.set;
      if (setter) {
        setter.call(el, ${JSON.stringify(value)});
      } else {
        el.value = ${JSON.stringify(value)};
      }
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: ${JSON.stringify(value)} }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, value: el.value };
    })()`
  );
}

export async function clickSelector(cdp, sessionId, selector) {
  const result = await evaluate(
    cdp,
    sessionId,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { ok: false, reason: "selector not found", selector: ${JSON.stringify(selector)} };
      el.scrollIntoView({ block: "center", inline: "center" });
      el.click();
      return { ok: true };
    })()`
  );
  if (!result.ok) {
    throw new Error(result.reason || `Unable to click ${selector}`);
  }
  return result;
}

export async function clickByText(cdp, sessionId, options) {
  const { selector = "button, a", text, includes = false, userGesture = false, inputClick = false } = options;
  if (inputClick) {
    return clickByTextWithInput(cdp, sessionId, { selector, text, includes });
  }

  const expression = `(() => {
      const clean = (value) => (value || "").replace(/\\s+/g, " ").trim();
      const expected = ${JSON.stringify(text)};
      const items = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const el = items.find((item) => {
        const actual = clean(item.innerText || item.textContent);
        return ${JSON.stringify(includes)} ? actual.includes(expected) : actual === expected;
      });
      if (!el) return { ok: false, reason: "text not found", text: expected };
      el.scrollIntoView({ block: "center", inline: "center" });
      el.click();
      return { ok: true, text: clean(el.innerText || el.textContent) };
    })()`;
  const result = userGesture
    ? await evaluateWithUserGesture(cdp, sessionId, expression)
    : await evaluate(cdp, sessionId, expression);
  if (!result.ok) {
    throw new Error(result.reason || `Unable to click text ${text}`);
  }
  return result;
}

async function evaluateWithUserGesture(cdp, sessionId, expression, timeoutMs = 30000) {
  const result = await cdp.send(
    "Runtime.evaluate",
    {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
      timeout: timeoutMs
    },
    sessionId
  );

  if (result.exceptionDetails) {
    const message =
      result.exceptionDetails.exception?.description ||
      result.exceptionDetails.text ||
      "Evaluation failed";
    throw new Error(message);
  }

  return result.result?.value;
}

async function clickByTextWithInput(cdp, sessionId, { selector, text, includes }) {
  const result = await evaluate(
    cdp,
    sessionId,
    `(() => {
      const clean = (value) => (value || "").replace(/\\s+/g, " ").trim();
      const expected = ${JSON.stringify(text)};
      const items = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const el = items.find((item) => {
        const actual = clean(item.innerText || item.textContent);
        return ${JSON.stringify(includes)} ? actual.includes(expected) : actual === expected;
      });
      if (!el) return { ok: false, reason: "text not found", text: expected };
      el.scrollIntoView({ block: "center", inline: "center" });
      const rect = el.getBoundingClientRect();
      return {
        ok: true,
        text: clean(el.innerText || el.textContent),
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };
    })()`
  );
  if (!result.ok) {
    throw new Error(result.reason || `Unable to click text ${text}`);
  }

  await dispatchMouseEvent(cdp, sessionId, {
    type: "mouseMoved",
    x: result.x,
    y: result.y,
    button: "none"
  });
  await dispatchMouseEvent(cdp, sessionId, {
    type: "mousePressed",
    x: result.x,
    y: result.y,
    button: "left",
    clickCount: 1
  });
  await dispatchMouseEvent(cdp, sessionId, {
    type: "mouseReleased",
    x: result.x,
    y: result.y,
    button: "left",
    clickCount: 1
  });
  return result;
}

async function dispatchMouseEvent(cdp, sessionId, params) {
  try {
    await cdp.send("Input.dispatchMouseEvent", {
      ...params,
      timeout: 2000
    }, sessionId);
  } catch (error) {
    const message = error?.message || String(error);
    if (/Timed out waiting for CDP response: Input\.dispatchMouseEvent|Session with given id not found|No target with given id found/i.test(message)) {
      return;
    }
    throw error;
  }
}

export async function navigateIfNeeded(cdp, sessionId, url) {
  const currentUrl = await evaluate(cdp, sessionId, "location.href");
  if (currentUrl === url) {
    return;
  }
  await navigateAndWait(cdp, sessionId, url, 45000).catch(async () => {
    await sleep(3000);
  });
}
