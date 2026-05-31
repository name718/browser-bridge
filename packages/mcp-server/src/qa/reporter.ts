import { type QaRunResult } from "./types.js";

export function renderMarkdown(result: QaRunResult): string {
  const lines: string[] = [];
  const { summary } = result;

  lines.push(`# ${summary.title}`);
  lines.push("");
  lines.push("## 结论");
  lines.push("");
  lines.push(`- 结果：${result.ok ? "通过" : "未通过"}`);
  lines.push(`- 用例：共 ${summary.total} 条，通过 ${summary.passed}，失败 ${summary.failed}，阻塞 ${summary.blocked}`);
  lines.push(`- 风险：${summary.risk}`);
  lines.push(`- 耗时：${summary.elapsedMs}ms`);
  lines.push(`- 开始：${summary.startedAt}`);
  lines.push(`- 结束：${summary.finishedAt}`);
  lines.push("");
  lines.push("## 产物");
  lines.push("");
  lines.push(`- Summary：${result.paths.summary}`);
  lines.push(`- Replay：${result.paths.replay}`);
  lines.push(`- Cases：${result.paths.casesDir}`);
  lines.push(`- Screenshots：${result.paths.screenshotsDir}`);
  lines.push(`- Logs：${result.paths.logsDir}`);
  lines.push("");
  lines.push("## 用例结果");
  lines.push("");

  for (const testCase of result.cases) {
    lines.push(`### ${statusLabel(testCase.status)} ${testCase.title}`);
    lines.push("");
    lines.push(`- ID：${testCase.id}`);
    lines.push(`- 优先级：${testCase.priority}`);
    lines.push(`- 状态：${testCase.status}`);
    lines.push(`- 耗时：${testCase.elapsedMs}ms`);
    if (testCase.expected.length) {
      lines.push(`- 预期：${testCase.expected.join("；")}`);
    }
    if (testCase.error) {
      lines.push(`- 错误：${testCase.error.code}: ${testCase.error.message}`);
    }
    if (testCase.artifacts.screenshot?.path) {
      lines.push(`- 截图：${testCase.artifacts.screenshot.path}`);
    }
    if (testCase.artifacts.console) {
      lines.push(`- Console：${testCase.artifacts.console}`);
    }
    if (testCase.artifacts.network) {
      lines.push(`- Network：${testCase.artifacts.network}`);
    }
    lines.push("");
    lines.push("复现步骤：");
    lines.push("");
    testCase.steps.forEach((step, index) => {
      lines.push(`${index + 1}. ${describeStep(step)}`);
    });
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

export function renderHtml(result: QaRunResult): string {
  const body = renderMarkdown(result)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(result.summary.title)}</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f8fa; color: #1f2937; }
    main { max-width: 1040px; margin: 0 auto; padding: 32px 20px; }
    pre { white-space: pre-wrap; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; line-height: 1.6; }
  </style>
</head>
<body>
  <main>
    <pre>${body}</pre>
  </main>
</body>
</html>
`;
}

function statusLabel(status: string): string {
  if (status === "passed") return "通过";
  if (status === "failed") return "失败";
  return "阻塞";
}

function describeStep(step: Record<string, unknown>): string {
  const action = String(step.action ?? "step");
  const target = step.text ?? step.query ?? step.placeholder ?? step.ariaLabel ?? step.selector ?? step.url;
  const value = step.value ? `，输入 ${String(step.value)}` : "";
  const contains = step.contains ? `，断言 ${String(step.contains)}` : "";
  return `${action}${target ? `：${String(target)}` : ""}${value}${contains}`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
