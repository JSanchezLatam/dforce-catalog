@AGENTS.md

## Claude Code

`AGENTS.md` above carries every convention for this repository and is imported,
not summarized. Do not duplicate any of it here — this file is only for rules
that apply to Claude Code and not to the other agents that read `AGENTS.md`.

### Delegation follows ODD

Superseded 2026-11-16: the earlier "all coding is delegated" rule (2026-09-05)
is replaced by gentle-ai's ODD routing — write inline by default, delegate a
writer only for a named reason (parallel units owning DISJOINT files, or the
long-session backstop). When a writer is delegated, its prompt carries the
"Lessons every writer carries" from `AGENTS.md`. A subagent's report never
reaches the owner — relay what matters, and verify it rather than repeating
it.
