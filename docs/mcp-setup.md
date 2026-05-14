# MCP 接入说明

先构建项目：

```sh
pnpm build
```

Chrome 插件加载目录：

```text
/Users/didi/Desktop/my-project/browser-bridge-1/packages/extension/dist
```

## 插件桥接地址

当前架构分为两层：

- MCP 代理：Claude Code、Codex、Gemini CLI 调用的 stdio server，即 `dist/index.js`。
- 常驻 daemon：负责连接 Chrome 插件，并提供本地 HTTP API，即 `dist/daemon.js`。

MCP 代理会自动拉起 daemon。daemon 启动后会在日志里打印类似信息：

```json
{"bridgeUrl":"ws://127.0.0.1:17321","hint":"请在浏览器桥接插件中填写 ws://127.0.0.1:17321"}
```

打开 Chrome 工具栏里的“浏览器桥接”插件，把 `ws://127.0.0.1:17321` 填到“桥接地址”里，点击“保存并重连”。

插件会持久化保存这个地址，并自动重连。只要后续 MCP 服务仍使用同一个端口，就不需要重复配置。

插件内部使用 Chrome offscreen 隐藏页维持 WebSocket 连接，因此关闭插件弹窗后连接也应保持。

如果你希望手动提前启动 daemon，可以运行：

```sh
pnpm --filter @browser-bridge/mcp-server daemon
```

如果你希望某个 AI Agent 使用独立端口，可以启动 daemon 时设置：

```sh
BROWSER_BRIDGE_PORT=17322 BROWSER_BRIDGE_API_PORT=17323 node /Users/didi/Desktop/my-project/browser-bridge-1/packages/mcp-server/dist/daemon.js
```

然后在插件中填写：

```text
ws://127.0.0.1:17322
```

对应的 MCP 代理也需要设置相同环境变量：

```sh
BROWSER_BRIDGE_PORT=17322 BROWSER_BRIDGE_API_PORT=17323 node /Users/didi/Desktop/my-project/browser-bridge-1/packages/mcp-server/dist/index.js
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

查看审计日志：

```sh
pnpm --filter @browser-bridge/mcp-server smoke -- --tool browser_get_audit_log --args '{"limit":10}'
```

调用带参数的工具：

```sh
pnpm --filter @browser-bridge/mcp-server smoke -- --tool browser_screenshot --args '{"format":"png"}'
```

执行结构化浏览器步骤：

```sh
pnpm --filter @browser-bridge/mcp-server smoke -- --tool browser_run_steps --args '{"steps":[{"action":"open","url":"https://example.com"},{"action":"waitFor","text":"Example Domain","timeoutMs":5000},{"action":"getText"}],"stopOnError":true}'
```

`browser_run_steps` 支持的动作：

- `open`：打开 URL。
- `activateTab`：激活指定标签页。
- `click`：按 `target`、文本、选择器等点击元素。
- `type`：向输入框输入 `value`。
- `clear`：清空输入框。
- `scroll`：滚动页面。
- `waitFor`：等待元素或文本出现。
- `getText`：读取页面可见文本。
- `snapshot`：读取页面文本和可操作元素。
- `screenshot`：截图，批量结果里只返回截图元信息。
- `sleep`：等待一段时间。

截图保存到指定文件：

```sh
pnpm --filter @browser-bridge/mcp-server smoke -- --tool browser_screenshot --args '{"format":"png"}' --out /tmp/browser-bridge.png
```

冒烟测试会通过 MCP 代理自动拉起 daemon。如果 daemon 已经在运行，会直接复用。
