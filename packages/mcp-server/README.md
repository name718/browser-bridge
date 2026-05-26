# @majuntao-1/browser-bridge-mcp-server

Browser Bridge 是一个「Chrome 插件 + 本地 MCP 服务」组合，用来让支持 MCP 的 AI 客户端操作你已经登录的真实 Chrome 浏览器。

它适合这些场景：

- 让 AI 读取已登录网页内容
- 让 AI 点击按钮、输入表单、滚动页面
- 截图、导出 PDF、读取页面可交互元素
- 分析前端页面、调试登录态页面、辅助回归测试

## 你需要安装两个部分

1. Chrome 插件：连接真实浏览器
2. MCP 服务：给 Claude Code、Codex、Cursor、Gemini CLI 等客户端调用

## 下载 Chrome 插件

当前插件暂未上架 Chrome Web Store，请下载 zip 后手动加载。

插件下载地址：

```text
https://github.com/name718/browser-bridge/blob/main/release/browser-bridge-extension-0.1.2.zip
```

安装步骤：

1. 下载并解压 `browser-bridge-extension-0.1.2.zip`
2. 打开 Chrome 地址栏：`chrome://extensions`
3. 开启右上角「开发者模式」
4. 点击「加载已解压的扩展程序」
5. 选择刚才解压出来的插件目录

## MCP 客户端配置

推荐直接用 `npx`，不需要提前全局安装：

```json
{
  "mcpServers": {
    "browser-bridge": {
      "command": "npx",
      "args": [
        "-y",
        "-p",
        "@majuntao-1/browser-bridge-mcp-server",
        "browser-bridge-mcp"
      ],
      "env": {
        "BROWSER_BRIDGE_PORT": "17321"
      }
    }
  }
}
```

如果你的环境禁止 `npx` 联网，可以先全局安装：

```bash
npm install -g @majuntao-1/browser-bridge-mcp-server --registry=https://registry.npmjs.org/
```

然后 MCP 配置改成：

```json
{
  "mcpServers": {
    "browser-bridge": {
      "command": "browser-bridge-mcp",
      "args": [],
      "env": {
        "BROWSER_BRIDGE_PORT": "17321"
      }
    }
  }
}
```

## 连接 Chrome 插件

MCP 服务首次被 AI 客户端调用时，会自动启动本地 daemon。默认桥接地址是：

```text
ws://127.0.0.1:17321
```

打开 Chrome 工具栏里的「浏览器桥接」插件，确认桥接地址为上面的地址，然后点击「保存并重连」。状态显示「已连接」后即可使用。

## 常用 MCP 工具

使用前先调用：

```text
browser_use
```

常用工具：

- `browser_status`：检查连接状态
- `browser_open_url`：打开网页
- `browser_get_page_model`：读取低 token 页面模型，包含标题结构、主要区域、可交互元素、表单、表格样例和页面消息。优先用它理解页面，避免直接拉取完整 HTML/DOM。
- `browser_get_page_text`：读取当前页面可见文本
- `browser_get_interactives`：获取可交互元素
- `browser_find_and_click`：查找并点击元素
- `browser_find_and_type`：查找并输入文本
- `browser_screenshot`：截图并返回图片
- `browser_pdf`：导出当前页面 PDF
- `browser_run_steps`：按步骤执行浏览器自动化
- `browser_cdp` / `browser_cdp_session`：执行 Chrome DevTools Protocol 调试命令

## 示例

让 AI 客户端执行：

```text
先调用 browser_use，然后打开 https://example.com，读取页面文本并截图。
```

典型流程：

```text
browser_use
browser_open_url
browser_get_page_model
browser_screenshot
```

## 注意事项

- 插件只连接本机地址 `127.0.0.1`。
- MCP 服务默认使用端口 `17320` 和 `17321`。
- 如果插件显示未连接，确认 MCP 客户端已经启动过 `browser-bridge-mcp`，并检查插件里的桥接地址。
- 如果端口冲突，可以通过环境变量设置：

```bash
BROWSER_BRIDGE_PORT=17322 BROWSER_BRIDGE_API_PORT=17323 browser-bridge-mcp
```

对应 Chrome 插件里填写：

```text
ws://127.0.0.1:17322
```

## 源码和插件包

源码仓库：

```text
https://github.com/name718/browser-bridge
```

Chrome 插件 zip：

```text
https://github.com/name718/browser-bridge/blob/main/release/browser-bridge-extension-0.1.2.zip
```
