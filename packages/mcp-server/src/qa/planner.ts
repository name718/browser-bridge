import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename } from "node:path";
import { readText, safeName } from "./artifacts.js";
import { type QaCaseInput, type QaPlan, type QaPlanInput } from "./types.js";

const execFileAsync = promisify(execFile);

export async function createQaPlan(input: QaPlanInput): Promise<QaPlan> {
  const prdText = input.prdText ?? (input.prdPath ? await readText(input.prdPath).catch(() => "") : "");
  const changedFiles = await getChangedFiles(input.compareBranch, input.branch);
  const focus = input.focus?.filter(Boolean) ?? inferFocus(prdText, changedFiles);
  const taskId = safeName(input.taskId ?? input.title ?? focus[0] ?? "ai-qa-plan");
  const title = input.title ?? `AI QA Plan ${taskId}`;
  const scope = makeScope(focus, prdText, changedFiles);
  const regressionAreas = inferRegressionAreas(changedFiles, focus);
  const risks = makeRisks(focus, changedFiles, prdText);
  const cases = makeCases(input.baseUrl, focus, regressionAreas);

  return {
    taskId,
    title,
    baseUrl: input.baseUrl,
    scope,
    regressionAreas,
    risks,
    cases,
    sources: {
      prdPath: input.prdPath,
      branch: input.branch,
      compareBranch: input.compareBranch,
      changedFiles
    }
  };
}

async function getChangedFiles(compareBranch?: string, branch?: string): Promise<string[]> {
  const range = compareBranch && branch
    ? `${compareBranch}...${branch}`
    : compareBranch
      ? `${compareBranch}...HEAD`
      : undefined;
  const args = range ? ["diff", "--name-only", range] : ["diff", "--name-only", "HEAD"];
  try {
    const { stdout } = await execFileAsync("git", args, { cwd: process.cwd() });
    return stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function inferFocus(prdText: string, changedFiles: string[]): string[] {
  const candidates = new Set<string>();
  for (const keyword of ["登录", "注册", "订单", "退款", "支付", "搜索", "筛选", "导出", "上传", "审核", "权限", "表单", "列表", "详情"]) {
    if (prdText.includes(keyword)) candidates.add(keyword);
  }
  for (const file of changedFiles) {
    const name = basename(file).replace(/\.[^.]+$/, "");
    if (name && !["index", "types", "utils"].includes(name)) candidates.add(name);
  }
  return [...candidates].slice(0, 8);
}

function makeScope(focus: string[], prdText: string, changedFiles: string[]): string[] {
  const scope = focus.map((item) => `验证 ${item} 相关功能`);
  if (prdText) scope.push("覆盖 PRD 中的主流程、异常流程和验收条件");
  if (changedFiles.length) scope.push("覆盖代码变更关联模块的回归影响");
  return scope.length ? scope : ["执行用户提供的核心业务流程"];
}

function inferRegressionAreas(changedFiles: string[], focus: string[]): string[] {
  const areas = new Set<string>();
  for (const file of changedFiles) {
    if (/router|route|page|views?/i.test(file)) areas.add("页面路由和导航");
    if (/component|components|ui/i.test(file)) areas.add("共享组件展示与交互");
    if (/api|request|service|client/i.test(file)) areas.add("接口请求和异常处理");
    if (/store|state|redux|pinia|zustand/i.test(file)) areas.add("状态管理和数据刷新");
    if (/auth|permission|role/i.test(file)) areas.add("权限和角色访问");
    if (/form|validator|schema/i.test(file)) areas.add("表单校验和错误提示");
  }
  for (const item of focus) {
    if (/列表|搜索|筛选/.test(item)) areas.add("列表查询、筛选和分页");
    if (/订单|详情/.test(item)) areas.add("详情页数据展示");
    if (/退款|支付|审核/.test(item)) areas.add("状态流转和操作结果");
  }
  return [...areas];
}

function makeRisks(focus: string[], changedFiles: string[], prdText: string): QaPlan["risks"] {
  const risks: QaPlan["risks"] = [];
  if (/支付|退款|删除|审批|审核|权限/.test(`${focus.join(" ")} ${prdText}`)) {
    risks.push({ level: "P0", title: "高风险业务操作", reason: "涉及资金、审批、权限或破坏性动作，需要主流程和异常流程双覆盖" });
  }
  if (changedFiles.some((file) => /component|api|store|auth|permission/i.test(file))) {
    risks.push({ level: "P1", title: "共享模块回归", reason: "代码变更命中共享组件、接口、状态或权限模块" });
  }
  if (!risks.length) {
    risks.push({ level: "P2", title: "探索式风险", reason: "缺少明确高风险信号，建议先覆盖核心路径和页面基础状态" });
  }
  return risks;
}

function makeCases(baseUrl: string | undefined, focus: string[], regressionAreas: string[]): QaCaseInput[] {
  const startUrl = baseUrl || "about:blank";
  const mainTitle = focus.length ? `${focus[0]}主流程可完成` : "核心流程可完成";
  const cases: QaCaseInput[] = [
    {
      id: "main-flow",
      title: mainTitle,
      priority: "P0",
      type: "main",
      expected: ["页面核心流程可正常完成"],
      steps: [
        { action: "open", url: startUrl },
        { action: "pageModel", visibleOnly: true, maxElements: 80, maxTextLength: 3000 },
        { action: "screenshot" }
      ]
    },
    {
      id: "negative-form-validation",
      title: "异常输入和错误提示校验",
      priority: "P1",
      type: "negative",
      expected: ["页面对异常输入有明确提示"],
      steps: [
        { action: "open", url: startUrl },
        { action: "pageModel", visibleOnly: true, maxElements: 80, maxTextLength: 3000 }
      ]
    }
  ];

  regressionAreas.slice(0, 4).forEach((area, index) => {
    cases.push({
      id: safeName(`regression-${index + 1}-${area}`),
      title: `${area}回归验证`,
      priority: "P1",
      type: "regression",
      expected: [`${area}没有明显回归`],
      steps: [
        { action: "open", url: startUrl },
        { action: "pageModel", visibleOnly: true, maxElements: 120, maxTextLength: 5000 },
        { action: "screenshot" }
      ]
    });
  });

  return cases;
}
