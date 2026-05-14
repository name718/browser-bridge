# 浏览器桥接

浏览器桥接通过 Chrome 插件和本地 MCP 服务，把本地 AI 代理连接到用户真实 Chrome 浏览器。

插件负责保留浏览器访问权限，MCP 服务负责向 Claude Code、Codex、Gemini CLI 等本地代理暴露安全、结构化的浏览器工具。

## 包结构

- `packages/shared`：共享协议和类型定义。
- `packages/mcp-server`：本地 MCP 服务和 WebSocket 桥接服务。
- `packages/extension`：Chrome 插件。

## 最小可用范围

- 读取浏览器连接状态。
- 读取当前活动标签页。
- 读取页面文本和结构化页面快照。
- 读取当前选中文本和页面链接。
- 通过 `elementId`、选择器或文本点击页面元素。
- 截取当前可视区域截图。
- 查看最近的浏览器操作审计日志。

暂不支持任意 JavaScript 执行、Cookie 读取、网络拦截等高风险能力。

## 开发

需要 Node.js 18.12 或更高版本。本项目已用 Node.js 22.22.1 验证。

安装依赖：

```sh
pnpm install
```

执行类型检查：

```sh
pnpm typecheck
```

构建所有包：

```sh
pnpm build
```

启动 MCP 服务：

```sh
pnpm dev:server
```

本地 WebSocket 桥接服务监听 `127.0.0.1:17321`。

执行本地 MCP 冒烟测试：

```sh
pnpm smoke
```

## 加载 Chrome 插件

1. 执行 `pnpm build`。
2. 打开 `chrome://extensions`。
3. 开启开发者模式。
4. 点击“加载已解压的扩展程序”。
5. 选择 `packages/extension/dist`。

插件加载后，启动 MCP 服务，并打开插件弹窗确认连接状态。

## MCP 接入

支持 JSON 配置的 MCP 客户端可以直接使用 [mcp.json](/Users/didi/Desktop/my-project/browser-bridge-1/mcp.json)。Codex、Claude、Gemini CLI 的配置说明见 [docs/mcp-setup.md](/Users/didi/Desktop/my-project/browser-bridge-1/docs/mcp-setup.md)。

## 安全

第一层安全机制支持在插件弹窗中配置域名允许列表、拒绝列表、截图开关和高风险点击确认。高风险确认会显示页面内浮层，最近操作会写入审计日志。详情见 [docs/security.md](/Users/didi/Desktop/my-project/browser-bridge-1/docs/security.md)。
