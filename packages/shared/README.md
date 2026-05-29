# @majuntao-1/browser-bridge-shared

Browser Bridge 的共享协议类型包。

这个包主要给 `@majuntao-1/browser-bridge-mcp-server` 和 Chrome 插件内部使用，包含 MCP 服务与浏览器插件之间通信所需的 TypeScript 类型和协议定义。普通用户通常不需要单独安装它。

## 配套包

请直接使用 MCP 服务包：

```bash
npm install -g @majuntao-1/browser-bridge-mcp-server --registry=https://registry.npmjs.org/
```

或在 MCP 客户端中通过 `npx` 使用：

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

## Chrome 插件下载

Browser Bridge 需要同时安装 Chrome 插件和本地 MCP 服务。

插件包下载地址：

```text
https://github.com/name718/browser-bridge/raw/main/release/browser-bridge-extension-0.3.0.zip
```

下载后解压，在 Chrome 中打开 `chrome://extensions`，开启「开发者模式」，点击「加载已解压的扩展程序」，选择解压后的插件目录。

## 使用说明

完整使用方式请看 MCP 服务包：

```text
https://www.npmjs.com/package/@majuntao-1/browser-bridge-mcp-server
```
