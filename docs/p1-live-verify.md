# P1 live verify — Edge + dashboard + launchd + Muse test

P1 was implemented and unit-tested on Linux, where there is no Edge, Chrome,
or macOS. **Nothing below was verified live on a Mac.** Run this checklist on
the MacBook Pro before treating P1 as done.

## What P1 includes

- `AI_BROWSER_BRIDGE_BROWSER=my-edge` (or `--browser my-edge`): attach to the
  user's own running Edge instead of launching a separate Chrome on the
  bridge profile. Chrome bridge-profile stays the default and the fallback.
- `bridge dashboard`: local-only dashboard on `http://127.0.0.1:8766`.
- `bridge daemon install/status/uninstall`: macOS launchd agent.
- On-demand reconnect: every `ask` / dashboard load re-reads
  `DevToolsActivePort`; there is no background poll.

## What P1 deliberately does NOT do

- No 30-second watchdog poll.
- No automatic fan-out to another provider when one hits its free limit.
  Each tab keeps its own conversation context; switching would lose it.
- No automatic queue resume after restart. Use the dashboard **Resume**
  button (or `bridge chrome start --browser my-edge --provider <name>`) to
  reopen the last provider tab by hand.

## 1. Edge attach

1. Open Edge, go to `edge://inspect/#remote-debugging`, enable
   **Allow remote debugging for this browser instance**.
2. `pnpm install && pnpm build`
3. `bridge status --browser my-edge --json` — expect `state: "ready"`,
   `canAttach: true`, `allowRequired: true`.
4. `bridge ask --browser my-edge --provider chatgpt "reply with pong" --json`
   — Edge asks **Allow** once; click it. Expect a reply, and a new bridge
   tab in Edge (your own tabs are untouched).
5. `bridge stop --browser my-edge` — expect "Disconnected. Your browser was
   left running". Verify Edge is still open with all your tabs.
6. `bridge status` (no flag) — still reports the bridge Chrome profile, so
   the fallback is intact.
7. Close Edge, run `bridge status --browser my-edge` — expect
   `chrome-not-running`. Reopen Edge without the toggle and expect
   `chrome-running-without-debug` with the `edge://inspect` hint.

## 2. Dashboard

1. `bridge dashboard --browser my-edge` — opens `http://127.0.0.1:8766`.
   Check: Edge status, provider, sessions, daemon state, MCP URLs.
2. Send one ask from the dashboard form with no confirm ticked — in `ask`
   mode it must refuse with "confirm this ask before sending".
3. Tick confirm, send again — expect a reply.
4. Click **Resume** — expect the provider tab to reopen in Edge (Allow
   click if Edge asks).
5. Kill switch: tick confirm, click **Stop bridge** — the dashboard must
   stop responding and the process must exit; Edge must stay open.
6. Confirm the dashboard is not reachable from another machine (it binds
   `127.0.0.1` only).

## 3. Daemon (launchd)

1. `bridge daemon install --browser my-edge` — expect installed + running,
   plist at `~/Library/LaunchAgents/com.ai-browser-bridge.plist`, log at
   `~/.ai-browser-bridge/daemon.log`.
2. Close the terminal completely, reopen it, `curl -s http://127.0.0.1:8766/api/status`
   — the dashboard must still answer.
3. `bridge daemon status` — running: yes.
4. `bridge daemon uninstall` — dashboard stops answering, plist is gone.

## 4. Muse test (experimental — no code was added for Muse)

Goal: find out whether this Muse chat can call the bridge's MCP tools.

1. Get a tunnel URL (it changes on every start):
   `bridge ask --tools "reply with pong" --json`
   Read the `Tunnel:` line (e.g. `https://xxx.trycloudflare.com`) — the
   connector URL is `<tunnel>/mcp`. The dashboard's MCP section shows the
   last tunnel URL from the latest session.
2. In Muse: Settings → Connectors → Add custom connector, remote streamable
   HTTP, paste `<tunnel>/mcp`, complete OAuth if prompted.
3. Expected if it works: Muse lists the `ask` and `search_conversations`
   tools and can call them.
4. If the Muse app has no custom-connector / MCP menu, that is the answer:
   remote MCP in the consumer app is **not confirmed**. Fallback is Muse
   Code on the Mac, which documents MCP directly — add to
   `~/.config/muse/settings.json`:
   ```json
   { "mcp_servers": { "ai-browser-bridge": { "transport": "streamable_http", "url": "<tunnel>/mcp" } } }
   ```
   then run `muse mcp login ai-browser-bridge` if OAuth is required and
   `/mcp` to list tools. The tunnel URL must be re-copied after every
   bridge restart.
