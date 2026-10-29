### Autonomous run

**You own the exit condition. Define done, verify each bounded iteration, and checkpoint unfinished work without relaxing the predicate.**

1. State the exit condition as a checkable predicate before the first iteration (tests green, repro fixed, all N PRs merged, pixel-diff zero).
2. Choose a bounded turn and explicit checkpoint. Execute one bounded turn by default, checkpointing unfinished work for manual resume. Continue autonomously only under a user-explicitly enabled host Goal and its limits. A native cron wake requires both an exposed capability and user-approved schedule; otherwise resume manually. Never use the host CodeRabbit-only `/loop` as a pstack scheduler, and do not create daemons, cloud services, or event subscriptions.
3. Each iteration makes the smallest change the evidence justifies, verifies it against the predicate, records the result, committing only if authorized, discards changes that didn't help. Belt-and-suspenders that "might help" gets reverted, not left to ride.
   Sequence the work via the **sequence-verifiable-units** principle skill, verifying each unit before the next instead of batching checks at the end.
4. Keep discoveries within the approved goal. Record unrelated fixes or broken-skill lessons as local proposals rather than automatically opening PRs or expanding scope. The parent asks genuine product/preference and approval questions with ask_user; children return them to the parent.
5. Checkpoint every iteration via the **show-me-your-work** skill, a row for what changed and whether the predicate moved.
6. Stop when the predicate is met, the authorized budget ends, a required capability is unavailable, or the user pauses. A plateau calls for a revised hypothesis within the budget, not endless execution. Report dead ends and a concrete manual resume point.

**Reply:** the exit condition, iterations run, what landed, what was discarded, final predicate state.


## MiniMax execution contract

Resolve the package root from this skill's absolute Location (`<package>/skills/<name>/SKILL.md`). Resolve bundled scripts and references from that root; never change the caller's cwd to the package. Invoke bundled skills as `/pstack:<name>` or `skill(name="pstack:<name>")`. Frontmatter names remain upstream names.

The parent owns `todowrite`, all delegation, questions, and synthesis. Native `task` accepts only `description` (separate from prompt, 1..50 Unicode characters), `prompt`, `agent_name`, and optional `model`, `effort`, `run_in_background`. Omit model and effort by default (inherit-parent). Use installed `poteto-agent` for scoped playbook implementation or an available general agent for investigation. A child cannot call task, task_append, todo tools, or ask_user. It reports BLOCKED and the smallest question to its parent instead. A child performs its bounded assignment itself; any additional skill workflow requiring delegation becomes a request to the parent, not recursive delegation.

Native tasks share the caller's workspace. Before fan-out the parent assigns disjoint writable paths or serializes writers. A branch name or output directory is not cwd isolation. maxWorkers defaults to 2; queue additional lanes without reducing required coverage. A task_append admission acknowledges queued work, not completion. Track its latest returned task ID and wait for terminal evidence before integrating. Confirm the old writer stopped before replacing it.

Honor host approval and permission gates over upstream autonomy language. No unapproved commit, push, rebase, force operation, merge, external send, tracker update, upload, paid operation, or deletion. Never grant full permissions automatically. In host Plan Mode only the canonical Plan file may be written; collect evidence read-only, and defer prototypes, logs, generated files, and implementation until execution is approved. Do not read or modify another task's Plan.

Use only capabilities actually exposed in this session. `deslop`, `control-ui`, `control-cli`, and `visualize` are not bundled. If neither the dependency nor an appropriate repo driver is available, mark that step NOT_RUN with its reason; never claim it passed. Use the available `skill-creator` capability for skill authoring only when present; otherwise report the authoring dependency unavailable. Missing mandatory validation means BLOCKED, never PASS or permission to merge.

Long-running playbooks execute a bounded turn by default, checkpointing remaining work for manual resume. Only a user-explicitly enabled host Goal may continue autonomously within its limits. The host `/loop` is reserved for CodeRabbit, not a pstack scheduler. Use a wake only when a native cron capability is exposed and the user approved that schedule. Without it, hand back a manual resume point. Do not build a daemon, cloud worker service, watcher-based wake bridge, or event subscription to imitate missing host facilities.
