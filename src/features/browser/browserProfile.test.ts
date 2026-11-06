import { describe, expect, it } from "vitest";
import {
  browserLabelForChoice,
  configuredBrowserChoice,
  dataRootForChoice,
  debugTargetFromActivePort,
  inspectUrlForChoice,
  myChromeDataRoot,
  myEdgeDataRoot,
} from "./browserProfile.ts";

describe("browser choice", () => {
  it("defaults to the bridge profile when the env var is unset", () => {
    expect(configuredBrowserChoice({})).toBe("bridge-profile");
  });

  it("accepts my-edge and my-chrome from the env var", () => {
    expect(configuredBrowserChoice({ AI_BROWSER_BRIDGE_BROWSER: " my-edge " })).toBe("my-edge");
    expect(configuredBrowserChoice({ AI_BROWSER_BRIDGE_BROWSER: "my-chrome" })).toBe("my-chrome");
  });

  it("rejects an unknown browser choice with the valid values", () => {
    expect(() => configuredBrowserChoice({ AI_BROWSER_BRIDGE_BROWSER: "brave" })).toThrow(
      '"bridge-profile", "my-chrome", or "my-edge"',
    );
  });

  it("points Edge at its macOS data root, not the bridge profile", () => {
    expect(myEdgeDataRoot("/Users/me")).toBe(
      "/Users/me/Library/Application Support/Microsoft Edge",
    );
    expect(dataRootForChoice("my-edge", "/Users/me")).toBe(myEdgeDataRoot("/Users/me"));
    expect(dataRootForChoice("bridge-profile", "/Users/me")).toContain(
      ".ai-browser-bridge/chrome-profile",
    );
  });

  it("points Chrome at its macOS data root too", () => {
    expect(myChromeDataRoot("/Users/me")).toBe(
      "/Users/me/Library/Application Support/Google/Chrome",
    );
    expect(dataRootForChoice("my-chrome", "/Users/me")).toBe(myChromeDataRoot("/Users/me"));
  });

  it("names the Edge inspect toggle for my-edge", () => {
    expect(inspectUrlForChoice("my-edge")).toBe("edge://inspect/#remote-debugging");
    expect(inspectUrlForChoice("my-chrome")).toBe("chrome://inspect/#remote-debugging");
    expect(inspectUrlForChoice("bridge-profile")).toBeNull();
    expect(browserLabelForChoice("my-edge")).toBe("Microsoft Edge");
  });
});

describe("DevToolsActivePort parsing", () => {
  it("builds a loopback websocket endpoint from the port and browser path", () => {
    const target = debugTargetFromActivePort(
      "9222\n/devtools/browser/0b6c1c1e-0000-4000-8000-000000000000\n",
    );
    expect(target).toEqual({
      port: 9222,
      endpoint: "ws://127.0.0.1:9222/devtools/browser/0b6c1c1e-0000-4000-8000-000000000000",
    });
  });

  it("rejects a stale or malformed active-port file instead of guessing", () => {
    expect(debugTargetFromActivePort("")).toBeUndefined();
    expect(debugTargetFromActivePort("not-a-port\n/devtools/browser/x\n")).toBeUndefined();
    expect(debugTargetFromActivePort("9222\n")).toBeUndefined();
  });
});
