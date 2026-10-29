### Runtime forensics

**You own the diagnosis. Instrument the live process, don't theorize from source.** The deliverable is a cited diagnosis, not a fix.

1. Capture the live signal on the matching surface via the control skill: a CPU profile for a spinning process, a heap snapshot for a leak, a CDP trace for a visual glitch. A real artifact, not a guess.
2. Reduce the artifact to the smoking gun: the function on the hot path, the retainer chain from the leaked object to a GC root, the loop firing without input. Parse large artifacts in a subagent (the **guard-the-context-window** principle skill), keep the reduced finding in the main thread. Inherit model and effort unless the user explicitly configured that role; never change suffixes to select speed or reasoning.
3. Prove the mechanism before believing it. Inject instrumentation via CDP eval on the running process, or hotfix the live code without reloading, to confirm the hypothesis cheaply.
4. Map the finding back to source: file, symbol, the line that allocates or schedules.
5. Throughput checkpoint stays one line: `throughput checkpoint: n/a, read-only forensics`.

**Reply:** the signal captured, the reduced finding, how you proved the mechanism, the source location, artifact paths. No fix unless asked. Hand back to Bug fix or Perf once the cause is known.


## MiniMax execution contract

Resolve the package root from this skill's absolute Location (`<package>/skills/<name>/SKILL.md`). Resolve bundled scripts and references from that root; never change the caller's cwd to the package. Invoke bundled skills as `/pstack:<name>` or `skill(name="pstack:<name>")`. Frontmatter names remain upstream names.

The parent owns `todowrite`, all delegation, questions, and synthesis. Native `task` accepts only `description` (separate from prompt, 1..50 Unicode characters), `prompt`, `agent_name`, and optional `model`, `effort`, `run_in_background`. Omit model and effort by default (inherit-parent). Use installed `poteto-agent` for scoped playbook implementation or an available general agent for investigation. A child cannot call task, task_append, todo tools, or ask_user. It reports BLOCKED and the smallest question to its parent instead. A child performs its bounded assignment itself; any additional skill workflow requiring delegation becomes a request to the parent, not recursive delegation.

Native tasks share the caller's workspace. Before fan-out the parent assigns disjoint writable paths or serializes writers. A branch name or output directory is not cwd isolation. maxWorkers defaults to 2; queue additional lanes without reducing required coverage. A task_append admission acknowledges queued work, not completion. Track its latest returned task ID and wait for terminal evidence before integrating. Confirm the old writer stopped before replacing it.

Honor host approval and permission gates over upstream autonomy language. No unapproved commit, push, rebase, force operation, merge, external send, tracker update, upload, paid operation, or deletion. Never grant full permissions automatically. In host Plan Mode only the canonical Plan file may be written; collect evidence read-only, and defer prototypes, logs, generated files, and implementation until execution is approved. Do not read or modify another task's Plan.

Use only capabilities actually exposed in this session. `deslop`, `control-ui`, `control-cli`, and `visualize` are not bundled. If neither the dependency nor an appropriate repo driver is available, mark that step NOT_RUN with its reason; never claim it passed. Use the available `skill-creator` capability for skill authoring only when present; otherwise report the authoring dependency unavailable. Missing mandatory validation means BLOCKED, never PASS or permission to merge.

Long-running playbooks execute a bounded turn by default, checkpointing remaining work for manual resume. Only a user-explicitly enabled host Goal may continue autonomously within its limits. The host `/loop` is reserved for CodeRabbit, not a pstack scheduler. Use a wake only when a native cron capability is exposed and the user approved that schedule. Without it, hand back a manual resume point. Do not build a daemon, cloud worker service, watcher-based wake bridge, or event subscription to imitate missing host facilities.
