import { PROVIDER_IDS } from "@/config";
import type { BrowserChoice, BrowserStatus } from "@/features/browser";
import type { PermissionMode } from "@/features/domain";
import type { SessionMetadata } from "@/features/store";

// Local-only dashboard. It binds 127.0.0.1 and never 0.0.0.0, and it never
// polls: every status read happens because a human opened or refreshed the
// page (or called /api/status). Holding a CDP connection open to poll would
// keep asking for Allow and burn a browser session for nothing.
export const DASHBOARD_HOST = "127.0.0.1";
export const DASHBOARD_PORT = 8766;

export const dashboardUrl = (port: number = DASHBOARD_PORT): string => {
  return `http://${DASHBOARD_HOST}:${port}`;
};

export type DashboardSessionSummary = {
  readonly id: string;
  readonly model: string | null;
  readonly updatedAt: string;
  readonly tunnelUrl: string | null;
};

type DashboardDaemonStatus = {
  readonly installed: boolean;
  readonly running: boolean;
  readonly label: string;
};

export type DashboardStatus = {
  readonly browser: BrowserStatus;
  readonly browserChoice: BrowserChoice;
  readonly repoPath: string;
  readonly provider: string;
  readonly providerIds: readonly string[];
  // Dashboard-initiated asks default to ask: an explicit repo mode wins,
  // otherwise the dashboard asks for confirmation instead of inheriting
  // the CLI's auto default.
  readonly permissionMode: PermissionMode;
  readonly permissionModeExplicit: boolean;
  readonly sessions: readonly DashboardSessionSummary[];
  readonly latestSession: DashboardSessionSummary | null;
  readonly mcpLocalUrl: string;
  readonly mcpTunnelUrl: string | null;
  readonly mcpConnectorUrl: string | null;
  readonly daemon: DashboardDaemonStatus;
};

export const resolveDashboardPermissionMode = (
  explicit: PermissionMode | undefined,
): PermissionMode => {
  if (explicit === undefined) return "ask";
  return explicit;
};

export const sessionSummary = (session: SessionMetadata): DashboardSessionSummary => {
  return {
    id: session.id,
    model: session.model,
    updatedAt: session.updatedAt,
    tunnelUrl: session.tunnelUrl,
  };
};

// Resume reopens the last provider tab in the chosen browser. It never
// switches provider for the user: each tab keeps its own conversation
// context, and an automatic switch would lose it.
export const resumeCommand = (provider: string, browserChoice: BrowserChoice): string => {
  return `bridge chrome start --browser ${browserChoice} --provider ${provider}`;
};

export const askCommand = (input: {
  readonly prompt: string;
  readonly providers: readonly string[];
  readonly tools: boolean;
}): string => {
  const providers = input.providers.length === 0 ? [] : input.providers;
  const parts = ["bridge", "ask", JSON.stringify(input.prompt)];
  if (providers.length > 0) parts.push("--provider", providers.join(","));
  if (input.tools) parts.push("--tools");
  parts.push("--json");
  return parts.join(" ");
};

export const validDashboardProviders = (providers: readonly string[]): string[] => {
  const valid: string[] = [];
  for (const provider of providers) {
    if (PROVIDER_IDS.includes(provider as (typeof PROVIDER_IDS)[number])) valid.push(provider);
  }
  return valid;
};

const escapeHtml = (value: string): string => {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
};

