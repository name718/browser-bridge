---
name: browser-bridge-ai-qa
description: Run staged AI QA for web features using Browser Bridge and Cooper PRD links. Use when the user wants an agent to analyze a Cooper PRD, assess frontend regression impact, generate human-readable semantic test cases, convert approved cases into Browser Bridge executable cases, operate the browser, capture screenshots and console errors, and produce an HTML QA report. Trigger on requests for AI page testing, regression testing, browser-bridge QA workflow, PRD-driven test cases, staged QA commands, or HTML reports with screenshots/console evidence.
---

# Browser Bridge AI QA

Use this skill to drive source-aware scripted QA. The default workflow is: analyze requirement and branch diff, generate semantic cases, convert them into executable Browser Bridge scripts, batch-run them with `browser_qa_run`, collect evidence, and produce an HTML report.

Before starting a scripted QA task, read `references/scripted-qa-workflow.md` and `references/workflow-state-format.md`, then follow them unless the user explicitly asks for a narrower phase.

## Core Rules

- Never proceed to the next phase without explicit user confirmation, even if the next step is obvious.
- Maintain `.browser-bridge/runs/{taskId}/workflow-state.json` for staged QA work. Update it at every phase transition and use it to resume after context loss.
- Do not skip phase gates. If the required previous confirmation is missing from `workflow-state.json`, stop and ask for confirmation instead of inferring approval.
- Treat Cooper PRD content as the requirement source. Use the Cooper skill / Cooper MCP for Cooper links and follow its connection prechecks when actually fetching the PRD.
- Present requirement analysis, impact analysis, and test cases in semantic Chinese that product, QA, and frontend engineers can review.
- Do not expose internal MCP/tool retries, low-level attempts, or debugging chatter to the user. Report user-relevant state only.
- Generate executable Browser Bridge scripts only after semantic test cases are approved.
- Use scripted batch execution through `browser_qa_run` by default. Do not manually operate the browser step-by-step unless scripted execution fails and exploration is needed to repair the script.
- Execute browser tests only after the user confirms the executable plan and browser authorization scope.
- Final output must be an HTML report containing case results, failure categories, screenshots, page-model evidence, console summaries, network summaries, and diagnostics links.
- If console/network/page-model capture is unavailable or incomplete, mark it clearly in the report and list it as a development gap.

## Command Workflow

Support these user-facing commands. If the user gives a free-form request, map it to the nearest command but keep the same confirmation gates.

1. `/browser-bridge_qa_init`
   Establish target URL, environment, branch/baseline, PRD link, auth assumptions, and report output path. Create or update `workflow-state.json`. Stop for confirmation.

2. `/browser-bridge_qa_fetch_prd`
   Fetch the Cooper PRD and summarize business goal, changed behavior, acceptance criteria, constraints, and unknowns. Stop for confirmation.

3. `/browser-bridge_qa_confirm_requirement`
   Apply user corrections to the requirement summary and mark `confirm_requirement` as confirmed in `workflow-state.json`. Do not analyze impact until confirmed.

4. `/browser-bridge_qa_analyze_impact`
   Inspect git diff and relevant code paths. Identify changed pages, routes, components, APIs, state, permissions, data dependencies, and likely old-feature regression points. Stop for confirmation.
   Read `references/scripted-qa-workflow.md` before doing branch/source analysis.

5. `/browser-bridge_qa_confirm_impact`
   Apply user corrections to the impact list and mark `confirm_impact` as confirmed. Do not generate cases until confirmed.

6. `/browser-bridge_qa_generate_semantic_cases`
   Generate semantic test cases only. Include new requirement coverage, regression cases, boundary/negative cases, permission/data-state cases, and smoke cases. Stop for human review.
   Read `references/semantic-case-format.md` before producing the cases.

7. `/browser-bridge_qa_confirm_cases`
   Apply user edits to semantic cases and mark `confirm_cases` as confirmed. Do not produce executable cases until confirmed.

