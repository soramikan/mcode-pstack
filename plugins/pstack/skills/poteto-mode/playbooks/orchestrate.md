### Orchestrate

**You run the program, never the code. Decide which agent does each piece of work, then check what each one produces.** For a standing project handed to one coordinator chat: multi-day, many stacked PRs, dozens to hundreds of subagents, few human turns. One task driven to a predicate is Autonomous run. One ambitious run that needs a bespoke workflow is figure-it-out. Work that one agent could finish inside the session's budget is not a program.

Use native parent-owned task and a local run manifest under workspace `.pstack/runs/<run>/`. The parent owns all messages, delegation, questions, and integration. Execute one bounded turn by default, checkpointing unfinished work for manual resume. Continue autonomously only under a user-explicitly enabled host Goal and its limits. A native cron wake requires both an exposed capability and user-approved schedule; otherwise resume manually. Never use the host CodeRabbit-only `/loop` as a pstack scheduler, and do not create daemons, cloud services, or event subscriptions.

#### Topology

- **One owner per PR.** The owner is the only writer of its branch and carries the PR from build to merge. Only the owner pushes, rebases, or retargets it. Closing or retargeting a base PR orphans every PR above it, so the owner does that only on your call. You never author or edit code. Conflicted merges, chain rebases, and fixes go to owners.
- **A fresh worker for each independent task.** Give its consolidated goal, path ownership, prior evidence, and required checks. Native workers share the workspace. Disjoint writers or serialization are mandatory; there is no cloud VM option. Optional headless worktrees require explicit user opt-in and exact model/effort metadata.
- **One coordinator only.** The parent owns all delegation and queues at maxWorkers (default 2). Children never create sub-coordinators or further workers. Split large areas into bounded child assignments and integrate their reports yourself.
- **Continuation requires state.** Use parent-owned task_append only when the same work needs retained state. Admission is not completion; follow the latest task ID to its terminal report. A fresh brief is safer for independent work.
- **Each PR gets a parent-arranged verifier that did not author it.** A different-family claim requires user-approved metadata for both models; if unavailable, report that independent-family check NOT_RUN and do not pass a gate that requires it. A verifier pass is necessary evidence, never merge permission.
- **Start with one unit.** Take it through kickoff, owner, verifier, and merge before you fan out, so a flaw in the kickoff costs one agent instead of fifty. On near-identical cheap units, the first unit is that test.

#### Supervision

- **Each kickoff names the evidence that proves the work is done,** such as a command and its expected output, a control-skill check, or an artifact. It also names the goal, the paths the worker may and may not write, and the actions it must not take. If you can't name the evidence, the unit isn't scoped yet.
- **Read the diff or the artifact, not only the worker's summary.** Green CI is an input to a verdict, not a verdict. Behavioral work needs more than a type check. A verdict covers one head SHA, so a new push needs a new verdict. The parent reviews its own bounded briefs and required result matrix; there are no nested sub-coordinators.
- **Send back work that drifts from scope or grows past what was asked.** Keep only the fixes that block the program, and park the rest as follow-ups.
- **Check a PR's live state before you report on it,** with `gh pr view` and `gh pr checks` or your forge's equivalents, not the worker's last report. Account for every worker you spawned as done, replaced, or absorbed into another worker's scope.
- **Stop before replacement.** Judge progress from scoped diffs, artifacts, and task terminal state, not summary text. Retry with a smaller scope after limits or the same brief after a connection failure; never infer another model from a tool error. After two failed retries report the coverage gap and replan with the parent. Confirm an old writer stopped before replacement and quarantine late output until checked against current state.
- **Respect every user and host gate.** The parent asks real product decisions, missing permissions, and unresolved blockers. Reversible mechanics within the approved scope can proceed; git mutations, external actions, and merge do not gain authority from this playbook.

**Reply:** what landed against the goal, each PR's live state and verdict with its link, what was dropped and why, and the decisions waiting on the user.


## MiniMax execution contract

Resolve the package root from this skill's absolute Location (`<package>/skills/<name>/SKILL.md`). Resolve bundled scripts and references from that root; never change the caller's cwd to the package. Invoke bundled skills as `/pstack:<name>` or `skill(name="pstack:<name>")`. Frontmatter names remain upstream names.

The parent owns `todowrite`, all delegation, questions, and synthesis. Native `task` accepts only `description` (separate from prompt, 1..50 Unicode characters), `prompt`, `agent_name`, and optional `model`, `effort`, `run_in_background`. Omit model and effort by default (inherit-parent). Use installed `poteto-agent` for scoped playbook implementation or an available general agent for investigation. A child cannot call task, task_append, todo tools, or ask_user. It reports BLOCKED and the smallest question to its parent instead. A child performs its bounded assignment itself; any additional skill workflow requiring delegation becomes a request to the parent, not recursive delegation.

Native tasks share the caller's workspace. Before fan-out the parent assigns disjoint writable paths or serializes writers. A branch name or output directory is not cwd isolation. maxWorkers defaults to 2; queue additional lanes without reducing required coverage. A task_append admission acknowledges queued work, not completion. Track its latest returned task ID and wait for terminal evidence before integrating. Confirm the old writer stopped before replacing it.

Honor host approval and permission gates over upstream autonomy language. No unapproved commit, push, rebase, force operation, merge, external send, tracker update, upload, paid operation, or deletion. Never grant full permissions automatically. In host Plan Mode only the canonical Plan file may be written; collect evidence read-only, and defer prototypes, logs, generated files, and implementation until execution is approved. Do not read or modify another task's Plan.

Use only capabilities actually exposed in this session. `deslop`, `control-ui`, `control-cli`, and `visualize` are not bundled. If neither the dependency nor an appropriate repo driver is available, mark that step NOT_RUN with its reason; never claim it passed. Use the available `skill-creator` capability for skill authoring only when present; otherwise report the authoring dependency unavailable. Missing mandatory validation means BLOCKED, never PASS or permission to merge.

Long-running playbooks execute a bounded turn by default, checkpointing remaining work for manual resume. Only a user-explicitly enabled host Goal may continue autonomously within its limits. The host `/loop` is reserved for CodeRabbit, not a pstack scheduler. Use a wake only when a native cron capability is exposed and the user approved that schedule. Without it, hand back a manual resume point. Do not build a daemon, cloud worker service, watcher-based wake bridge, or event subscription to imitate missing host facilities.
