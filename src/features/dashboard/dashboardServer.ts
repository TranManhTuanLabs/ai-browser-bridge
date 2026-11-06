import { type ChildProcess, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { DEFAULT_MCP_PORT, DEFAULT_PROVIDER, PROVIDER_IDS } from "@/config";
import { loadConfig, saveConfig } from "@/features/bridge";
import {
  type BrowserChoice,
  configuredBrowserChoice,
  readBrowserStatus,
  terminateChromeOnDebugPort,
} from "@/features/browser";
import { readDaemonStatus } from "@/features/daemon";
import { normalizePermissionMode, type PermissionMode } from "@/features/domain";
import type { SessionMetadata } from "@/features/store";
import { configPath, getLatestSession, listSessions, repositoryRoot } from "@/features/store";
import {
  DASHBOARD_HOST,
  DASHBOARD_PORT,
  type DashboardStatus,
  dashboardUrl,
  renderDashboardHtml,
  resolveDashboardPermissionMode,
  sessionSummary,
  validDashboardProviders,
} from "./dashboard.ts";

// null when no tunnel; otherwise `<url>/mcp` unless already `/mcp` or `/sse`.
export const dashboardMcpConnectorUrl = (tunnelUrl?: string | null): string | null => {
  if (tunnelUrl === undefined || tunnelUrl === null || tunnelUrl === "") return null;
  const normalized = tunnelUrl.replace(/\/+$/, "");
  return normalized.endsWith("/mcp") || normalized.endsWith("/sse")
    ? normalized
    : `${normalized}/mcp`;
};

type DashboardServerOptions = {
  readonly repoPath?: string;
  readonly port?: number;
  readonly browserChoice?: BrowserChoice;
  readonly openBrowser?: boolean;
  // Called when the server closes (kill switch), so a foreground
  // `bridge dashboard` process can exit instead of idling.
  readonly onClose?: () => void;
};

const bridgeBinPath = (): string => {
  const bin = process.argv[1];
  if (bin === undefined || bin === "") {
    throw new Error("Cannot run bridge commands: the bridge binary path is unknown.");
  }
  return bin;
};

const explicitPermissionMode = async (repoPath: string): Promise<PermissionMode | undefined> => {
  try {
    const raw = JSON.parse(await readFile(configPath(repositoryRoot(repoPath)), "utf-8")) as Record<
      string,
      unknown
    >;
    if (typeof raw.permissionMode !== "string") return undefined;
    if (
      raw.permissionMode !== "read-only" &&
      raw.permissionMode !== "ask" &&
      raw.permissionMode !== "auto"
    ) {
      return undefined;
    }
    return raw.permissionMode;
  } catch {
    return undefined;
  }
};

const buildDashboardStatus = async (
  options: DashboardServerOptions = {},
): Promise<DashboardStatus> => {
  const repoPath = options.repoPath ?? process.cwd();
  const browserChoice =
    options.browserChoice === undefined ? configuredBrowserChoice() : options.browserChoice;
  const [browser, config, sessions, latest, daemon, explicitMode] = await Promise.all([
    readBrowserStatus({ browserChoice }),
    loadConfig(repoPath),
    listSessions(),
    getLatestSession(),
    readDaemonStatus(),
    explicitPermissionMode(repoPath),
  ]);
  const latestSummary = latest === null ? null : sessionSummary(latest.metadata);
  const tunnelUrl = latestSummary?.tunnelUrl ?? null;
  return {
    browser,
    browserChoice,
    repoPath: config.repoPath,
    provider: config.provider ?? DEFAULT_PROVIDER,
    providerIds: PROVIDER_IDS,
    permissionMode: resolveDashboardPermissionMode(explicitMode),
    permissionModeExplicit: explicitMode !== undefined,
    sessions: sessions.map((session: SessionMetadata) => sessionSummary(session)),
    latestSession: latestSummary,
    mcpLocalUrl: `http://localhost:${config.mcpPort ?? DEFAULT_MCP_PORT}/mcp`,
    mcpTunnelUrl: tunnelUrl,
    mcpConnectorUrl: dashboardMcpConnectorUrl(tunnelUrl),
    daemon,
  };
};

type BridgeRunResult = {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

const runBridge = (args: string[], timeoutMs: number): Promise<BridgeRunResult> => {
  return new Promise((resolveRun) => {
    const child: ChildProcess = spawn(process.execPath, [bridgeBinPath(), ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveRun({ code, stdout, stderr });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolveRun({ code: null, stdout, stderr: `${stderr}${String(error)}` });
    });
  });
};

const readBody = (request: IncomingMessage): Promise<Record<string, string | string[]>> => {
  return new Promise((resolveBody) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      const contentType = request.headers["content-type"] ?? "";
      if (contentType.includes("application/json")) {
        try {
          const parsed: unknown = JSON.parse(body);
          if (parsed !== null && typeof parsed === "object") {
            resolveBody(parsed as Record<string, string | string[]>);
            return;
          }
        } catch {
          resolveBody({});
          return;
        }
      }
      const params = new URLSearchParams(body);
      const result: Record<string, string | string[]> = {};
      for (const key of new Set(params.keys())) {
        const values = params.getAll(key);
        result[key] = values.length === 1 ? (values[0] ?? "") : values;
      }
      resolveBody(result);
    });
  });
};

