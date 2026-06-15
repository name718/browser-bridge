# Workflow State Format

Use this file format to persist Browser Bridge QA phase gates. Store it in the run directory as `workflow-state.json` whenever a staged QA workflow is started.

## Purpose

The state file prevents phase skipping and makes the workflow resumable after context loss.

The Agent must update this file at every phase transition and must not proceed to a phase unless the previous phase is marked `confirmed`.

## Phase Order

```text
init
  -> fetch_prd
  -> confirm_requirement
  -> analyze_impact
  -> confirm_impact
  -> generate_semantic_cases
  -> confirm_cases
  -> generate_executable_cases
  -> confirm_executable
  -> run
  -> confirm_result
  -> report
```

## JSON Schema Shape

```json
{
  "version": "1",
  "taskId": "refund-flow",
  "title": "退款流程 QA",
  "createdAt": "2026-06-15T00:00:00.000Z",
  "updatedAt": "2026-06-15T00:00:00.000Z",
  "currentPhase": "generate_semantic_cases",
  "phases": {
    "init": {
      "status": "confirmed",
      "confirmedAt": "2026-06-15T00:00:00.000Z",
      "summary": "测试环境、分支、PRD、权限假设已确认",
      "artifacts": {
        "runConfig": ".browser-bridge/runs/refund-flow/run-config.json"
      }
    },
    "fetch_prd": {
      "status": "confirmed",
      "summary": "PRD 已读取并完成需求摘要",
      "artifacts": {
        "requirementSummary": ".browser-bridge/runs/refund-flow/requirement-summary.json"
      }
    },
    "confirm_requirement": {
      "status": "confirmed",
      "confirmedBy": "user"
    },
    "analyze_impact": {
      "status": "confirmed",
      "artifacts": {
        "impactAnalysis": ".browser-bridge/runs/refund-flow/impact-analysis.json"
      }
    },
    "confirm_impact": {
      "status": "confirmed",
      "confirmedBy": "user"
    },
    "generate_semantic_cases": {
      "status": "pending",
      "artifacts": {}
    }
  },
  "inputs": {
    "baseUrl": "https://staging.example.com",
    "baseBranch": "master",
    "targetBranch": "feature/refund-flow",
    "prd": "Cooper URL or local path",
    "focus": ["退款申请", "订单列表回归"]
  },
  "assumptions": [
    "用户 Chrome 已具备测试环境登录态"
  ],
  "blockers": []
}
```

## Status Values

- `pending`: phase has not started.
- `in_progress`: phase is being produced.
- `awaiting_confirmation`: phase output is ready and waiting for user confirmation.
- `confirmed`: user explicitly approved the phase or the command was a confirmation command.
- `blocked`: phase cannot proceed without missing input or environment repair.

## Gate Rules

- `fetch_prd` requires `init.confirmed`.
- `analyze_impact` requires `confirm_requirement.confirmed`.
- `generate_semantic_cases` requires `confirm_impact.confirmed`.
- `generate_executable_cases` requires `confirm_cases.confirmed`.
- `run` requires `confirm_executable.confirmed`.
- `report` requires `confirm_result.confirmed`.

`/browser-bridge_qa_full autoRun=true` may continue through analysis and generation phases, but must still stop before browser operation unless the user explicitly authorizes the execution scope.

## Artifact Rules

When artifacts exist, store paths in the state file:

- `requirement-summary.json`
- `impact-analysis.json`
- `semantic-cases.json`
- `executable-cases.json`
- `run-config.json`
- `summary.json`
- `report.html`
- `ci-summary.json`

If a phase is regenerated, keep the latest artifact path and summarize what changed in `summary`.