export const renderDashboardHtml = (status: DashboardStatus): string => {
  const browser = status.browser;
  const sessions =
    status.sessions
      .map(
        (session) =>
          `<li><code>${escapeHtml(session.id)}</code> — ${escapeHtml(session.model ?? "unknown")} — ${escapeHtml(session.updatedAt)}</li>`,
      )
      .join("\n") || "<li>No sessions yet in this repo.</li>";
  const providerOptions = status.providerIds
    .map(
      (provider) =>
        `<option value="${escapeHtml(provider)}"${provider === status.provider ? " selected" : ""}>${escapeHtml(provider)}</option>`,
    )
    .join("\n");
  const confirmNote =
    status.permissionMode === "ask"
      ? "<p>Permission mode is <strong>ask</strong>: tick confirm before sending.</p>"
      : `<p>Permission mode is <strong>${escapeHtml(status.permissionMode)}</strong>.${status.permissionModeExplicit ? "" : " (dashboard default is ask; the repo has no explicit mode.)"}</p>`;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>ai-browser-bridge — dashboard</title></head>
<body>
<h1>ai-browser-bridge</h1>
<p>Local dashboard only — <code>http://127.0.0.1:${DASHBOARD_PORT}</code>. Status is read on demand when this page loads; refresh the page to re-check. Nothing here polls the browser.</p>
<h2>Browser</h2>
<ul>
<li>Browser: ${escapeHtml(browser.browserLabel)} (${escapeHtml(status.browserChoice)})</li>
<li>State: ${escapeHtml(browser.state)}</li>
<li>Can attach: ${browser.canAttach ? "yes" : "no"}</li>
<li>Debug port: ${browser.port} (${browser.debugPortListening ? "ready" : "closed"})</li>
${browser.allowRequired ? "<li>Allow: click Allow in the browser on every new connection.</li>" : ""}
${browser.inspectUrl ? `<li>Remote debugging toggle: <code>${escapeHtml(browser.inspectUrl)}</code></li>` : ""}
<li>${escapeHtml(browser.message)}</li>
</ul>
<h2>Ask</h2>
${confirmNote}
<form method="post" action="/api/ask">
<label>Prompt <input name="prompt" size="60" required></label><br>
<label>Provider <select name="provider">${providerOptions}</select></label>
<label><input type="checkbox" name="providers" value="chatgpt"> chatgpt</label>
<label><input type="checkbox" name="providers" value="gemini"> gemini</label>
<label><input type="checkbox" name="providers" value="claude"> claude</label>
<label><input type="checkbox" name="providers" value="deepseek"> deepseek</label>
<label><input type="checkbox" name="providers" value="grok"> grok</label><br>
<label><input type="checkbox" name="tools"> with MCP tools (ChatGPT only)</label>
<label><input type="checkbox" name="confirm"> confirm (required in ask mode)</label><br>
<button type="submit">Send</button>
</form>
<p>Equivalent terminal command is shown after sending. Fan-out is manual: pick several providers and the dashboard sends one <code>bridge ask --provider a,b</code> call; it never switches provider on its own when one hits its free limit.</p>
<h2>Resume last tab</h2>
<form method="post" action="/api/resume"><button type="submit">Resume: reopen ${escapeHtml(status.provider)} tab</button></form>
<p><code>${escapeHtml(resumeCommand(status.provider, status.browserChoice))}</code></p>
<h2>Sessions</h2>
<ul>${sessions}</ul>
<h2>MCP</h2>
<ul>
<li>Local: <code>${escapeHtml(status.mcpLocalUrl)}</code></li>
<li>Tunnel: <code>${escapeHtml(status.mcpTunnelUrl ?? "none — run bridge ask --tools to start one")}</code></li>
<li>Connector URL (copy into Muse as a custom connector): <code>${escapeHtml(status.mcpConnectorUrl ?? "none yet")}</code></li>
</ul>
<h2>Daemon</h2>
<ul>
<li>Installed: ${status.daemon.installed ? "yes" : "no"} (${escapeHtml(status.daemon.label)})</li>
<li>Running: ${status.daemon.running ? "yes" : "no"}</li>
</ul>
<p>Install from the terminal: <code>bridge daemon install</code>. The daemon keeps the dashboard server up after the terminal closes; it does not hold a browser connection open.</p>
<h2>Permissions</h2>
<form method="post" action="/api/permission">
<label>Mode <select name="mode">
<option value="read-only"${status.permissionMode === "read-only" ? " selected" : ""}>read-only</option>
<option value="ask"${status.permissionMode === "ask" ? " selected" : ""}>ask</option>
<option value="auto"${status.permissionMode === "auto" ? " selected" : ""}>auto</option>
</select></label>
<button type="submit">Save</button>
</form>
<h2>Kill switch</h2>
<form method="post" action="/api/stop">
<label><input type="checkbox" name="confirm" required> I understand this stops the dashboard server${status.browserChoice === "bridge-profile" ? " and closes the bridge Chrome" : " (your browser is left running)"}.</label><br>
<button type="submit">Stop bridge</button>
</form>
</body>
</html>
`;
};
