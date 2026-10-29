---
name: setup-pstack
description: Configure which models pstack uses per role and at what reasoning budget. Shows exposed model capabilities and saves approved role choices in dedicated pstack JSON configuration, inheriting the parent by default. Use for /pstack:setup-pstack, "configure pstack models", "pstack budget", or changing pstack's model choices.
---

# Setup pstack

Configure dedicated pstack role selections, never a global rule or general host configuration.

## Steps

### 1. Confirm scope and capabilities

Default every role to inherit-parent, omit effort, and use maxWorkers 2. Detect only actually exposed model capabilities. Ask the user for an exact source-qualified key when capability discovery is unavailable; do not probe model errors to build a catalog.

### 2. Load current state

Read dedicated pstack configuration through `runtime/config.mjs`. Precedence is defaults, explicit dataDir pstack configuration, project configuration, then explicit invocation choices. Preserve provenance. Do not read or change general host config, AGENTS.md, or global rules.

### 3. Show roles and confirm

Show each role's inherited or exact configured model, separate effort, approved family metadata when supplied, and provenance. Ask the user which roles to change with `ask_user`; children return this question to the parent. Budget labels never rewrite model names. Keep inheritance unless the user explicitly confirms another model and effort. Multiple identical seats are independent attempts, not model diversity.

### 4. Validate

Use the runtime configuration validation. Exact model keys have the shape `provider/model[#variant]`. Do not change max/xhigh/high/fast suffixes or silently choose a different model after rejection. Unknown family cannot satisfy a different-family review.

### 5. Save only approved dedicated choices

After explicit confirmation, use the runtime's confirmed setup API to save project `.pstack/config.json`, or `<dataDir>/pstack/config.json` only when the user explicitly supplied that dataDir and chose user scope. Keep model and effort as separate fields. Preserve unrelated pstack choices. Do not invent CLI flags; inspect the runtime help or exported API.

### 6. Confirm

Report the exact dedicated file, changed roles, provenance, and unset/inherited choices. Re-running setup changes only choices the user confirms.

### 7. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof (a `verify-*` skill, or an existing harness). If not, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with /pstack:create-verification-skill." On yes, invoke `/pstack:create-verification-skill` (resolves wherever pstack is installed: workspace, user, or plugin). On no, move on without pushing.

### 8. Offer a formal verification skill (optional)

Check whether the project already has a formal verification skill (a project skill that runs a model checker, a proof, or another verifier against the code). If not, offer once: "want a formal verification skill, so agents can prove a key property of your code holds in every case in scope, not only the cases tests reach? I can generate one with /pstack:create-formal-verification-skill." On yes, invoke `/pstack:create-formal-verification-skill` (resolves wherever pstack is installed: workspace, user, or plugin). On no, move on without pushing.


## MiniMax execution contract

Resolve the package root from this skill's absolute Location (`<package>/skills/<name>/SKILL.md`). Resolve bundled scripts and references from that root; never change the caller's cwd to the package. Invoke bundled skills as `/pstack:<name>` or `skill(name="pstack:<name>")`. Frontmatter names remain upstream names.

The parent owns `todowrite`, all delegation, questions, and synthesis. Native `task` accepts only `description` (separate from prompt, 1..50 Unicode characters), `prompt`, `agent_name`, and optional `model`, `effort`, `run_in_background`. Omit model and effort by default (inherit-parent). Use installed `poteto-agent` for scoped playbook implementation or an available general agent for investigation. A child cannot call task, task_append, todo tools, or ask_user. It reports BLOCKED and the smallest question to its parent instead. A child performs its bounded assignment itself; any additional skill workflow requiring delegation becomes a request to the parent, not recursive delegation.

Native tasks share the caller's workspace. Before fan-out the parent assigns disjoint writable paths or serializes writers. A branch name or output directory is not cwd isolation. maxWorkers defaults to 2; queue additional lanes without reducing required coverage. A task_append admission acknowledges queued work, not completion. Track its latest returned task ID and wait for terminal evidence before integrating. Confirm the old writer stopped before replacing it.

Honor host approval and permission gates over upstream autonomy language. No unapproved commit, push, rebase, force operation, merge, external send, tracker update, upload, paid operation, or deletion. Never grant full permissions automatically. In host Plan Mode only the canonical Plan file may be written; collect evidence read-only, and defer prototypes, logs, generated files, and implementation until execution is approved. Do not read or modify another task's Plan.

Use only capabilities actually exposed in this session. `deslop`, `control-ui`, `control-cli`, and `visualize` are not bundled. If neither the dependency nor an appropriate repo driver is available, mark that step NOT_RUN with its reason; never claim it passed. Use the available `skill-creator` capability for skill authoring only when present; otherwise report the authoring dependency unavailable. Missing mandatory validation means BLOCKED, never PASS or permission to merge.

Long-running playbooks execute a bounded turn by default, checkpointing remaining work for manual resume. Only a user-explicitly enabled host Goal may continue autonomously within its limits. The host `/loop` is reserved for CodeRabbit, not a pstack scheduler. Use a wake only when a native cron capability is exposed and the user approved that schedule. Without it, hand back a manual resume point. Do not build a daemon, cloud worker service, watcher-based wake bridge, or event subscription to imitate missing host facilities.

## Role model policy

Read only the dedicated pstack configuration through `runtime/config.mjs`. Defaults are inherit-parent, unset effort, and maxWorkers 2. Project choices live in `.pstack/config.json`; user choices require an explicitly supplied dataDir and live in `<dataDir>/pstack/config.json`. Do not read or change general host configuration, AGENTS.md, or global rules for setup.

A role may use only a user-confirmed exact source-qualified `provider/model[#variant]` key and separately confirmed effort. Do not alter model-name suffixes (max/xhigh/high/fast), infer availability from an error, pick a neighboring model, or silently fall back after rejection. Stop that role and report the unavailable selection to the parent. Family checks require user-approved family metadata for both parent and reviewer, never a name prefix. Unknown family means the different-family check did not run. Multiple seats on one model are independent attempts, not a multi-model panel. Explicitly label missing model diversity.
