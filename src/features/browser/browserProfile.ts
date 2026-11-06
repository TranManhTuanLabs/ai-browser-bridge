import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Schema } from "effect";
import { type BrowserChoice, BrowserChoiceSchema } from "./browserSchemas.ts";

const BROWSER_CHOICE_ENV = "AI_BROWSER_BRIDGE_BROWSER";
const CHROME_APP_NAME_ENV = "AI_BROWSER_BRIDGE_CHROME_APP";
const DEFAULT_CHROME_APP_NAME = "Google Chrome";
const DEFAULT_EDGE_APP_NAME = "Microsoft Edge";
// First debug port used by isolated profiles; the shared bridge profile owns 9222.
const BRIDGE_ISOLATED_PORT_BASE = 9223;
// Debug-port span isolated profiles hash into, keeping them off the shared 9222.
const BRIDGE_ISOLATED_PORT_SPAN = 100;
// Profile-name char class: lowercase alphanumerics plus dot/underscore/hyphen survive; any
// other run collapses to a single hyphen so the name is a safe single path segment.
const UNSAFE_PROFILE_CHARS = /[^a-z0-9._-]+/g;
const PROFILE_EDGE_HYPHENS = /^-+|-+$/g;

export const bridgeChromeProfileRoot = (home: string = homedir()): string => {
  return join(home, ".ai-browser-bridge", "chrome-profile");
};

// DevToolsActivePort holds the port on line 1 and the browser websocket path on
// line 2, e.g. "9222\n/devtools/browser/<id>". The browser writes it only
// while its remote-debugging toggle is on; the file outlives the server, so
// callers must treat it as a hint and verify the endpoint answers.
const DEVTOOLS_ACTIVE_PORT = /^(?<port>\d+)\s+(?<browserPath>\/devtools\/browser\/\S+)/;

export type OwnBrowserDebugTarget = {
  readonly port: number;
  readonly endpoint: string;
};

export const debugTargetFromActivePort = (
  activePort: string,
): OwnBrowserDebugTarget | undefined => {
  const activePortParts = DEVTOOLS_ACTIVE_PORT.exec(activePort)?.groups;
  if (activePortParts === undefined) return undefined;
  const port = Number(activePortParts.port);
  if (!Number.isInteger(port) || port <= 0) return undefined;
  return { port, endpoint: `ws://127.0.0.1:${port}${activePortParts.browserPath}` };
};

const readActivePortFile = (dataRoot: string): string | undefined => {
  try {
    return readFileSync(join(dataRoot, "DevToolsActivePort"), "utf8");
  } catch {
    return undefined;
  }
};

export const ownBrowserDebugTarget = (dataRoot: string): OwnBrowserDebugTarget | undefined => {
  const activePort = readActivePortFile(dataRoot);
  if (activePort === undefined) return undefined;
  return debugTargetFromActivePort(activePort);
};

// macOS data roots for the user's own browsers. The bridge never launches
// these browsers and never passes --remote-debugging-port to them: since
// Chrome 136 that flag is ignored on a real (default) profile.
export const myChromeDataRoot = (home: string = homedir()): string => {
  return join(home, "Library", "Application Support", "Google", "Chrome");
};

export const myEdgeDataRoot = (home: string = homedir()): string => {
  return join(home, "Library", "Application Support", "Microsoft Edge");
};

export const dataRootForChoice = (choice: BrowserChoice, home: string = homedir()): string => {
  if (choice === "my-edge") return myEdgeDataRoot(home);
  if (choice === "my-chrome") return myChromeDataRoot(home);
  return bridgeChromeProfileRoot(home);
};

export const browserLabelForChoice = (choice: BrowserChoice): string => {
  if (choice === "my-edge") return "Microsoft Edge";
  if (choice === "my-chrome") return "Google Chrome";
  return "Bridge Chrome profile";
};

export const browserAppNameForChoice = (choice: BrowserChoice): string => {
  if (choice === "my-edge") return DEFAULT_EDGE_APP_NAME;
  return DEFAULT_CHROME_APP_NAME;
};

export const inspectUrlForChoice = (choice: BrowserChoice): string | null => {
  if (choice === "my-edge") return "edge://inspect/#remote-debugging";
  if (choice === "my-chrome") return "chrome://inspect/#remote-debugging";
  return null;
};

const isBrowserChoice = Schema.is(BrowserChoiceSchema);

export const configuredBrowserChoice = (env: NodeJS.ProcessEnv = process.env): BrowserChoice => {
  const configuredChoice = env[BROWSER_CHOICE_ENV]?.trim();
  if (configuredChoice === undefined || configuredChoice.length === 0) return "bridge-profile";
  if (isBrowserChoice(configuredChoice)) return configuredChoice;
  throw new Error(
    `${BROWSER_CHOICE_ENV} must be "bridge-profile", "my-chrome", or "my-edge", not "${configuredChoice}".`,
  );
};

export const chromeAppName = (env: NodeJS.ProcessEnv = process.env): string => {
  const configuredName = env[CHROME_APP_NAME_ENV]?.trim();
  if (configuredName === undefined || configuredName.length === 0) {
    return DEFAULT_CHROME_APP_NAME;
  }
  return configuredName;
};

const isolatedProfilesRoot = (home: string = homedir()): string => {
  return join(home, ".ai-browser-bridge", "chrome-profiles");
};

const sanitizeProfileName = (name: string): string => {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(UNSAFE_PROFILE_CHARS, "-")
    .replace(PROFILE_EDGE_HYPHENS, "");
  if (cleaned.length === 0) {
    return "profile";
  }
  return cleaned;
};

// FNV-1a hash, kept stable so a profile name always maps to the same debug port.
const stableHash = (value: string): number => {
  let hash = 2_166_136_261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
};

export type IsolatedProfile = {
  readonly name: string;
  readonly profileRoot: string;
  readonly debugPort: number;
};

// Pure path/port math for an isolate name — nothing is created on disk.
export const isolatedProfile = (name: string, home: string = homedir()): IsolatedProfile => {
  const sanitizedName = sanitizeProfileName(name);
  return {
    name: sanitizedName,
    profileRoot: join(isolatedProfilesRoot(home), sanitizedName),
    debugPort: BRIDGE_ISOLATED_PORT_BASE + (stableHash(sanitizedName) % BRIDGE_ISOLATED_PORT_SPAN),
  };
};
