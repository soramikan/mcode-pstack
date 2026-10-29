---
name: arena
description: "Spawn N parallel candidates at the same task, pick a base, graft the strongest parts of the losers into it. Use for /pstack:arena, 'arena this', 'throw it in the arena', or when one attempt at a non-trivial artifact would lock in the wrong shape."
disable-model-invocation: true
---

# Arena

Open the parent's todowrite list with one entry per phase (Frame, Fan out, Cross-judge, Pick, Graft, Verify) before launching anything.

## Phase A: Frame

Every candidate gets the same prompt, so the prompt is the contract.

1. State the artifact each candidate is producing.
2. Derive the rubric, 3-6 concrete gradeable criteria for what success looks like on *this* task. It is the picker's tool in Phase D. Candidates only see the task.
3. Pick runners from approved arena role selections. Use the dedicated pstack role configuration from `runtime/config.mjs`. Missing roles inherit-parent with unset effort. Only user-confirmed exact source-qualified model keys and separately confirmed effort may be passed. Do not manipulate suffixes or infer fallback choices from errors. Stop a rejected role and report it to the parent. Family checks require approved metadata; repeated seats on one model are not a multi-model panel. Require an explicitly declared candidate count; queue at maxWorkers (default 2). Missing model or effort metadata for a headless code candidate is BLOCKED before launch.
4. Give design-only candidates disjoint output paths in workspace `.pstack/runs/<run>/`. Code candidates require explicit user-approved git worktrees and opt-in `runtime/run-worker.mjs` headless execution with each process's real cwd bound to its worktree. Read runtime help and confirm exact model/effort metadata before launch. Native task shares cwd and cannot isolate competing code writers. Worktrees are isolation, not a security sandbox. Never grant full permissions automatically. If these conditions are unavailable, stop the code bakeoff as BLOCKED; offer sequential design-only alternatives.

## Phase B: Fan out

The parent launches or queues candidates within maxWorkers. Each brief includes the same task and grounding, its exclusive writable scope, actual cwd/isolation mode, and a short rationale naming alternatives considered and rejected. Native tasks may be used for disjoint design output only; code candidates use the explicitly approved headless worktree path.

If a candidate produces no output, record its dropout and missing rubric coverage. Do not turn absent output into a pass or silently shrink a required panel.

## Phase C: Cross-judge

Confirm every candidate writer has completed or stopped before cross-judging. Use one read-only judge only when user-approved parent and judge metadata prove different families and the exact judge role is available. No family inference from key prefixes and no model fallback. If metadata or a different family is unavailable, mark the cross-judge NOT_RUN and the missing independence explicitly. The parent may compare candidates, but cannot claim a required independent review passed. Give the judge the rubric and frozen candidate path labels, not instructions to modify them.

## Phase D: Pick a base

Read every candidate end to end before picking. Score each against the rubric criterion by criterion, not on holistic feel, and compare with the cross-judge when Phase C ran one. Agreement on the base confirms the pick. Disagreement means one of you is biased or the rubric was ambiguous. Read both rationales before deciding.

Pick the base a future maintainer can extend most easily without breaking invariants. When two feel tied, prefer the cleaner boundary or smaller API, per the Laziness Protocol.

## Phase E: Graft

Walk each losing candidate once more for what is worth porting into the base, usually one or two things per candidate, not most of it. Fold each graft in by hand, per the **redesign-from-first-principles** principle skill, so the result stays coherent under one mental model. Don't paste mechanically.

If the candidates converge on one shape, that is strong agreement. Note it and ship the consensus shape. No graft is needed. If they wildly diverge, Phase A was under-specified. Reframe and re-run rather than averaging the divergence.

## Phase F: Verify

Verify the synthesized artifact against every required rubric item and the real target, per the **prove-it-works** principle skill. Check coverage gaps, candidate dropouts, and cross-judge requirements explicitly. Any missing mandatory result is BLOCKED, not PASS; return to the relevant phase rather than papering over it.

## Outputs

One synthesized artifact, with a short synthesis note alongside naming the base and why, the cross-judge's verdict or that Phase C skipped the judge, each graft with its source candidate, what was rejected and why, any convergence or dropouts, and the verification result.


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
