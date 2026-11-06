import { execFile } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { BrowserChoice } from "@/features/browser";

const execFileAsync = promisify(execFile);

// The daemon is a launchd LaunchAgent, not a terminal process: it starts at
// login and restarts on crash, so closing the terminal does not take the
// bridge offline. It runs the local dashboard server only; it never holds a
// CDP connection open, so each ask reconnects on demand (and asks for Allow
// again when the browser wants it).
export const DAEMON_LABEL = "com.ai-browser-bridge";
const DAEMON_PLIST_NAME = `${DAEMON_LABEL}.plist`;

export const daemonPlistPath = (home: string = homedir()): string => {
  return join(home, "Library", "LaunchAgents", DAEMON_PLIST_NAME);
};

export const daemonLogPath = (home: string = homedir()): string => {
  return join(home, ".ai-browser-bridge", "daemon.log");
};

export type DaemonPlistInput = {
  readonly bridgeBin: string;
  readonly repoPath: string;
  readonly browserChoice: BrowserChoice;
  readonly logPath: string;
  readonly label?: string;
};

export const buildLaunchdPlist = (input: DaemonPlistInput): string => {
  const label = input.label ?? DAEMON_LABEL;
  const args = [
    process.execPath,
    input.bridgeBin,
    "dashboard",
    "--serve-only",
    "--repo",
    input.repoPath,
    "--browser",
    input.browserChoice,
  ];
  const argsXml = args.map((arg) => `    <string>${escapePlist(arg)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapePlist(label)}</string>
  <key>ProgramArguments</key>
  <array>
${argsXml}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${escapePlist(input.logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapePlist(input.logPath)}</string>
</dict>
</plist>
`;
};

// KeepAlive with SuccessfulExit false restarts on crash but not after a
// clean exit, so a config error does not relaunch forever.
const escapePlist = (value: string): string => {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
};

export type DaemonStatus = {
  readonly installed: boolean;
  readonly running: boolean;
  readonly label: string;
  readonly plistPath: string;
  readonly logPath: string;
};

type DaemonStatusDeps = {
  readonly plistExists?: (path: string) => boolean;
  readonly launchctlList?: () => Promise<boolean>;
};

export const readDaemonStatus = async (
  home: string = homedir(),
  deps: DaemonStatusDeps = {},
): Promise<DaemonStatus> => {
  const plistPath = daemonPlistPath(home);
  const plistExists = deps.plistExists ?? existsSync;
  const installed = plistExists(plistPath);
  let running = false;
  if (installed) {
    if (deps.launchctlList !== undefined) {
      running = await deps.launchctlList();
    } else if (process.platform === "darwin") {
      running = await launchctlHasLabel(DAEMON_LABEL);
    }
  }
  return { installed, running, label: DAEMON_LABEL, plistPath, logPath: daemonLogPath(home) };
};

const launchctlHasLabel = async (label: string): Promise<boolean> => {
  try {
    const { stdout } = await execFileAsync("launchctl", ["list", label]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
};

const assertMacOs = (): void => {
  if (process.platform !== "darwin") {
    throw new Error("bridge daemon needs macOS launchd; this machine is not macOS.");
  }
};

export const installDaemon = async (input: {
  readonly bridgeBin: string;
  readonly repoPath: string;
  readonly browserChoice: BrowserChoice;
  readonly home?: string;
}): Promise<DaemonStatus> => {
  assertMacOs();
  const home = input.home ?? homedir();
  const plistPath = daemonPlistPath(home);
  const logPath = daemonLogPath(home);
  writeFileSync(plistPath, buildLaunchdPlist({ ...input, logPath }), "utf8");
  await execFileAsync("launchctl", ["bootstrap", `gui/${process.getuid?.() ?? 0}`, plistPath]);
  await execFileAsync("launchctl", [
    "kickstart",
    "-k",
    `gui/${process.getuid?.() ?? 0}/${DAEMON_LABEL}`,
  ]);
  return await readDaemonStatus(home);
};

export const uninstallDaemon = async (home: string = homedir()): Promise<DaemonStatus> => {
  assertMacOs();
  const plistPath = daemonPlistPath(home);
  await execFileAsync("launchctl", [
    "bootout",
    `gui/${process.getuid?.() ?? 0}/${DAEMON_LABEL}`,
  ]).catch(() => undefined);
  rmSync(plistPath, { force: true });
  return await readDaemonStatus(home);
};