const sendJson = (response: ServerResponse, code: number, value: unknown): void => {
  response.writeHead(code, { "content-type": "application/json" });
  response.end(`${JSON.stringify(value, null, 2)}\n`);
};

const bodyString = (body: Record<string, string | string[]>, key: string): string => {
  const value = body[key];
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
};

const bodyStrings = (body: Record<string, string | string[]>, key: string): string[] => {
  const value = body[key];
  if (Array.isArray(value)) return value;
  if (value === undefined || value === "") return [];
  return [value];
};

export type DashboardServerHandle = {
  readonly url: string;
  readonly close: () => Promise<void>;
};

export const serveDashboard = async (
  options: DashboardServerOptions = {},
): Promise<DashboardServerHandle> => {
  const port = options.port ?? DASHBOARD_PORT;
  const repoPath = options.repoPath ?? process.cwd();
  const server: Server = createServer((request, response) => {
    void handleDashboardRequest({ request, response, options, repoPath, server });
  });
  // Single-instance: a second dashboard on the same port fails instead of
  // silently shadowing the first one.
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", (error) => rejectListen(error));
    server.listen(port, DASHBOARD_HOST, () => {
      server.removeListener("error", rejectListen);
      resolveListen();
    });
  });
  if (options.openBrowser === true && process.platform === "darwin") {
    spawn("open", [dashboardUrl(port)], { detached: true, stdio: "ignore" }).unref();
  }
  if (options.onClose !== undefined) server.on("close", options.onClose);
  return {
    url: dashboardUrl(port),
    close: () =>
      new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
      }),
  };
};

const handleDashboardRequest = async (input: {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly options: DashboardServerOptions;
  readonly repoPath: string;
  readonly server: Server;
}): Promise<void> => {
  const { request, response } = input;
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  try {
    if (request.method === "GET" && url.pathname === "/") {
      const status = await buildDashboardStatus(input.options);
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(renderDashboardHtml(status));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/status") {
      sendJson(response, 200, await buildDashboardStatus(input.options));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/sessions") {
      const sessions = await listSessions();
      sendJson(response, 200, { sessions: sessions.map((session) => sessionSummary(session)) });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/ask") {
      await handleAsk(input, await readBody(request));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/resume") {
      await handleResume(input);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/permission") {
      await handlePermission(input, await readBody(request));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/stop") {
      await handleStop(input, await readBody(request));
      return;
    }
    sendJson(response, 404, { ok: false, error: "Not found" });
  } catch (error) {
    sendJson(response, 500, { ok: false, error: String(error) });
  }
};

