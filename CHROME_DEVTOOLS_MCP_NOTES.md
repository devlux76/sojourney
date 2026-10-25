# Chrome DevTools MCP notes

Verified 2026-10-06 with installed `chrome-devtools-mcp` **1.10.1**, Bun **1.3.14**,
and Google Chrome. Recheck the installed help and source after upgrades.

## Codex inside VS Code

- Codex's VS Code extension reads MCP configuration from `~/.codex/config.toml`
  (or a trusted project's `.codex/config.toml`). VS Code's own user `mcp.json` is a
  separate configuration; a server registered there need not be available in Codex.
- Observed here: Chrome DevTools MCP was installed globally with Bun and present in
  VS Code's MCP settings, but absent from Codex's configuration. Only Babylon NME
  appeared in this chat's callable tools. Check both registration and a real protocol
  connection before describing the situation as lost access or a missing install.
- `codex mcp get chrome-devtools` confirms the saved configuration. It does not
  prove the running extension has loaded tools. Restart the Codex extension after
  adding the server, then inspect its MCP server list and the callable tools.
  [Official Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
  documents the configuration file and IDE extension restart.

## Verified launch and connection

The installed global package entrypoint is run explicitly through Bun, avoiding its
`node` shebang. The saved Codex entry uses this equivalent command (the CLI stored
absolute paths to these existing files):

```sh
bun ~/.bun/install/global/node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js \
  --executablePath /usr/bin/google-chrome --isolated \
  --no-usage-statistics --no-performance-crux
```

- `--isolated` launches a temporary browser profile. Headed is the MCP server's
  default; this setup does not depend on the previously opened browser at port 9222.
- An actual stdio MCP probe succeeded for `initialize`, `tools/list` and
  `tools/call` → `list_pages`: server `chrome_devtools`, version 1.10.1, protocol
  2025-06-18; **30 tools**, including console/network inspection, script evaluation,
  screenshots and performance traces; headed Chrome returned an `about:blank` page.
- In this restricted shell, browser startup and local socket access required the
  approved unsandboxed execution path. Sandbox-denied sockets made Vite misleadingly
  report every port as occupied, and Chrome failed with `setsockopt: Operation not
  permitted`. Those errors were environment restrictions, not occupied ports or an
  MCP installation failure.
- The package's separate `chrome-devtools` CLI defaults to headless when starting its
  daemon without connection options. Do not assume its defaults match the MCP server.
- Package installation, saved client configuration, loaded tool catalog and browser
  connection are distinct checks. This connection probe proves the server works;
  the extension must still reload its tool catalog.

## Browser evidence before connection repair

Earlier download and swim checks in this session used a temporary Bun CDP script
because the server was not registered with Codex. The project lead authorized that
fallback under Rule #4. Those checks are recorded in the current work ledger. Use
Chrome DevTools MCP for subsequent browser work once the extension loads it; do not
mistake the earlier CDP checks for MCP calls.


## Connected session and storage checks

After the extension reload, all 30 tools were exposed in this chat and an actual
list_pages call succeeded. MCP itself is available for subsequent browser work.
A local project navigation initially returned ERR_CONNECTION_REFUSED because the
dev server was no longer running; starting Vite recovered it. Check server reachability
separately from MCP availability.

Through evaluate_script in headed Chrome 154, a fresh localhost context reported
StorageManager quota 10 GiB, usage 0 and persisted false. Native
DecompressionStream('zstd') threw Unsupported compression format. A zstd-22 application
pack therefore needs a tested decoder; do not equate HTTP Content-Encoding support
with application archive support, or treat this one quota reading as a universal limit.

## Output path access after resuming

On 2026-10-06, evaluate_script's filePath rejected a path beneath this repository's
tools/.cache/shots as outside the MCP server's configured workspace roots. The
shell's writable roots and this server's roots are separate. Return evidence inline
and save it with the workspace tools; a script running successfully does not imply
that the MCP server can write its result to the repo. A page reload also discards
browser-only probes, so collect their output before editing Vite-watched source.
