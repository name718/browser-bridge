# Browser Bridge + Playwright 进化计划案

本计划旨在保留当前系统的 **“AI 语义驱动 + 真实环境插件”** 核心优势，同时吸纳 Playwright 在 **“执行稳定性”** 和 **“可观测性”** 方面的长处，提升自动化测试的成功率和调试效率。

---

## 核心目标
1.  **确定性执行**：引入动作就绪检查（Actionability Checks），消除因页面异步导致的误触。
2.  **语义化精准定位**：对标 Playwright 的 Locator 逻辑，优先使用 ARIA Role 和 Label 定位。
3.  **深度追踪（Trace）**：记录动作前后的现场，实现“所见即所得”的错误诊断。
4.  **环境韧性**：增强网络 Mock 的声明式能力，提供基础的脚本自愈。

---

## 阶段一：执行可靠性增强 (Actionability & Auto-waiting)
**目标**：解决“脚本跑太快”或“元素被遮挡”导致的随机失败。

- [ ] **Content Script 升级**：
    - 实现在点击/输入前的就绪检查：`isVisible`, `isEnabled`, `isNotOccluded` (使用 `elementFromPoint`)。
    - 增加隐式自动等待逻辑：动作执行前默认进行 500ms-2000ms 的轮询等待，直到元素满足 Actionable 状态。
- [ ] **Bridge 协议更新**：
    - 支持返回“动作失败原因”的详细元数据（如：元素被 `.loading-mask` 遮挡）。

## 阶段二：定位器逻辑重构 (Semantic Locators)
**目标**：像人类一样识别页面元素，减少对脆弱 CSS Selector 的依赖。

- [ ] **重构 `browser_find` 算法**：
    - 引入权重模型：`ARIA Role > Label > Text > Placeholder > Selector`。
    - 支持 Playwright 风格的复合查询（如：`button:has-text("提交")`）。
- [ ] **严格模式 (Strict Mode)**：
    - 当语义匹配到多个元素时，返回错误并罗列特征描述，而不是盲目点击第一个。
- [ ] **影子 DOM (Shadow DOM) 支持**：
    - 确保定位逻辑能穿透组件库常见的 Shadow Boundary。

## 阶段三：可观测性与诊断 (Action Trace)
**目标**：让 AI 和开发者能一眼看清“刚才发生了什么”。

- [ ] **动作轨迹记录**：
    - `runSteps` 在执行每个动作时捕获 **Before** 和 **After** 两个状态。
    - 在 Before 截图中通过坐标点自动绘制“动作指示红点”。
- [ ] **诊断报告升级**：
    - `replay-viewer.html` 支持时间轴模式，点击步骤可对比动作前后的页面差异。
    - 自动关联该步骤执行期间的 `Console` 报错和 `Network` 慢请求。

## 阶段四：网络与环境韧性 (Network & Self-healing)
**目标**：更强的 Mock 能力和更简单的脚本维护。

- [ ] **声明式网络路由**：
    - 在 Background Script 中维护全局 `Routing Table`。
    - 允许在一次测试 Run 开始前统一定义 Mock 规则（如：拦截所有 `*/api/v1/auth/*`）。
- [ ] **智能脚本自愈**：
    - 在 `browser_qa_replay` 中引入模糊匹配。如果记录的 ID 失效，自动尝试通过“上一次成功的文本内容 + 兄弟节点关系”寻找备选目标。

---

## 预期产出
1.  **成功率提升**：由于引入就绪检查，复杂单页应用（SPA）的测试成功率预计提升 30% 以上。
2.  **调试效率**：Trace 功能将使定位自动化失败原因的时间从“分钟级”降低到“秒级”。
3.  **AI 消耗降低**：更精准的语义定位减少了 AI 重复尝试和拉取 Snapshot 的 Token 消耗。
