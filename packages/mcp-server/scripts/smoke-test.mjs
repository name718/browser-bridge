import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(scriptDir, "..");
const serverPath = resolve(packageDir, "dist/index.js");

const requestedTool = readArg("--tool");
const screenshotOut = readArg("--out");

const client = new Client({
  name: "browser-bridge-smoke-test",
  version: "0.1.0"
});

const transport = new StdioClientTransport({
  command: "node",
  args: [serverPath],
  cwd: packageDir,
  stderr: "pipe"
});

transport.stderr?.on("data", (chunk) => {
  process.stderr.write(chunk);
});

try {
  await client.connect(transport);

  const tools = await client.listTools();
  const toolNames = tools.tools.map((tool) => tool.name).sort();
  write("工具列表", toolNames);

  // 必须先激活
  await client.callTool({ name: "browser_use", arguments: {} });

  if (requestedTool) {
    await callAndWrite(requestedTool, readJsonArg("--args") ?? {});
  } else {
    await callAndWrite("browser_status", {});
    await callAndWrite("browser_get_active_tab", {});
    await callAndWrite("browser_get_page_snapshot", {});
  }
} finally {
  await transport.close();
}

async function callAndWrite(name, args) {
  const result = await client.callTool({
    name,
    arguments: args
  });

  if (name === "browser_screenshot") {
    await saveScreenshotContent(result, screenshotOut);
  }

  write(name, result);
}

async function saveScreenshotContent(result, outPath) {
  const image = result.content?.find((item) => item.type === "image");
  if (!image?.data) {
    return;
  }

  const ext = image.mimeType === "image/jpeg" ? "jpg" : "png";
  const target = outPath ?? resolve(
    tmpdir(),
    `browser-bridge-screenshot-${Date.now()}.${ext}`
  );
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, Buffer.from(image.data, "base64"));
  process.stdout.write(`\n截图已保存：${target}\n`);
}

function write(label, value) {
  process.stdout.write(`\n## ${label}\n`);
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

function readJsonArg(name) {
  const value = readArg(name);
  if (!value) {
    return undefined;
  }

  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${name} 必须是 JSON 对象`);
  }
  return parsed;
}
