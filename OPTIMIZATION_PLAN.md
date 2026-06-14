# Browser Bridge 核心优化与开发计划 (2024-2025)

本计划旨在解决 Browser Bridge 当前版本在代码维护性、运行性能、操作健壮性以及 AI 交互深度上的瓶颈。

---

## 路线图概览

| 阶段 | 目标 | 核心任务 | 预计周期 |
|---|---|---|---|
| **Phase 1** | **工程化与架构重构** | 拆分巨型文件、强化类型系统、建立自动化测试 | 2-3 周 |
| **Phase 2** | **性能与资源极致优化** | Debugger 连接池、Payload 压缩、预热机制 | 2-3 周 |
| **Phase 3** | **智能自愈与视觉增强** | 下沉式自愈策略、视觉指令引擎升级、多 Frame 优化 | 3-4 周 |
| **Phase 4** | **DX 与可观测性提升** | Session 管理器、录屏回放、诊断日志增强 | 2 周 |

---

## 详细任务说明

### Phase 1: 工程化与架构重构 (Maintenance & Scalability)
当前 \`background.ts\` 和 \`content.ts\` 均超过 3000 行，严重阻碍了功能的快速迭代。

1.  **文件解耦 (Decoupling)**:
    *   将 \`background.ts\` 拆分为：
        *   \`debugger-manager.ts\`: 专门管理 CDP 连接与调试域切换。
        *   \`task-orchestrator.ts\`: 负责 \`run_steps\` 和多工具调度。
        *   \`security-manager.ts\`: 权限、审计与高风险确认逻辑。
    *   将 \`content.ts\` 拆分为：
        *   \`dom-interactor.ts\`: 传统的 DOM 定位与操作。
        *   \`visual-engine.ts\`: 视觉坐标计算、AOM 树处理。
        *   \`form-engine.ts\`: (已存在) 进一步优化表单识别。
2.  **类型系统加固**:
    *   移除所有的 \`any\`，定义严格的工具参数 Zod Schema。
    *   在 MCP 协议层引入运行时校验，确保 Agent 传入的参数符合预期。

### Phase 2: 性能与资源极致优化 (Performance)
减少大模型交互时的延迟，降低宿主机的负载。

1.  **Debugger 连接池**:
    *   实现单 Tab 维持长连接模式，避免 \`attach/detach\` 导致的页面重绘和性能损耗。
    *   引入“最后使用时间”回收机制。
2.  **Payload 瘦身**:
    *   **图片压缩**: 在插件端集成轻量级图片处理，支持按需缩放 (Scale) 和质量 (Quality) 调整后再传输。
    *   **增量传输**: 针对 AXTree 等大型文本，考虑只传输变更部分（如果技术可行）。
3.  **连接预热**:
    *   当 Agent 第一次通过 \`browser_use\` 激活时，或者打开新 URL 时，提前注入 Content Script 和建立 CDP 握手。

### Phase 3: 智能自愈与视觉增强 (Intelligence)
让 Agent 的操作像真人一样健壮，不因微小的 DOM 变动而失败。

1.  **下沉式自愈策略 (Embedded Self-Healing)**:
    *   修改 \`browser_click\` 等基础工具：如果 \`ELEMENT_NOT_FOUND\`，自动触发视觉扫描，匹配文字坐标并执行操作。
    *   操作后自动验证：执行点击后，通过 AOM 树检测页面是否产生了弹窗或 URL 变化，判定操作是否成功。
2.  **视觉指令引擎 2.0**:
    *   利用更精密的启发式算法解析 \`visual_task\`。
    *   支持条件逻辑（例如：“如果左侧有复选框则勾选”）。
3.  **多 Frame 搜索优化**:
    *   缓存 Frame 拓扑结构，避免每次都全量广播消息。

### Phase 4: DX 与可观测性 (Observability)
让开发者和 Agent 都能更好地掌控浏览器状态。

1.  **Session 变量管理器**:
    *   增加 \`browser_list_vars\` 和 \`browser_delete_vars\`。
    *   支持变量在不同 Tab 间的同步和持久化配置。
2.  **增强型回放**:
    *   \`browser_run_steps\` 支持导出包含每步快照、网络请求、Console 日志的完整 Replay 包。
    *   失败时自动保存当前环境的“黑匣子”数据。

---

## 具体执行步骤

### 步骤 1：启动 Phase 1 重构 (当前首要任务)
- [ ] 在 \`packages/extension/src/background/\` 下创建目录结构：\`services/\`, \`handlers/\`, \`utils/\`。
- [ ] 将 CDP 相关逻辑迁移至 \`services/debugger.ts\`。
- [ ] 将工具分发逻辑 \`dispatchRequest\` 抽离到独立的 \`router.ts\`。

### 步骤 2：实现 Debugger 连接池
- [ ] 修改 \`withDebugger\` 函数，使其支持缓存 \`debuggee\` 句柄。
- [ ] 增加心跳监测，防止 CDP 连接断开。

### 步骤 3：增强自愈逻辑
- [ ] 在 \`content.ts\` 的 \`clickElement\` 中增加 \`fallback\` 逻辑。
- [ ] 完善 \`visual-engine\` 的坐标转换精度。

---

## 成功指标 (Success Metrics)
1.  **维护性**: 单个文件行数限制在 500 行以内。
2.  **成功率**: AI 自动化任务的单次执行成功率提升 20% 以上（尤其是在复杂 SPA 页面）。
3.  **响应耗时**: 连续 CDP 操作的平均延迟降低 30%。
