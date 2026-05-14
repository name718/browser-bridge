import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(scriptDir, "..");
const serverPath = resolve(packageDir, "dist/index.js");

const requestedTool = readArg("--tool");

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
  write("tools", toolNames);

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

async function callAndWrite(name: string, args: Record<string, unknown>): Promise<void> {
  const result = await client.callTool({
    name,
    arguments: args
  });

  write(name, result);
}

function write(label: string, value: unknown): void {
  process.stdout.write(`\n## ${label}\n`);
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

function readJsonArg(name: string): Record<string, unknown> | undefined {
  const value = readArg(name);
  if (!value) {
    return undefined;
  }

  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

