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
- `hover`：悬停元素，适合头像菜单、下拉菜单。
- `type`：向输入框输入 `value`。
- `fillForm`：一次性填写多个表单字段。
- `clear`：清空输入框。
- `scroll`：滚动页面。
- `waitFor`：等待元素或文本出现。
- `pressKey`：发送按键，例如 `Enter`、`Escape`、`Tab`。
- `assertText`：断言页面出现指定文本。
- `getText`：读取页面可见文本。
- `snapshot`：读取页面文本和可操作元素。
- `screenshot`：截图，批量结果里只返回截图元信息。
- `sleep`：等待一段时间。

## 更快的浏览器操作方式

不要默认让 Agent 先读取完整 DOM 再自己分析。优先使用浏览器端查找能力，让插件直接在页面里匹配、排序和执行。

低 token 意图式操作：

```sh
pnpm --filter @browser-bridge/mcp-server smoke -- --tool browser_act --args '{"action":"click","target":"提交","role":"button","nearText":"订单信息","viewportOnly":true}'
```

输入文本：

```sh
pnpm --filter @browser-bridge/mcp-server smoke -- --tool browser_act --args '{"action":"type","target":"搜索","value":"订单号 123456","replace":true}'
```

`browser_act` 会优先在浏览器端查找和执行，只返回命中的控件摘要、置信度和执行结果。只有调试失败原因时，再使用 `browser_find`、`browser_get_interactives` 或 `browser_get_page_snapshot`。

快速获取可交互元素摘要：

```sh
pnpm --filter @browser-bridge/mcp-server smoke -- --tool browser_get_interactives --args '{"viewportOnly":true,"limit":50}'
```

在浏览器端查找元素：

```sh
pnpm --filter @browser-bridge/mcp-server smoke -- --tool browser_find --args '{"query":"退出登录","role":"button","limit":5}'
```

查找并点击：

```sh
pnpm --filter @browser-bridge/mcp-server smoke -- --tool browser_find_and_click --args '{"query":"退出登录","role":"button"}'
```

查找并输入：

```sh
pnpm --filter @browser-bridge/mcp-server smoke -- --tool browser_find_and_type --args '{"query":"搜索","text":"订单号 123456"}'
```

一次性填写表单：

```sh
pnpm --filter @browser-bridge/mcp-server smoke -- --tool browser_fill_form --args '{"fields":[{"query":"账号","value":"demo-user"},{"query":"密码","value":"demo-password"}],"timeoutMs":5000}'
```

悬停后点击下拉菜单：

```sh
pnpm --filter @browser-bridge/mcp-server smoke -- --tool browser_run_steps --args '{"steps":[{"action":"hover","query":"头像"},{"action":"click","query":"退出登录"}],"stopOnError":true,"screenshotOnError":true}'
```

提交后断言页面文本：

```sh
pnpm --filter @browser-bridge/mcp-server smoke -- --tool browser_run_steps --args '{"steps":[{"action":"click","query":"提交"},{"action":"assertText","text":"提交成功","timeoutMs":8000}],"stopOnError":true,"screenshotOnError":true}'
```

截图保存到指定文件：

```sh
pnpm --filter @browser-bridge/mcp-server smoke -- --tool browser_screenshot --args '{"format":"png"}' --out /tmp/browser-bridge.png
```

通过 MCP 工具直接保存截图到桌面：

```sh
pnpm --filter @browser-bridge/mcp-server smoke -- --tool browser_save_screenshot --args '{"filename":"cooper-page.png"}'
```

`browser_screenshot` 会返回 MCP image content，适合需要让支持图片内容的客户端直接查看截图。`browser_save_screenshot` 会把图片写入本地文件，只返回路径和元数据，适合避免大图 base64 占用模型上下文。`browser_run_steps` 中的 `screenshot` 步骤默认只返回截图元数据，不返回完整图片。

冒烟测试会通过 MCP 代理自动拉起 daemon。如果 daemon 已经在运行，会直接复用。