// Ask runs are single-flight and manual: one dashboard ask at a time, and
// the dashboard never re-sends a prompt on its own when a provider limits.
const handleAsk = async (
  input: {
    readonly response: ServerResponse;
    readonly options: DashboardServerOptions;
    readonly repoPath: string;
  },
  body: Record<string, string | string[]>,
): Promise<void> => {
  const prompt = bodyString(body, "prompt").trim();
  if (prompt === "") {
    sendJson(input.response, 400, { ok: false, error: "prompt is required" });
    return;
  }
  const requested = bodyStrings(body, "providers");
  const single = bodyString(body, "provider");
  const providers = validDashboardProviders(
    requested.length > 0 ? requested : single === "" ? [] : [single],
  );
  const config = await loadConfig(input.repoPath);
  const explicitMode = await explicitPermissionMode(input.repoPath);
  const mode = resolveDashboardPermissionMode(explicitMode);
  if (
    mode === "ask" &&
    bodyString(body, "confirm") !== "on" &&
    bodyString(body, "confirm") !== "true"
  ) {
    sendJson(input.response, 400, {
      ok: false,
      error: "Permission mode is ask: confirm this ask before sending.",
    });
    return;
  }
  if (mode === "read-only" && bodyString(body, "tools") === "on") {
    sendJson(input.response, 400, {
      ok: false,
      error: "Permission mode is read-only: MCP tools are not allowed.",
    });
    return;
  }
  const args = ["ask", prompt, "--repo", config.repoPath, "--json"];
  if (providers.length > 0) args.push("--provider", providers.join(","));
  else args.push("--provider", config.provider ?? DEFAULT_PROVIDER);
  if (bodyString(body, "tools") === "on" || bodyString(body, "tools") === "true") {
    args.push("--tools");
  }
  const result = await runBridge(args, 300_000);
  sendJson(input.response, result.code === 0 ? 200 : 502, {
    ok: result.code === 0,
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
  });
};

const handleResume = async (input: {
  readonly response: ServerResponse;
  readonly options: DashboardServerOptions;
  readonly repoPath: string;
}): Promise<void> => {
  const config = await loadConfig(input.repoPath);
  const browserChoice =
    input.options.browserChoice === undefined
      ? configuredBrowserChoice()
      : input.options.browserChoice;
  // chrome start attaches on demand; the browser asks for Allow once.
  const result = await runBridge(
    [
      "chrome",
      "start",
      "--browser",
      browserChoice,
      "--provider",
      config.provider ?? DEFAULT_PROVIDER,
    ],
    90_000,
  );
  sendJson(input.response, result.code === 0 ? 200 : 502, {
    ok: result.code === 0,
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
  });
};

const handlePermission = async (
  input: { readonly response: ServerResponse; readonly repoPath: string },
  body: Record<string, string | string[]>,
): Promise<void> => {
  const mode: PermissionMode = normalizePermissionMode(bodyString(body, "mode"));
  const config = await loadConfig(input.repoPath);
  await saveConfig({ ...config, permissionMode: mode });
  sendJson(input.response, 200, { ok: true, permissionMode: mode });
};

const handleStop = async (
  input: {
    readonly response: ServerResponse;
    readonly options: DashboardServerOptions;
    readonly server: Server;
  },
  body: Record<string, string | string[]>,
): Promise<void> => {
  if (bodyString(body, "confirm") !== "on" && bodyString(body, "confirm") !== "true") {
    sendJson(input.response, 400, { ok: false, error: "Kill switch needs confirm." });
    return;
  }
  const browserChoice =
    input.options.browserChoice === undefined
      ? configuredBrowserChoice()
      : input.options.browserChoice;
  let closedBridgeChrome = false;
  if (browserChoice === "bridge-profile") {
    closedBridgeChrome = await terminateChromeOnDebugPort();
  }
  // Your own browser is never killed: the kill switch only stops the
  // dashboard server (and, for the bridge profile, its Chrome).
  sendJson(input.response, 200, {
    ok: true,
    closedBridgeChrome,
    browserLeftRunning: browserChoice !== "bridge-profile",
  });
  setTimeout(() => {
    input.server.close();
  }, 100);
};
