# Browser Bridge

Browser Bridge connects local AI agents to the user's real Chrome browser through a Chrome extension and a local MCP server.

The extension keeps browser access inside Chrome. The MCP server exposes safe, structured tools for local agents such as Claude Code, Codex, and Gemini CLI.

## Packages

- `packages/shared`: shared protocol and type definitions.
- `packages/mcp-server`: local MCP server and WebSocket bridge.
- `packages/extension`: Chrome extension.

## MVP Scope

- Read browser connection status.
- Read the active tab.
- Read page text and structured page snapshots.
- Click page elements by `elementId`, selector, or text.

High-risk capabilities such as arbitrary JavaScript execution, cookie access, and network interception are intentionally out of scope for the MVP.

## Development

Use Node.js 18.12 or newer. This project was verified with Node.js 22.22.1.

Install dependencies:

```sh
pnpm install
```

Run type checks:

```sh
pnpm typecheck
```

Build all packages:

```sh
pnpm build
```

Start the MCP server:

```sh
pnpm dev:server
```

The local WebSocket bridge listens on `127.0.0.1:17321`.

## Loading the Chrome Extension

1. Run `pnpm build`.
2. Open `chrome://extensions`.
3. Enable Developer Mode.
4. Click Load unpacked.
5. Select `packages/extension/dist`.

After the extension is loaded, start the MCP server and open the extension popup to confirm the bridge status.
