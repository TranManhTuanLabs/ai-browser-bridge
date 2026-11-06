import {
  bridgeChromeProfileRoot,
  browserAppNameForChoice,
  browserLabelForChoice,
  configuredBrowserChoice,
  dataRootForChoice,
  inspectUrlForChoice,
  type OwnBrowserDebugTarget,
  ownBrowserDebugTarget,
} from "./browserProfile.ts";
import type { BrowserChoice, BrowserStatus } from "./browserSchemas.ts";
import {
  BRIDGE_DEBUG_PORT,
  getUserDataDirOnDebugPort,
  isBrowserProcessRunning,
  isChromeProcessRunning,
  isDebugPortListening,
} from "./browserSession.ts";

// Status is read on demand (dashboard load, `bridge status`), never polled:
// a status read must not hold a CDP connection open or ask for Allow.
type BrowserStatusDeps = {
  readonly bridgeChromeProfileRoot?: () => string;
  readonly getUserDataDirOnDebugPort?: (port?: number) => Promise<string | null>;
  readonly isChromeProcessRunning?: () => Promise<boolean>;
  readonly isDebugPortListening?: (input?: { port?: number }) => Promise<boolean>;
  readonly isBrowserProcessRunning?: (appName: string) => Promise<boolean>;
  readonly ownBrowserDebugTarget?: (dataRoot: string) => OwnBrowserDebugTarget | undefined;
};

type BrowserStatusInput = {
  readonly port?: number;
  readonly browserChoice?: BrowserChoice;
};

export const readBrowserStatus = async (
  input: BrowserStatusInput = {},
  deps: BrowserStatusDeps = {},
): Promise<BrowserStatus> => {
  let browserChoice: BrowserChoice = configuredBrowserChoice();
  if (input.browserChoice !== undefined) browserChoice = input.browserChoice;
  if (browserChoice !== "bridge-profile") {
    return await readOwnBrowserStatus(browserChoice, deps);
  }

  let port = BRIDGE_DEBUG_PORT;
  if (input.port !== undefined) {
    port = input.port;
  }

  let checkDebugPort = isDebugPortListening;
  if (deps.isDebugPortListening !== undefined) {
    checkDebugPort = deps.isDebugPortListening;
  }

  let checkChromeProcess = isChromeProcessRunning;
  if (deps.isChromeProcessRunning !== undefined) {
    checkChromeProcess = deps.isChromeProcessRunning;
  }

  let readUserDataDir = getUserDataDirOnDebugPort;
  if (deps.getUserDataDirOnDebugPort !== undefined) {
    readUserDataDir = deps.getUserDataDirOnDebugPort;
  }

  let readBridgeProfileRoot = bridgeChromeProfileRoot;
  if (deps.bridgeChromeProfileRoot !== undefined) {
    readBridgeProfileRoot = deps.bridgeChromeProfileRoot;
  }

  const debugPortListening = await checkDebugPort({ port });
  const chromeRunning = await checkChromeProcess();
  const userDataDir = debugPortListening ? await readUserDataDir(port) : null;
  return browserStatusFor({
    port,
    debugPortListening,
    chromeRunning,
    userDataDir,
    bridgeProfileRoot: readBridgeProfileRoot(),
    browserChoice,
    browserLabel: browserLabelForChoice(browserChoice),
    inspectUrl: null,
    allowRequired: false,
    endpoint: null,
  });
};

const readOwnBrowserStatus = async (
  browserChoice: BrowserChoice,
  deps: BrowserStatusDeps,
): Promise<BrowserStatus> => {
  let checkProcess = isBrowserProcessRunning;
  if (deps.isBrowserProcessRunning !== undefined) {
    checkProcess = deps.isBrowserProcessRunning;
  }
  let readDebugTarget = ownBrowserDebugTarget;
  if (deps.ownBrowserDebugTarget !== undefined) {
    readDebugTarget = deps.ownBrowserDebugTarget;
  }
  const browserRunning = await checkProcess(browserAppNameForChoice(browserChoice));
  const debugTarget = readDebugTarget(dataRootForChoice(browserChoice));
  const label = browserLabelForChoice(browserChoice);
  const inspectUrl = inspectUrlForChoice(browserChoice);
  const base = {
    browserChoice,
    browserLabel: label,
    inspectUrl,
    allowRequired: true,
    endpoint: debugTarget === undefined ? null : debugTarget.endpoint,
    bridgeProfileRoot: bridgeChromeProfileRoot(),
    userDataDir: dataRootForChoice(browserChoice),
  };
  if (debugTarget !== undefined) {
    return {
      ...base,
      port: debugTarget.port,
      debugPortListening: true,
      chromeRunning: browserRunning,
      canAttach: true,
      state: "ready",
      message:
        `${label} has remote debugging on at port ${debugTarget.port}. ` +
        `Click Allow in ${label} when a command connects.`,
    };
  }
  if (browserRunning) {
    return {
      ...base,
      port: BRIDGE_DEBUG_PORT,
      debugPortListening: false,
      chromeRunning: true,
      canAttach: false,
      state: "chrome-running-without-debug",
      message: `${label} is running without remote debugging. Turn it on at ${inspectUrl ?? ""}.`,
    };
  }
  return {
    ...base,
    port: BRIDGE_DEBUG_PORT,
    debugPortListening: false,
    chromeRunning: false,
    canAttach: false,
    state: "chrome-not-running",
    message: `${label} is not running. Open it and turn on remote debugging at ${inspectUrl ?? ""}.`,
  };
};

const browserStatusFor = (input: {
  readonly port: number;
  readonly debugPortListening: boolean;
  readonly chromeRunning: boolean;
  readonly userDataDir: string | null;
  readonly bridgeProfileRoot: string;
  readonly browserChoice: BrowserChoice;
  readonly browserLabel: string;
  readonly inspectUrl: string | null;
  readonly allowRequired: boolean;
  readonly endpoint: string | null;
}): BrowserStatus => {
  if (input.debugPortListening) {
    return {
      ...input,
      canAttach: true,
      state: "ready",
      message: readyMessage(input.port, input.userDataDir),
    };
  }
  if (input.chromeRunning) {
    return {
      ...input,
      canAttach: false,
      state: "chrome-running-without-debug",
      message: `Chrome is running without debug port ${input.port}. Run \`bridge chrome start\` to launch or reuse the shared bridge profile on the debug port.`,
    };
  }
  return {
    ...input,
    canAttach: false,
    state: "chrome-not-running",
    message: "Chrome is not running. Start the shared bridge profile with `bridge chrome start`.",
  };
};

const readyMessage = (port: number, userDataDir: string | null): string => {
  if (userDataDir === null) {
    return `Chrome debug port ${port} is ready.`;
  }
  return `Chrome debug port ${port} is ready. Profile: ${userDataDir}.`;
};
