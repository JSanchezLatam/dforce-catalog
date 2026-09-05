@AGENTS.md

## Claude Code

`AGENTS.md` above carries every convention for this repository and is imported,
not summarized. Do not duplicate any of it here — this file is only for rules
that apply to Claude Code and not to the other agents that read `AGENTS.md`.

### Coding work goes to the `code` agent

Every coding task — a feature, a bug fix, added tests, a refactor, applying
review findings — is delegated to the `code` subagent
(`.claude/agents/code.md`, Sonnet). Decided by the owner 2026-09-05.

The orchestrator still owns what is not coding: reading state to decide,
running the gates, GGA and its rounds, git and PR operations, spec and
`tasks.md` judgement, and anything needing the owner's decision.

`code.md` is not a summary of `AGENTS.md` — it carries only what repeated
review rounds proved was not obvious from it, chiefly: mutation-verify every
fix, never write a claim you have not checked, and a mock more convenient than
reality tests the mock rather than the code.
