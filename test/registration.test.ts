import { describe, expect, it } from "vitest";
import { Logger } from "../src/log/logger";
import { classifyRegistrationError, normaliseScope, registerWorker } from "../src/worker/registration";
import { FakeContainer, fakeRegistration, SITE } from "./helpers/fake_platform";

const PAGE = `${SITE}/play/level-1?x=1`;
const log = () => new Logger(undefined, () => 0, "none");

describe("scope normalisation", () => {
  it("makes absolute URLs ending in /", () => {
    expect(normaliseScope("/", PAGE)).toBe(`${SITE}/`);
    expect(normaliseScope("/openpush", PAGE)).toBe(`${SITE}/openpush/`);
    expect(normaliseScope("/openpush/", PAGE)).toBe(`${SITE}/openpush/`);
    expect(normaliseScope("openpush/", `${SITE}/`)).toBe(`${SITE}/openpush/`);
    expect(normaliseScope(`${SITE}/openpush`, PAGE)).toBe(`${SITE}/openpush/`);
  });
});

describe("registerWorker", () => {
  it("registers /openpush/ beside a root PWA worker", async () => {
    const container = new FakeContainer();
    container.registrations = [fakeRegistration(`${SITE}/`, `${SITE}/pwa-sw.js`)];
    const result = await registerWorker(container, PAGE, "/openpush/openpush-sw.js", "/openpush/", log());
    expect(result.state).toBe("ok");
    expect(container.register).toHaveBeenCalledWith(`${SITE}/openpush/openpush-sw.js`, { scope: `${SITE}/openpush/` });
    expect(container.getRegistration).not.toHaveBeenCalled();
  });

  it("reports worker_scope_taken for an exact scope match with another script", async () => {
    const container = new FakeContainer();
    container.registrations = [fakeRegistration(`${SITE}/`, `${SITE}/pwa-sw.js`)];
    const lines: string[] = [];
    const logger = new Logger(undefined, () => 0, "error");
    logger.addListener((e) => lines.push(e.message));
    const result = await registerWorker(container, PAGE, "/openpush-sw.js", "/", logger);
    expect(result.state).toBe("taken");
    if (result.state === "ok") throw new Error("unreachable");
    expect(result.error.code).toBe("worker_scope_taken");
    expect(result.error.detail).toMatchObject({ existing: "/pwa-sw.js", configured: "/openpush-sw.js", scope: "/" });
    expect(container.register).not.toHaveBeenCalled();
    expect(lines[0]).toContain("/pwa-sw.js");
    expect(lines[0]).toContain("/openpush-sw.js");
  });

  it("treats a scope without the trailing slash as the same scope", async () => {
    const container = new FakeContainer();
    container.registrations = [fakeRegistration(`${SITE}/openpush/`, `${SITE}/openpush/other.js`)];
    const result = await registerWorker(container, PAGE, "/openpush/openpush-sw.js", "/openpush", log());
    expect(result.state).toBe("taken");
  });

  it("re-registers over its own worker at the same scope", async () => {
    const container = new FakeContainer();
    container.registrations = [fakeRegistration(`${SITE}/`, `${SITE}/openpush-sw.js`)];
    const result = await registerWorker(container, PAGE, "/openpush-sw.js", "/", log());
    expect(result.state).toBe("ok");
  });

  it("maps a missing file to state missing, other failures to error", async () => {
    const container = new FakeContainer();
    container.failWith = new TypeError("Failed to register a ServiceWorker: A bad HTTP response code (404) was received when fetching the script.");
    const missing = await registerWorker(container, PAGE, "/openpush-sw.js", "/", log());
    expect(missing.state).toBe("missing");
    if (missing.state === "ok") throw new Error("unreachable");
    expect(missing.error).toMatchObject({ code: "worker_registration_failed", detail: { reason: "not_found" } });

    container.failWith = new TypeError("The script has an unsupported MIME type ('text/html').");
    const wrongType = await registerWorker(container, PAGE, "/openpush-sw.js", "/", log());
    expect(wrongType.state).toBe("error");
  });
});

describe("classifyRegistrationError", () => {
  const cases: [string, unknown][] = [
    ["not_found", new TypeError("A bad HTTP response code (404) was received when fetching the script.")],
    ["not_javascript", new TypeError("The script has an unsupported MIME type ('text/html').")],
    ["not_javascript", new Error("Bad Content-Type of 'text/html' received for script")],
    ["redirected", new TypeError("The script resource is behind a redirect, which is disallowed.")],
    ["forbidden", new TypeError("A bad HTTP response code (403) was received when fetching the script.")],
    ["forbidden", Object.assign(new Error("The origin of the provided scriptURL does not match the current origin."), { name: "SecurityError" })],
    [
      "scope_not_allowed",
      Object.assign(new Error("The path of the provided scope ('/') is not under the max scope allowed ('/openpush/')."), { name: "SecurityError" }),
    ],
    ["other", new Error("Something else")],
  ];
  it.each(cases)("%s", (reason, error) => {
    expect(classifyRegistrationError(error)).toBe(reason);
  });
});
