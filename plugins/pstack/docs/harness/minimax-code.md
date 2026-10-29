# pstack on MiniMax Code

This independent port preserves upstream skill frontmatter and playbook reasoning while applying pinned, reviewable host patches before generation. Runtime invocation is `/pstack:<name>` or `skill(name="pstack:<name>")`. Use each skill's Location to resolve its package; do not change workspace cwd.

Native task delegation is parent-owned, same-workspace, and bounded to disjoint writers or serial execution. Task children cannot delegate, maintain parent todos, or ask users. Models and effort inherit unless the user explicitly configured a role's exact key. maxWorkers defaults to 2. Model-family diversity is never inferred from a model name.

`policies/execution.md`, `policies/models.md`, and `policies/history.md` are embedded where relevant during transformation, not a promise of host enforcement by prose. Host permission checks still apply. Code-candidate isolation requires approved worktrees and the opt-in headless runtime with a real cwd per candidate; it is not a sandbox.

Compatibility status describes portability and dependencies, not live acceptance. Missing drivers are NOT_RUN; missing mandatory checks block shipping. Long work defaults to one bounded turn and manual resumption. This port does not implement Cursor cloud agents, Custom Modes, automation webhooks, or a pstack scheduler. Benny and make-bot-ui are unsupported.

Approved reflection edits belong in repository skill-overrides with the pinned source hash and exact old/new text. Regenerate, validate, and explicitly reinstall. Never edit generated plugins or installation caches. Without source access, write a proposal under `.pstack/proposals`; an explicitly requested separate local skill uses `.minimax/skills/pstack-local-<name>/SKILL.md`, never shadows `pstack:`.
