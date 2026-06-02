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
      ${renderScreenshot(result.paths.runDir, testCase.artifacts.screenshot?.path)}
      ${renderConsoleSummary(testCase.artifacts.consoleSummary)}
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
    figure { margin: 14px 0; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; background: #f8fafc; }
    figure img { display: block; width: 100%; max-height: 520px; object-fit: contain; background: #fff; }
    figcaption { padding: 8px 10px; color: #64748b; font-size: 12px; border-top: 1px solid #e5e7eb; }
    .console { margin: 12px 0; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
    .console h4 { margin: 0; padding: 10px 12px; background: #f8fafc; font-size: 14px; }
    .console .counts { padding: 8px 12px; color: #334155; font-size: 13px; }
    .console pre { margin: 0; padding: 10px 12px; background: #111827; color: #e5e7eb; overflow: auto; max-height: 220px; }
    .console.failed h4 { color: #b91c1c; }
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
  <title>${escapeHtml(result.summary.title)} Trace Viewer</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:#f1f5f9; color:#1e293b; height: 100vh; overflow: hidden; }
    main { display:grid; grid-template-columns:320px 1fr; height: 100vh; }
    aside { border-right:1px solid #e2e8f0; background:#fff; display:flex; flex-direction:column; }
    .aside-header { padding: 16px; border-bottom: 1px solid #f1f5f9; }
    .aside-content { flex: 1; overflow-y: auto; padding: 12px; }
    .content { display: flex; flex-direction: column; overflow: hidden; background: #f8fafc; }
    .trace-container { flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 16px; overflow: hidden; }
    .trace-pane { display: flex; flex-direction: column; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); }
    .pane-header { padding: 8px 12px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 12px; font-weight: 600; color: #64748b; }
    .pane-content { flex: 1; overflow: auto; display: flex; align-items: flex-start; justify-content: center; background: #f1f5f9; position: relative; }
    .pane-content img { max-width: 100%; height: auto; }
    .action-marker { position: absolute; width: 24px; height: 24px; border: 3px solid #ef4444; border-radius: 50%; background: rgba(239, 68, 68, 0.2); transform: translate(-50%, -50%); pointer-events: none; box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.1); animation: pulse 2s infinite; }
    @keyframes pulse { 0% { transform: translate(-50%, -50%) scale(1); opacity: 1; } 50% { transform: translate(-50%, -50%) scale(1.4); opacity: 0.5; } 100% { transform: translate(-50%, -50%) scale(1); opacity: 1; } }
    
    .case-btn { width:100%; text-align:left; border:1px solid transparent; background:#fff; border-radius:6px; padding:12px; margin-bottom:8px; cursor:pointer; transition: all 0.2s; }
    .case-btn:hover { background: #f8fafc; }
    .case-btn.active { border-color:#2563eb; background: #eff6ff; color: #1e40af; }
    .step-item { padding: 10px 12px; border-radius: 6px; margin-bottom: 4px; cursor: pointer; font-size: 13px; border-left: 3px solid transparent; }
    .step-item:hover { background: #f1f5f9; }
    .step-item.active { background: #fff; border-left-color: #2563eb; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .step-num { font-weight: 700; color: #64748b; margin-right: 8px; }
    .inspector { height: 240px; border-top: 1px solid #e2e8f0; background: #fff; padding: 16px; overflow-y: auto; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; }
    .inspector h4 { margin-top: 0; margin-bottom: 8px; font-size: 14px; }
    pre { margin: 0; color: #334155; }
    .status-tag { font-size: 10px; padding: 2px 6px; border-radius: 4px; font-weight: 700; text-transform: uppercase; margin-left: 8px; }
    .status-passed { background: #dcfce7; color: #166534; }
    .status-failed { background: #fee2e2; color: #991b1b; }
  </style>
</head>
<body>
  <main>
    <aside>
      <div class="aside-header">
        <h3 style="margin:0; font-size:16px;">QA Trace Viewer</h3>
        <div id="case-selector" style="margin-top:12px;"></div>
      </div>
      <div class="aside-content" id="step-list"></div>
      <div class="inspector" id="inspector">
        <h4>Step Data</h4>
        <pre id="json-view">Select a step to see details</pre>
      </div>
    </aside>
    <div class="content">
      <div class="trace-container">
        <div class="trace-pane">
          <div class="pane-header">BEFORE ACTION</div>
          <div class="pane-content" id="before-view"></div>
        </div>
        <div class="trace-pane">
          <div class="pane-header">AFTER ACTION</div>
          <div class="pane-content" id="after-view"></div>
        </div>
      </div>
    </div>
  </main>
  <script>
    const data = ${data};
    let currentCaseId = data.replay.cases[0]?.id;
    let currentStepIdx = 0;

    function render() {
      const caseSelector = document.getElementById('case-selector');
      const stepList = document.getElementById('step-list');
      const beforeView = document.getElementById('before-view');
      const afterView = document.getElementById('after-view');
      const jsonView = document.getElementById('json-view');

      const selectedReplayCase = data.replay.cases.find(c => c.id === currentCaseId);
      const selectedResultCase = data.result.cases.find(c => c.id === currentCaseId);

      // Render Case Selector
      caseSelector.innerHTML = data.replay.cases.map(c => {
        const res = data.result.cases.find(rc => rc.id === c.id);
        const statusClass = res?.status === 'passed' ? 'status-passed' : 'status-failed';
        return \`<button class="case-btn \${c.id === currentCaseId ? 'active' : ''}" onclick="selectCase('\${c.id}')">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-weight:600;">\${c.title}</span>
            <span class="status-tag \${statusClass}">\${res?.status || 'PENDING'}</span>
          </div>
        </button>\`;
      }).join('');

      // Render Steps
      if (selectedReplayCase) {
        stepList.innerHTML = selectedReplayCase.steps.map((s, i) => {
          const resStep = selectedResultCase?.data?.results?.[i];
          const hasTrace = !!resStep?.data?.trace;
          return \`<div class="step-item \${i === currentStepIdx ? 'active' : ''}" onclick="selectStep(\${i})">
            <span class="step-num">\${i + 1}</span>
            <span>\${s.action} \${hasTrace ? '📸' : ''}</span>
            <div style="font-size:11px; color:#94a3b8; margin-top:2px;">\${s.text || s.selector || ''}</div>
          </div>\`;
        }).join('');

        const stepResult = selectedResultCase?.data?.results?.[currentStepIdx];
        const trace = stepResult?.data?.trace;

        jsonView.innerText = JSON.stringify({
          step: selectedReplayCase.steps[currentStepIdx],
          result: stepResult
        }, null, 2);

        if (trace?.before) {
          beforeView.innerHTML = \`<img src="\${trace.before.dataUrl}">\`;
          // If we have coordinates in result, draw a marker
          const target = stepResult?.data?.matched?.rect || stepResult?.data?.element?.rect;
          if (target) {
            const marker = document.createElement('div');
            marker.className = 'action-marker';
            marker.style.left = target.x + (target.width / 2) + 'px';
            marker.style.top = target.y + (target.height / 2) + 'px';
            beforeView.appendChild(marker);
          }
        } else {
          beforeView.innerHTML = '<div style="color:#94a3b8; padding:40px;">No before trace available</div>';
        }

        if (trace?.after) {
          afterView.innerHTML = \`<img src="\${trace.after.dataUrl}">\`;
        } else {
          afterView.innerHTML = '<div style="color:#94a3b8; padding:40px;">No after trace available</div>';
        }
      }
    }

    window.selectCase = (id) => { currentCaseId = id; currentStepIdx = 0; render(); };
    window.selectStep = (idx) => { currentStepIdx = idx; render(); };
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

function renderScreenshot(base: string, path: string | undefined): string {
  if (!path) return "";
  const src = escapeHtml(relativePath(base, path));
  return `<figure><img src="${src}" alt="测试截图"><figcaption>测试截图证据</figcaption></figure>`;
}

function renderConsoleSummary(summary: QaRunResult["cases"][number]["artifacts"]["consoleSummary"]): string {
  if (!summary) return "";
  const entries = summary.entries
    .slice(0, 8)
    .map((entry) => `[${entry.type}] ${entry.message}`)
    .join("\n");
  return `
    <section class="console ${summary.failed ? "failed" : ""}">
      <h4>Console 检查</h4>
      <div class="counts">error ${summary.errorCount} · warning ${summary.warningCount} · exception ${summary.exceptionCount}</div>
      ${entries ? `<pre>${escapeHtml(entries)}</pre>` : ""}
    </section>
  `;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function relativePath(base: string, target: string | undefined): string {
  if (!target) return "";
  const marker = `${base}/`;
  return target.startsWith(marker) ? target.slice(marker.length) : target;
}
