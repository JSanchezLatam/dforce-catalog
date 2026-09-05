@AGENTS.md

## Claude Code

`AGENTS.md` above carries every convention for this repository and is imported,
not summarized. Do not duplicate any of it here — this file is only for rules
that apply to Claude Code and not to the other agents that read `AGENTS.md`.

### Coding work is delegated, and parallelised where the files are disjoint

Implementation is handed to subagents rather than written in the orchestrator
thread. Decided by the owner 2026-09-05.

Split a work unit across several agents only when they own DISJOINT files, and
say so in each prompt — one agent editing `schema.ts` and its fixtures while
another writes a new pure module is a clean split; two agents in the same file
is not.

Subagents do not inherit this repo's hard-won review lessons, so each prompt
must carry the ones that bite on its task. The recurring ones, every one of
which shipped a defect before it was written down:

- **Mutation-verify every fix** — revert it, confirm the test goes red BY NAME.
  A test that passes with the fix reverted is a placebo: repair it or delete it.
- **Never write a claim you have not checked**, and that includes types. A
  `count: number` over a string wire is a lying comment moved into the type
  system.
- **A mock more convenient than reality tests the mock, not the code.** Fixture
  shapes must match the wire; `await response.json()` makes every declared type
  a claim.
- **The injected-seam limit**: a green suite proves zero real-SQL coverage, so
  anything whose value is a `WHERE`, an `UPDATE` or a constraint needs an e2e
  row.

The orchestrator keeps what is not coding: reading state to decide, the gates,
GGA and its rounds, git and PR operations, spec and `tasks.md` judgement, and
anything needing the owner's decision. A subagent's report never reaches the
owner — relay what matters, and verify it rather than repeating it.
