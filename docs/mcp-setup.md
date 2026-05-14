# MCP 接入说明

先构建项目：

```sh
pnpm build
```

Chrome 插件加载目录：

```text
/Users/didi/Desktop/my-project/browser-bridge-1/packages/extension/dist
```

## 通用 MCP JSON 配置

如果 MCP 客户端支持 JSON 格式配置，可以使用仓库里的 `mcp.json`：

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

## Claude Desktop 配置

把上面的 `mcpServers.browser-bridge` 配置块加入 Claude 的 MCP 配置文件。

## Codex 配置

如果客户端使用 TOML 配置，对应写法如下：

```toml
[mcp_servers.browser-bridge]
type = "stdio"
command = "node"
args = ["/Users/didi/Desktop/my-project/browser-bridge-1/packages/mcp-server/dist/index.js"]
enabled = true

[mcp_servers.browser-bridge.env]
BROWSER_BRIDGE_PORT = "17321"
```

## Gemini CLI 配置

如果客户端支持 MCP JSON，直接使用仓库里的 `mcp.json`。如果需要分别填写命令和参数，使用：

```text
command: node
args: /Users/didi/Desktop/my-project/browser-bridge-1/packages/mcp-server/dist/index.js
```

## 冒烟测试

冒烟测试会通过 MCP SDK 启动 MCP 服务，并调用工具。运行前保持 Chrome 打开，并确认插件已加载。

```sh
pnpm smoke
```

只调用单个工具：

```sh
pnpm --filter @browser-bridge/mcp-server smoke -- --tool browser_status
```

调用带参数的工具：

```sh
pnpm --filter @browser-bridge/mcp-server smoke -- --tool browser_screenshot --args '{"format":"png"}'
```

截图保存到指定文件：

```sh
pnpm --filter @browser-bridge/mcp-server smoke -- --tool browser_screenshot --args '{"format":"png"}' --out /tmp/browser-bridge.png
```

如果你已经手动启动了 MCP 服务，并且它正在监听 `127.0.0.1:17321`，先停止旧进程再运行冒烟测试。
