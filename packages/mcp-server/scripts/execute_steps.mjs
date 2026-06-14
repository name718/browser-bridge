import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";

const packageDir = "/Users/didi/Desktop/my-project/browser-bridge-1/packages/mcp-server";
const serverPath = resolve(packageDir, "dist/index.js");

const steps = JSON.parse(fs.readFileSync("/Users/didi/Desktop/my-project/browser-bridge-1/test_steps.json", "utf8"));

const client = new Client({
  name: "browser-bridge-executor",
  version: "0.1.0"
});

const transport = new StdioClientTransport({
  command: "node",
  args: [serverPath],
  cwd: packageDir
});

try {
  await client.connect(transport);
  await client.callTool({ name: "browser_use", arguments: { use: true, trustAgentFully: true } });

  console.log("Executing browser_run_steps...");
  const result = await client.callTool({
    name: "browser_run_steps",
    arguments: { steps }
  });

  console.log("Result:", JSON.stringify(result, null, 2));

  if (result.isError) {
    console.log("Step failed, performing visual observe...");
    const observeResult = await client.callTool({
      name: "browser_visual_observe",
      arguments: {}
    });
    console.log("Visual Observe Result:", JSON.stringify(observeResult, null, 2));
    
    // If it failed, we might want to take a screenshot anyway
    const screenshotResult = await client.callTool({
      name: "browser_screenshot",
      arguments: {}
    });
    await saveScreenshot(screenshotResult, "failure.png");
  } else {
    // If successful, the last step was a screenshot, but browser_run_steps might return it differently
    // Let's take a final screenshot to be sure.
    const screenshotResult = await client.callTool({
      name: "browser_screenshot",
      arguments: {}
    });
    await saveScreenshot(screenshotResult, "success.png");
  }

} catch (error) {
  console.error("Error during execution:", error);
} finally {
  await transport.close();
}

async function saveScreenshot(result, filename) {
  const image = result.content?.find((item) => item.type === "image");
  if (!image?.data) {
    console.log("No screenshot data found in result");
    return;
  }
  const target = resolve("/Users/didi/Desktop/my-project/browser-bridge-1", filename);
  await writeFile(target, Buffer.from(image.data, "base64"));
  console.log(`Screenshot saved to: ${target}`);
}
