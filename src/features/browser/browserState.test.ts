import { describe, expect, it } from "vitest";
import { readBrowserStatus } from "./browserState.ts";

describe("browser status", () => {
  it("reports ready when the Chrome debug port is reachable", async () => {
    const status = await readBrowserStatus(
      { port: 9333 },
      {
        bridgeChromeProfileRoot: () => "/Users/me/.ai-browser-bridge/chrome-profile",
        getUserDataDirOnDebugPort: async () => null,
        isChromeProcessRunning: async () => true,
        isDebugPortListening: async () => true,
      },
    );

    expect(status.state).toBe("ready");
    expect(status.canAttach).toBe(true);
    expect(status.port).toBe(9333);
  });

  it("reports a running Chrome that was not started with the debug port", async () => {
    const status = await readBrowserStatus(
      { port: 9444 },
      {
        bridgeChromeProfileRoot: () => "/profile",
        getUserDataDirOnDebugPort: async () => null,
        isChromeProcessRunning: async () => true,
        isDebugPortListening: async () => false,
      },
    );

    expect(status.state).toBe("chrome-running-without-debug");
    expect(status.canAttach).toBe(false);
    expect(status.message).toContain("bridge chrome start");
    expect(status.message).not.toContain("Quit Chrome");
  });

  it("reports Chrome not running when neither process nor debug port exists", async () => {
    const status = await readBrowserStatus(
      {},
      {
        bridgeChromeProfileRoot: () => "/profile",
        getUserDataDirOnDebugPort: async () => null,
        isChromeProcessRunning: async () => false,
        isDebugPortListening: async () => false,
      },
    );

    expect(status.state).toBe("chrome-not-running");
    expect(status.canAttach).toBe(false);
  });

  it("reports my-edge ready from DevToolsActivePort without touching /json", async () => {
    const status = await readBrowserStatus(
      { browserChoice: "my-edge" },
      {
        isBrowserProcessRunning: async () => true,
        ownBrowserDebugTarget: () => ({
          port: 9222,
          endpoint: "ws://127.0.0.1:9222/devtools/browser/abc",
        }),
      },
    );

    expect(status.state).toBe("ready");
    expect(status.canAttach).toBe(true);
    expect(status.browserChoice).toBe("my-edge");
    expect(status.browserLabel).toBe("Microsoft Edge");
    expect(status.inspectUrl).toBe("edge://inspect/#remote-debugging");
    expect(status.allowRequired).toBe(true);
    expect(status.endpoint).toBe("ws://127.0.0.1:9222/devtools/browser/abc");
    expect(status.message).toContain("Click Allow");
  });

  it("reports my-edge running without debugging when the active-port file is missing", async () => {
    const status = await readBrowserStatus(
      { browserChoice: "my-edge" },
      {
        isBrowserProcessRunning: async () => true,
        ownBrowserDebugTarget: () => undefined,
      },
    );

    expect(status.state).toBe("chrome-running-without-debug");
    expect(status.canAttach).toBe(false);
    expect(status.message).toContain("edge://inspect/#remote-debugging");
  });

  it("reports my-edge not running when Edge is closed", async () => {
    const status = await readBrowserStatus(
      { browserChoice: "my-edge" },
      {
        isBrowserProcessRunning: async () => false,
        ownBrowserDebugTarget: () => undefined,
      },
    );

    expect(status.state).toBe("chrome-not-running");
    expect(status.canAttach).toBe(false);
  });
});
