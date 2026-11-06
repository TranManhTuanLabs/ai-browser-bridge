import { describe, expect, it } from "vitest";
import {
  buildLaunchdPlist,
  DAEMON_LABEL,
  daemonLogPath,
  daemonPlistPath,
  readDaemonStatus,
} from "./daemon.ts";

describe("launchd daemon plist", () => {
  it("starts at login and restarts on crash but not after a clean exit", () => {
    const plist = buildLaunchdPlist({
      bridgeBin: "/repo/dist/bridge.js",
      repoPath: "/repo",
      browserChoice: "my-edge",
      logPath: "/Users/me/.ai-browser-bridge/daemon.log",
    });

    expect(plist).toContain("<key>RunAtLoad</key>");
    expect(plist).toContain("<key>KeepAlive</key>");
    expect(plist).toContain("<key>SuccessfulExit</key>");
    expect(plist).toContain("<false/>");
    expect(plist).toContain(`<string>${DAEMON_LABEL}</string>`);
    expect(plist).toContain("<string>dashboard</string>");
    expect(plist).toContain("<string>--serve-only</string>");
    expect(plist).toContain("<string>my-edge</string>");
    expect(plist).toContain("<string>/Users/me/.ai-browser-bridge/daemon.log</string>");
  });

  it("keeps the plist and log under the user's home, not the repo", () => {
    expect(daemonPlistPath("/Users/me")).toBe(
      "/Users/me/Library/LaunchAgents/com.ai-browser-bridge.plist",
    );
    expect(daemonLogPath("/Users/me")).toBe("/Users/me/.ai-browser-bridge/daemon.log");
  });

  it("reports not installed when no plist exists, without touching launchctl", async () => {
    const status = await readDaemonStatus("/Users/me", {
      plistExists: () => false,
      launchctlList: async () => {
        throw new Error("launchctl must not be called when nothing is installed");
      },
    });

    expect(status.installed).toBe(false);
    expect(status.running).toBe(false);
    expect(status.label).toBe(DAEMON_LABEL);
  });

  it("reports installed and running from the injected launchctl check", async () => {
    const status = await readDaemonStatus("/Users/me", {
      plistExists: () => true,
      launchctlList: async () => true,
    });

    expect(status.installed).toBe(true);
    expect(status.running).toBe(true);
  });
});
