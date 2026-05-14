# MCP Setup

Build the project first:

```sh
pnpm build
```

Load the Chrome extension from:

```text
/Users/didi/Desktop/my-project/browser-bridge-1/packages/extension/dist
```

## Generic MCP JSON

Use the repository `mcp.json` for MCP clients that accept JSON server config:

```json
{
  "mcpServers": {
    "browser-bridge": {
      "command": "node",
      "args": [
        "/Users/didi/Desktop/my-project/browser-bridge-1/packages/mcp-server/dist/index.js"
      ],
      "env": {
        "BROWSER_BRIDGE_PORT": "17321"
      }
    }
  }
}
```

## Claude Desktop Style

Add the same `mcpServers.browser-bridge` block to the Claude MCP config file.

## Codex Style

If the client uses TOML config, the equivalent server entry is:

```toml
[mcp_servers.browser-bridge]
type = "stdio"
command = "node"
args = ["/Users/didi/Desktop/my-project/browser-bridge-1/packages/mcp-server/dist/index.js"]
enabled = true

[mcp_servers.browser-bridge.env]
BROWSER_BRIDGE_PORT = "17321"
```

## Gemini CLI Style

If the client accepts MCP JSON, use the repository `mcp.json`. If it asks for command and args separately, use:

```text
command: node
args: /Users/didi/Desktop/my-project/browser-bridge-1/packages/mcp-server/dist/index.js
```

## Smoke Test

The smoke test starts the MCP server over stdio and calls tools through the MCP SDK. Keep Chrome open and the extension loaded before running it.

```sh
pnpm smoke
```

Call a single tool:

```sh
pnpm --filter @browser-bridge/mcp-server smoke -- --tool browser_status
```

Call a tool with arguments:

```sh
pnpm --filter @browser-bridge/mcp-server smoke -- --tool browser_screenshot --args '{"format":"png"}'
```

If another manually started MCP server is already listening on `127.0.0.1:17321`, stop it before running the smoke test.

