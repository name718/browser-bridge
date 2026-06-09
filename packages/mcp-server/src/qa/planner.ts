import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename } from "node:path";
import { readText, safeName } from "./artifacts.js";
import { type QaCaseInput, type QaPlan, type QaPlanInput } from "./types.js";

const execFileAsync = promisify(execFile);

export type AgentGoalInput = {
  goal: string;
  baseUrl?: string;
  maxSteps?: number;
};

export type AgentObservation = {
  url: string;
  title: string;
  summary: string;
  axTree?: string;
};

export type PlannerState =
  | "idle"
  | "need_navigate"
  | "need_observe"
  | "need_fill_form"
  | "need_submit"
  | "need_verify"
  | "goal_achieved"
  | "stuck";

export type PlannerDecision = {
  thought: string;
  action: Record<string, unknown>;
  isDone: boolean;
};

/**
 * BrowserAgentPlanner — 确定性状态机
 *
 * 关键设计：Planner 不调用 LLM，而是基于页面观察和目标的确定性分析。
 * Claude Code 本身就是 LLM，Planner 由 Claude Code 通过 MCP 工具驱动。
 *
 * 如果未来确实需要 Planner 调用 LLM（处理完全开放式的任务），
 * 通过环境变量 BB_PLANNER_LLM_ENDPOINT 配置。
 */
export class BrowserAgentPlanner {
  private state: PlannerState = "idle";
  private steps: string[] = [];
  private observations: AgentObservation[] = [];
  private readonly maxSteps: number;

  constructor(
    private readonly goal: string,
    options: { maxSteps?: number } = {}
  ) {
    this.maxSteps = options.maxSteps ?? 10;
  }

  /**
   * 基于当前观察生成下一个动作
   *
   * 确定性状态机：不调用 LLM，使用规则引擎分析页面状态。
   */
  async nextStep(observation: AgentObservation): Promise<PlannerDecision> {
    this.observations.push(observation);
    const stepCount = this.observations.length;

    // 超过最大步数，强制结束
    if (stepCount > this.maxSteps) {
      return {
        thought: `已达到最大步数 ${this.maxSteps}，结束执行。`,
        action: { action: "screenshot" },
        isDone: true
      };
    }

    // 分析当前页面状态
    this.state = this.analyzeState(observation);

    switch (this.state) {
      case "need_navigate":
        return this.handleNavigate(observation);
      case "need_observe":
        return this.handleObserve(observation);
      case "need_fill_form":
        return this.handleFillForm(observation);
      case "need_submit":
        return this.handleSubmit(observation);
      case "need_verify":
        return this.handleVerify(observation);
      case "goal_achieved":
        return {
          thought: `目标「${this.goal}」已完成。`,
          action: { action: "screenshot" },
          isDone: true
        };
      case "stuck":
        return {
          thought: `无法确定下一步操作，建议使用视觉模式。`,
          action: { action: "screenshot" },
          isDone: true
        };
      default:
        return {
          thought: `当前状态未知，尝试获取页面模型。`,
          action: { action: "pageModel", visibleOnly: true },
          isDone: false
        };
    }
  }

  /**
   * 确定性状态分析
   */
  private analyzeState(obs: AgentObservation): PlannerState {
    const url = obs.url.toLowerCase();
    const title = obs.title.toLowerCase();
    const summary = obs.summary?.toLowerCase() ?? "";

    // 如果在空白页，需要导航
    if (url === "about:blank" || url === "") {
      return "need_navigate";
    }

    // 如果刚导航到新页面，需要观察
    if (this.observations.length <= 1) {
      return "need_observe";
    }

    // 如果页面有表单，可能需要填写
    if (
      summary.includes("表单") || summary.includes("form") ||
      summary.includes("输入") || summary.includes("input") ||
      summary.includes("登录") || summary.includes("login")
    ) {
      return "need_fill_form";
    }

    // 如果页面有提交按钮，可能需要提交
    if (
      summary.includes("提交") || summary.includes("submit") ||
      summary.includes("确认") || summary.includes("confirm")
    ) {
      return "need_submit";
    }

    // 如果页面有结果/数据，可能需要验证
    if (
      summary.includes("结果") || summary.includes("result") ||
      summary.includes("列表") || summary.includes("list") ||
      summary.includes("详情") || summary.includes("detail")
    ) {
      return "need_verify";
    }

    // 默认尝试观察
    return "need_observe";
  }

  private handleNavigate(obs: AgentObservation): PlannerDecision {
    // 从目标中提取可能的 URL 或搜索词
    const searchMatch = this.goal.match(/https?:\/\/[^\s]+/);
    if (searchMatch) {
      return {
        thought: `目标包含 URL，直接导航。`,
        action: { action: "open", url: searchMatch[0] },
        isDone: false
      };
    }

    // 默认使用搜索引擎
    return {
      thought: `在搜索引擎中搜索「${this.goal}」。`,
      action: { action: "open", url: `https://www.google.com/search?q=${encodeURIComponent(this.goal)}` },
      isDone: false
    };
  }

  private handleObserve(obs: AgentObservation): PlannerDecision {
    return {
      thought: `观察到当前页面为「${obs.title}」，URL 为 ${obs.url}。获取页面模型以理解内容。`,
      action: { action: "pageModel", visibleOnly: true, maxElements: 80 },
      isDone: false
    };
  }

  private handleFillForm(obs: AgentObservation): PlannerDecision {
    // 如果目标包含具体值，尝试填写
    const valueMatch = this.goal.match(/填写|输入|填入[：:]\s*(.+)/);
    if (valueMatch) {
      return {
        thought: `目标要求填写「${valueMatch[1]}」，尝试使用智能填表。`,
        action: { action: "fillForm", fields: [{ label: "搜索", value: valueMatch[1] }] },
        isDone: false
      };
    }

    return {
      thought: `页面有表单结构，获取表单模型以了解需要填写的字段。`,
      action: { action: "pageModel", visibleOnly: true, maxElements: 80 },
      isDone: false
    };
  }

  private handleSubmit(_obs: AgentObservation): PlannerDecision {
    return {
      thought: `尝试点击提交/确认按钮。`,
      action: { action: "click", semantic: "提交" },
      isDone: false
    };
  }

  private handleVerify(obs: AgentObservation): PlannerDecision {
    // 检查是否达成了目标
    const goalKeywords = this.goal.split(/\s+/).filter((w) => w.length > 1);
    const matched = goalKeywords.some((kw) =>
      obs.summary?.toLowerCase().includes(kw.toLowerCase())
    );

    if (matched) {
      return {
        thought: `页面内容与目标匹配，验证通过。`,
        action: { action: "screenshot" },
        isDone: true
      };
    }

    return {
      thought: `获取页面模型以验证结果。`,
      action: { action: "pageModel", visibleOnly: true, maxElements: 50 },
      isDone: false
    };
  }
}

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