8. `/browser-bridge_qa_generate_executable_cases`
   Convert approved semantic cases into Browser Bridge executable cases. Preserve traceability from semantic case id to executable steps. Stop for confirmation.
   Read `references/executable-case-format.md` before producing executable cases.

9. `/browser-bridge_qa_confirm_executable_cases`
   Apply user edits and mark `confirm_executable` as confirmed. Do not operate the browser until the user confirms execution.

10. `/browser-bridge_qa_run`
   Run approved cases through Browser Bridge scripted batch execution. Use `observe.onFailure: ["screenshot", "console", "network", "pageModel"]`, `observe.final: ["screenshot", "console"]`, `diagnostics.failOnConsoleError: true`, `diagnostics.failOnUncaughtException: true`, and `diagnostics.failOnNetworkError: true` unless the user explicitly lowers strictness. Stop with a concise run summary.

11. `/browser-bridge_qa_confirm_run_result`
   Let the user confirm whether reruns or case adjustments are needed. Mark `confirm_result` as confirmed only after the user accepts the run result. Do not finalize the report until confirmed.

12. `/browser-bridge_qa_report`
   Generate the final HTML report with screenshots and console information. Read `references/html-report-requirements.md` before reporting.

13. `/browser-bridge_qa_replay`
   Rerun selected failed/blocked cases only. Require confirmation for case ids and changed data assumptions.

`/browser-bridge_qa_full` is allowed only as an orchestrator. It still must pause at each review gate unless the user explicitly says `autoRun=true`; even then, browser operation still requires explicit authorization if credentials/session-sensitive pages are involved.

## Phase Output Contracts

For requirement analysis, output:
- `需求目标`
- `本次新增/变更行为`
- `验收标准`
- `页面/入口/角色/数据前置`
- `不确定点`
- `请确认是否进入影响面分析`

For impact analysis, output:
- `直接影响点`
- `间接/回归影响点`
- `高风险路径`
- `需要重点回归的老功能`
- `无法从代码确认的假设`
- `请确认是否生成语义化测试用例`

For semantic cases, output concise reviewable cases. Do not include raw selector-heavy steps.

For executable cases, output Browser Bridge-ready JSON. Use `locator` objects and include multiple stable locator hints where possible: `testId`, `label`, `role + text`, `placeholder`, `ariaLabel`, and only then `selector`.

For execution summaries, report:
- Passed / failed / blocked counts
- Failed case ids and user-facing failure reason
- Failure category for each failed/blocked case
- Screenshot and console evidence availability
- Network/page-model/diagnostics evidence availability
- Whether any console error/warning/exception was observed
- Whether any failed/slow network request was observed
- Next confirmation question

## Browser Bridge Execution Guidance

- Prefer `browser_qa_run` for scripted batch execution. Use lower-level `browser_*` tools only to inspect and repair scripts after a failed or blocked run.
- When operating authenticated/internal URLs, use the user's Chrome/session through Browser Bridge rather than unauthenticated generic browsing.
- If a tab appears open but Browser Bridge reports no URL/tab, avoid narrating raw tool failures. Reconcile state through status/list/observe tools, then tell the user only the actionable conclusion.
- Prefer locator-based executable steps over raw CSS selectors.
- Normal cases should not capture screenshots at every step. Capture final evidence and failure diagnostics by policy.
- Observe console errors/exceptions and network failures as pass/fail evidence. Warnings should be shown in the report but do not fail by default unless the case requires it.
- If a locator fails, use returned diagnostics/page model/candidate elements to repair the executable script, then rerun selected cases.

## Development Gaps To Track

If the local Browser Bridge implementation cannot provide these, list them in the report as gaps rather than pretending coverage exists:
- Continuous console monitoring for the whole case duration, not only post-step sampling.
- Per-step screenshot timeline embedded in the final report.
- Network request assertion and API-level failure attribution.
- Automatic visual diff against a baseline screenshot.
