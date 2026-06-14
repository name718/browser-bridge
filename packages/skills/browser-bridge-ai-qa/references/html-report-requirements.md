# HTML Report Requirements

The final report must be a local HTML file that a human can open directly.

Required sections:
- Summary: project, PRD link, target URL, branch/baseline, run time, environment.
- Requirement summary: approved PRD interpretation.
- Impact summary: approved new and regression risk points.
- Case matrix: id, title, priority, type/tags, status, failure reason.
- Case details: semantic intent, executable steps, expected result, actual result.
- Screenshots: embed or link visible screenshots for every executed case.
- Console: error/warning/exception counts and representative messages for every case.
- Gaps: items not covered, blocked cases, unavailable observability such as missing continuous console capture.

Status rules:
- `passed`: required UI assertions passed and no failing console rule triggered.
- `failed`: assertion failed or configured console error/exception rule triggered.
- `blocked`: prerequisite, environment, auth, test data, or tool capability prevented execution.

Report must not include internal retry chatter or raw MCP debugging transcripts unless the user explicitly asks for diagnostic detail.
