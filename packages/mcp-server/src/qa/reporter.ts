import { type QaReplayFile, type QaRunResult } from "./types.js";

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
  const caseRows = result.cases.map((testCase) => `
    <article class="case ${testCase.status}">
      <header>
        <div>
          <strong>${escapeHtml(testCase.title)}</strong>
          <span>${escapeHtml(testCase.id)} · ${testCase.priority} · ${testCase.elapsedMs}ms</span>
        </div>
        <b>${statusLabel(testCase.status)}</b>
      </header>
      ${testCase.expected.length ? `<p class="expected">${escapeHtml(testCase.expected.join("；"))}</p>` : ""}
      ${testCase.error ? `<p class="error">${escapeHtml(`${testCase.error.code}: ${testCase.error.message}`)}</p>` : ""}
      <ol>${testCase.steps.map((step) => `<li>${escapeHtml(describeStep(step))}</li>`).join("")}</ol>
      <div class="artifacts">
        ${testCase.artifacts.screenshot?.path ? `<a href="${escapeHtml(relativePath(result.paths.runDir, testCase.artifacts.screenshot.path))}">截图</a>` : ""}
        ${testCase.artifacts.console ? `<a href="${escapeHtml(relativePath(result.paths.runDir, testCase.artifacts.console))}">Console</a>` : ""}
        ${testCase.artifacts.network ? `<a href="${escapeHtml(relativePath(result.paths.runDir, testCase.artifacts.network))}">Network</a>` : ""}
      </div>
    </article>
  `).join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(result.summary.title)}</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f8fa; color: #172033; }
    main { max-width: 1120px; margin: 0 auto; padding: 32px 20px; }
    h1 { margin: 0 0 18px; font-size: 28px; }
    .summary { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; margin-bottom: 22px; }
    .metric, .case { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; box-shadow: 0 8px 22px rgba(15,23,42,.06); }
    .metric { padding: 14px; }
    .metric span { display: block; color: #64748b; font-size: 12px; }
    .metric b { display: block; margin-top: 6px; font-size: 22px; }
    .paths { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; margin-bottom: 18px; }
    .paths a { margin-right: 14px; color: #2563eb; }
    .case { margin-bottom: 12px; padding: 16px; }
    .case header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
    .case header span { display: block; margin-top: 4px; color: #64748b; font-size: 12px; }
    .case.passed header b { color: #15803d; }
    .case.failed header b, .case.blocked header b { color: #b91c1c; }
    .expected { color: #334155; }
    .error { color: #b91c1c; background: #fef2f2; padding: 8px; border-radius: 6px; }
    ol { padding-left: 22px; color: #334155; }
    li { margin: 4px 0; }
    .artifacts a { display: inline-block; margin-right: 10px; color: #2563eb; }
    @media (max-width: 760px) { .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(result.summary.title)}</h1>
    <section class="summary">
      <div class="metric"><span>结果</span><b>${result.ok ? "通过" : "未通过"}</b></div>
      <div class="metric"><span>通过</span><b>${result.summary.passed}</b></div>
      <div class="metric"><span>失败</span><b>${result.summary.failed}</b></div>
      <div class="metric"><span>阻塞</span><b>${result.summary.blocked}</b></div>
      <div class="metric"><span>风险</span><b>${escapeHtml(result.summary.risk)}</b></div>
    </section>
    <section class="paths">
      <a href="report.md">Markdown 报告</a>
      <a href="replay.json">Replay JSON</a>
      <a href="replay-viewer.html">Replay Viewer</a>
      <a href="ci-summary.json">CI Summary</a>
    </section>
    ${caseRows}
  </main>
</body>
</html>
`;
}

export function renderReplayViewer(result: QaRunResult, replay: QaReplayFile): string {
  const data = JSON.stringify({ result, replay }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(result.summary.title)} Replay</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:#f8fafc; color:#172033; }
    main { display:grid; grid-template-columns:280px 1fr 360px; min-height:100vh; }
    aside, section { padding:18px; border-right:1px solid #e5e7eb; overflow:auto; }
    button { width:100%; text-align:left; border:1px solid #e5e7eb; background:#fff; border-radius:8px; padding:10px; margin-bottom:8px; cursor:pointer; }
    button.active { border-color:#2563eb; box-shadow:0 0 0 2px rgba(37,99,235,.15); }
    .step { background:#fff; border:1px solid #e5e7eb; border-radius:8px; padding:12px; margin-bottom:8px; }
    .detail { background:#fff; border:1px solid #e5e7eb; border-radius:8px; padding:14px; }
    img { max-width:100%; border-radius:8px; border:1px solid #e5e7eb; }
    pre { white-space:pre-wrap; word-break:break-word; background:#f1f5f9; padding:10px; border-radius:8px; }
    @media (max-width: 980px) { main { grid-template-columns:1fr; } aside, section { border-right:0; border-bottom:1px solid #e5e7eb; } }
  </style>
</head>
<body>
  <main>
    <aside><h2>Cases</h2><div id="cases"></div></aside>
    <section><h2>Steps</h2><div id="steps"></div></section>
    <section><h2>Detail</h2><div id="detail" class="detail"></div></section>
  </main>
  <script>
    const data = ${data};
    let currentCase = data.replay.cases[0]?.id;
    let currentStep = 0;
    const describe = ${describeStep.toString()};
    function render() {
      const cases = document.getElementById('cases');
      const steps = document.getElementById('steps');
      const detail = document.getElementById('detail');
      const selected = data.replay.cases.find(c => c.id === currentCase) || data.replay.cases[0];
      const resultCase = data.result.cases.find(c => c.id === selected?.id);
      cases.innerHTML = data.replay.cases.map(c => '<button class="' + (c.id === currentCase ? 'active' : '') + '" data-case="' + c.id + '">' + c.title + '</button>').join('');
      steps.innerHTML = (selected?.steps || []).map((s, i) => '<div class="step" data-step="' + i + '"><b>' + (i + 1) + '. ' + s.action + '</b><div>' + describe(s) + '</div></div>').join('');
      const step = selected?.steps?.[currentStep];
      const shot = resultCase?.artifacts?.screenshot?.path ? resultCase.artifacts.screenshot.path.split('/').slice(-2).join('/') : '';
      detail.innerHTML = '<h3>' + (selected?.title || '') + '</h3>' + (step ? '<pre>' + JSON.stringify(step, null, 2) + '</pre>' : '') + (shot ? '<img src="' + shot + '">' : '');
      cases.querySelectorAll('button').forEach(btn => btn.onclick = () => { currentCase = btn.dataset.case; currentStep = 0; render(); });
      steps.querySelectorAll('.step').forEach(el => el.onclick = () => { currentStep = Number(el.dataset.step || 0); render(); });
    }
    render();
  </script>
</body>
</html>
`;
}

export function renderCiSummary(result: QaRunResult): Record<string, unknown> {
  return {
    ok: result.ok,
    taskId: result.summary.taskId,
    title: result.summary.title,
    passed: result.summary.passed,
    failed: result.summary.failed,
    blocked: result.summary.blocked,
    total: result.summary.total,
    risk: result.summary.risk,
    reportHtml: result.paths.reportHtml,
    replay: result.paths.replay
  };
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

function relativePath(base: string, target: string | undefined): string {
  if (!target) return "";
  const marker = `${base}/`;
  return target.startsWith(marker) ? target.slice(marker.length) : target;
}
