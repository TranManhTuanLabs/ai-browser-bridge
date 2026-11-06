import { describe, expect, it } from "vitest";
import {
  askCommand,
  type DashboardStatus,
  dashboardMcpConnectorUrl,
  renderDashboardHtml,
  resolveDashboardPermissionMode,
  resumeCommand,
  validDashboardProviders,
} from "./index.ts";

const status = (overrides: Partial<DashboardStatus> = {}): DashboardStatus => {
  return {
    browser: {
      port: 9222,
      debugPortListening: true,
      chromeRunning: true,
      userDataDir: "/Users/me/Library/Application Support/Microsoft Edge",
      bridgeProfileRoot: "/Users/me/.ai-browser-bridge/chrome-profile",
      canAttach: true,
      browserChoice: "my-edge",
      browserLabel: "Microsoft Edge",
      inspectUrl: "edge://inspect/#remote-debugging",
      allowRequired: true,
      endpoint: "ws://127.0.0.1:9222/devtools/browser/abc",
      state: "ready",
      message: "Microsoft Edge has remote debugging on at port 9222.",
    },
    browserChoice: "my-edge",
    repoPath: "/repo",
    provider: "chatgpt",
    providerIds: ["chatgpt", "gemini", "claude"],
    permissionMode: "ask",
    permissionModeExplicit: false,
    sessions: [{ id: "abc", model: "ChatGPT", updatedAt: "2026-11-07", tunnelUrl: null }],
    latestSession: null,
    mcpLocalUrl: "http://localhost:8765/mcp",
    mcpTunnelUrl: null,
    mcpConnectorUrl: null,
    daemon: { installed: false, running: false, label: "com.ai-browser-bridge" },
    ...overrides,
  };
};

describe("dashboard permissions", () => {
  it("defaults dashboard asks to ask when the repo has no explicit mode", () => {
    expect(resolveDashboardPermissionMode(undefined)).toBe("ask");
    expect(resolveDashboardPermissionMode("auto")).toBe("auto");
  });

  it("never switches provider on resume: it reopens the last provider tab", () => {
    expect(resumeCommand("grok", "my-edge")).toBe(
      "bridge chrome start --browser my-edge --provider grok",
    );
  });

  it("builds a manual fan-out command only from the providers the user picked", () => {
    expect(askCommand({ prompt: "hello", providers: ["claude", "deepseek"], tools: false })).toBe(
      'bridge ask "hello" --provider claude,deepseek --json',
    );
    expect(validDashboardProviders(["claude", "not-a-provider", "grok"])).toEqual([
      "claude",
      "grok",
    ]);
  });

  it("appends /mcp to a tunnel URL and leaves an existing /mcp alone", () => {
    expect(dashboardMcpConnectorUrl("https://x.trycloudflare.com")).toBe(
      "https://x.trycloudflare.com/mcp",
    );
    expect(dashboardMcpConnectorUrl("https://x.trycloudflare.com/mcp")).toBe(
      "https://x.trycloudflare.com/mcp",
    );
    expect(dashboardMcpConnectorUrl(null)).toBeNull();
  });
});

describe("dashboard html", () => {
  it("shows Edge status, the Allow note, and no polling script", () => {
    const html = renderDashboardHtml(status());

    expect(html).toContain("Microsoft Edge (my-edge)");
    expect(html).toContain("edge://inspect/#remote-debugging");
    expect(html).toContain("click Allow in the browser on every new connection");
    expect(html).toContain("refresh the page to re-check");
    expect(html).not.toContain("setInterval");
    expect(html).not.toContain("setTimeout");
    expect(html).toContain("http://127.0.0.1:8766");
    expect(html).toContain("Kill switch");
  });

  it("escapes session ids instead of injecting them into the page", () => {
    const html = renderDashboardHtml(
      status({
        sessions: [{ id: "<script>", model: null, updatedAt: "2026-11-07", tunnelUrl: null }],
      }),
    );

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
