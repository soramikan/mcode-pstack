---
name: poteto-help
description: Guides users through pstack setup, /pstack:poteto-mode, and picking the skill, playbook, or principle for a task. Type /pstack:poteto-help with a question.
disable-model-invocation: true
---

# Poteto help

Answer the user's question about pstack, hand them a prompt they can send, and link the file the answer came from. For a help question, don't start the work. The user asked how, and a pstack run spends real tokens, so let them send the prompt.

A message that asks for work, such as "use pstack to fix this bug", is not a help question. Read [`poteto-mode`](../poteto-mode/SKILL.md), do the work under it, and resolve its installed Location before proceeding.

This file maps questions to the skills and guide pages that hold the answers. Those files own the details. Read the file you route to before you quote it, and trust it when it disagrees with this map. The links here point into the installed plugin, which the user may not be able to open, so give the user the file's public copy: `https://github.com/cursor/plugins/blob/main/pstack/` followed by its path.

## Find out what they need

Infer the need from the message and the conversation. A named situation, such as "which skill reviews a PR?", goes straight to its section. If the need is still unclear, ask one multiple-choice question with these options, then answer only the section they pick:

- Get set up
- Start a task with `/pstack:poteto-mode`
- Pick a skill for a situation
- Fix a run that went wrong
- Make pstack my own

Check the state that changes the answer, and mention it only when it does:

- No dedicated pstack configuration means every role inherits the parent with effort unset. Setup is optional, not required to select defaults.
- No `verify-*` skill or other app harness in the project means agents have no scripted way to drive the app. Mention `/pstack:create-verification-skill` when the question is about proving a change works.
- No formal verification skill in the project means no property is checked past what tests reach. Mention `/pstack:create-formal-verification-skill` when the question is about a race, an invariant, or another case tests rarely hit. When one exists and the code it covers changed after the commit it records as last in sync, mention `/pstack:maintain-formal-verification-skill` if the question touches that code.

When the model rule is missing and it matters, ask whether the user wants to pick a model for each role and a reasoning budget now. It matters when the user is new, the question is about setup or cost, or the answer depends on which models run. Ask at most once per chat. If the need is also unclear, ask both questions together. Offer two choices:

- Now: give them `/pstack:setup-pstack` to type, and answer their question too.
- Later: answer their question, and add one line saying every role keeps its default model until they run `/pstack:setup-pstack`.

## Get set up

1. Ask the parent to use this repository's documented local installer, then confirm the installed manifest and skill catalog. Do not suggest another host's plugin commands.
2. Run `/pstack:setup-pstack` only to configure explicit per-role choices. It saves dedicated pstack JSON after confirmation and may offer project verification skills.
3. Start a task with `/pstack:poteto-mode`, a goal, and a falsifiable check.

Installing changes nothing until the user invokes a skill. Only `/pstack:setup-pstack` loads from the user's words. The [README](../../README.md) and [guide page 1](../../docs/guide/01-setup.md) have the details. Offer to word their first prompt with them, per [`references/prompting.md`](references/prompting.md).

If cost is the worry, say where the tokens go and how to spend fewer. pstack spends extra tokens on subagents and review panels. Rerun `/pstack:setup-pstack` and pick a smaller budget or cheaper models. A role set to `auto` or `inherit-parent` runs on the chat's model, which saves tokens when the chat runs on Auto or a cheaper model. A shorter panel list runs fewer subagents, one for each entry. Save `/pstack:poteto-mode` for work that needs rigor.

This package is an independent MiniMax Code port. Use `/pstack:<name>` or `skill(name="pstack:<name>")`; frontmatter names remain unprefixed. See the bundled [MiniMax harness](../../docs/harness/minimax-code.md) for actual boundaries.

Native tasks share the workspace. The parent owns delegation and questions. Model/effort inherit by default, external actions remain host-gated, and long runs are bounded unless the user explicitly enabled a host Goal.

## Start a task with `/pstack:poteto-mode`

`/pstack:poteto-mode` matches the task to a playbook, copies the playbook's steps into the todo list, and runs the other skills as the steps need them. A step it skips stays in the list as `skip: <reason>`. A good prompt states the goal and how to tell it's done. It doesn't list skills, because a hand-written sequence tends to drop or reorder steps the playbook would keep. Read [`references/prompting.md`](references/prompting.md) before you help word one. [Guide page 2](../../docs/guide/02-poteto-mode.md) has examples.

Invoke `/pstack:poteto-mode` at each new task, or load `skill(name="pstack:poteto-mode")` when the tool is exposed. Do not promise persistent mode UI or keyboard behavior. The parent supplies the full absolute SKILL.md path to `agent_name: "poteto-agent"` delegates; a missing path blocks that child.

## Pick a skill

The default answer is `/pstack:poteto-mode`, which runs most of the others when its steps need them. Name a skill directly when the user wants more or less of something than the playbook gives. Read the skill before you recommend it, and give one example prompt.

| The user wants to | Skill |
|---|---|
| Do any non-trivial task with rigor | [`/pstack:poteto-mode`](../poteto-mode/SKILL.md) |
| Check that the agent understood their goal and the problem before it starts | [`/pstack:in-your-own-words`](../in-your-own-words/SKILL.md) |
| Get a prompt rewritten deeper, not bigger, before sending it: what a top professional would add, their raw material and methods, and an outside check. It returns the prompt and doesn't do the task | [`/pstack:sharpen`](../sharpen/SKILL.md) |
| Know how code works now, or where new code should live | [`/pstack:how`](../how/SKILL.md) |
| Know why code is shaped this way, or where a number came from | [`/pstack:why`](../why/SKILL.md) |
| Understand a change or subsystem, explained plainly | [`/pstack:teach`](../teach/SKILL.md) |
| Catch up on their own recent work on a topic | [`/pstack:recall`](../recall/SKILL.md) |
| Catch up on what changed in this chat since their last message, in plain words and small visuals, with every item waiting on them listed and decidable from the reply alone | [`/pstack:ketchup`](../ketchup/SKILL.md) |
| Catch up like `/pstack:ketchup`, in a short subtitled video of slides, with the waiting calls as text under it | [`/pstack:ketchup-video`](../ketchup-video/SKILL.md) |
| Know what a small diff could break outside itself | [`/pstack:blast-radius`](../blast-radius/SKILL.md) |
| Settle types and module shape before code that crosses a function boundary | [`/pstack:architect`](../architect/SKILL.md) |
| Get several attempts at one brief, merged into the best one | [`/pstack:arena`](../arena/SKILL.md) |
| Run parallel checks over slices, or race workers, as bounded same-workspace agents | [`/pstack:swarm`](../swarm/SKILL.md) |
| Have different models review a diff and try to break it | [`/pstack:interrogate`](../interrogate/SKILL.md) |
| Fix a bug test-first when a cheap local test exists | [`/pstack:tdd`](../tdd/SKILL.md) |
| Apply TypeScript rules to `.ts` or `.tsx` work | [`/pstack:typescript-best-practices`](../typescript-best-practices/SKILL.md) |
| Strip comments before review, using a reviewer that didn't write them | [`/pstack:no-comments`](../no-comments/SKILL.md) |
| Clean AI tells out of prose | [`/pstack:unslop`](../unslop/SKILL.md) |
| Write docs, an RFC, a README, a PR description, or a commit message to a standard | [`/pstack:technical-writing`](../technical-writing/SKILL.md) |
| Hear the last reply again in plain words | [`/pstack:bro`](../bro/SKILL.md) |
| Give agents a scripted way to drive the app and prove behavior | [`/pstack:create-verification-skill`](../create-verification-skill/SKILL.md) |
| Bring a verification skill and its feature map back in line with the app | [`/pstack:maintain-verification-skill`](../maintain-verification-skill/SKILL.md) |
| Formally verify a race, invariant, or other property that tests rarely reach | [`/pstack:create-formal-verification-skill`](../create-formal-verification-skill/SKILL.md) |
| Bring a formal verification back in line after the code it covers changed, and learn whether a failure is drift or a bug | [`/pstack:maintain-formal-verification-skill`](../maintain-formal-verification-skill/SKILL.md) |
| Show a PM or designer what the user sees as a chart checked by a TLA+ model, with the shortest path to each state that breaks a rule | [`/pstack:statechart`](../statechart/SKILL.md) |
| Vet a performance number before reporting or acting on it | [`/pstack:benchmark-checklist`](../benchmark-checklist/SKILL.md) |
| Run a large or cross-cutting change, or one to review after stepping away | [`/pstack:figure-it-out`](../figure-it-out/SKILL.md) |
| Keep a decision log during a run, and review it afterward | [`/pstack:show-me-your-work`](../show-me-your-work/SKILL.md) |
| Pick a model for each role and a reasoning budget | [`/pstack:setup-pstack`](../setup-pstack/SKILL.md) |
| Turn their own working habits into a personal mode skill | [`/pstack:automate-me`](../automate-me/SKILL.md) |
| Turn what a finished task taught into skill edits | [`/pstack:reflect`](../reflect/SKILL.md) |
| Stop agents from repeating the same mistakes in this repo | [`/pstack:correct`](../correct/SKILL.md) |
| Unsupported Cursor/Grok webhook integration (reference only) | [`/pstack:make-bot-ui`](../make-bot-ui/SKILL.md) |
| Find their way around pstack | `/pstack:poteto-help` |

If a skill directory next to this one is missing from the table, read its frontmatter and route by its description. The `principle-*` directories are covered under principles below.

Close calls:

- `/pstack:how` explains what the code does. `/pstack:why` explains the reasons. `/pstack:teach` runs one or both and explains the result plainly.
- `/pstack:arena` gives every worker the same brief and merges the best parts. `/pstack:swarm` splits work into slices or a race and returns one report.
- `/pstack:architect` implements right after it settles the design. Add "with checkpoint" to review the design before it writes code.
- `/pstack:interrogate` reviews the diff. `/pstack:blast-radius` looks for breakage outside the diff and proves the one fact that makes the change safe.
- `/pstack:recall` rebuilds context across recent chats. `/pstack:ketchup` covers only this chat since the user's last message. Resuming one specific chat or branch is the Session pickup playbook.
- `/pstack:figure-it-out` designs one rigorous run. The Orchestrate playbook runs a program that spans days and many PRs. The Autonomous run playbook drives one task to a finish condition.

Not in pstack:

- `/deslop`, `control-cli`, and `control-ui` ship in the `cursor-team-kit` plugin.
- The host `/loop` is CodeRabbit-only, not pstack scheduling. Use available skill-creator for authoring, otherwise NOT_RUN.
- pstack has no `/orchestrate` skill. Orchestrate is a `/pstack:poteto-mode` playbook. If the slash menu shows `/orchestrate`, another plugin provides it.

## Playbooks and principles

Playbooks are step lists inside `/pstack:poteto-mode`, not skills, so they have no slash command. Inside `/pstack:poteto-mode`, describing the task picks one, and these phrases name one directly:

- "babysit this pr" or "check on pr 123" runs Babysit. It drives the PR to merge-ready and stops there. It doesn't merge unless the user asks to merge, land, or ship.
- "land the stack" runs Shipping.
- "take over this branch" runs Session pickup.
- "pause safely" runs Pause safely.
- "full autopilot on this queue" runs Autopilot-full. "autopilot, don't merge" runs Autopilot-stack.
- "run the eval playbook" runs Eval.

Explicitly invoke the pstack skill when routing matters. The Playbooks section of [`poteto-mode`](../poteto-mode/SKILL.md) lists every playbook and when it applies. [Guide page 6](../../docs/guide/06-verify-and-ship.md) covers opening, babysitting, and landing a PR.

pstack has no planning skill. Host Plan Mode permits only the canonical Plan write; no prototypes or logs. For work that spans phases or stacked PRs, asking `/pstack:poteto-mode` for a plan runs the [Multi-phase plan playbook](../poteto-mode/playbooks/multi-phase-plan.md), which writes the plan and doesn't implement it. For a design question, the Prototype playbook or `/pstack:architect` settles it in code first.

Principles are one-rule skills that `/pstack:poteto-mode` reads and cites in its replies. The user rarely invokes one. They steer with the names instead, as in "apply prove it works. show me the real output." Typing `/principle-<name>` still loads one on demand. [Guide page 8](../../docs/guide/08-principles.md) lists them.

## Fix a run that went wrong

| Symptom | Fix |
|---|---|
| The style stopped applying | Invoke `/pstack:poteto-mode` again for the new task; no persistent mode UI is promised. |
| A question got treated as the next step of the last task | Say "new task", or say the turn doesn't need the mode. |
| A new model choice had no effect | The rule from `/pstack:setup-pstack` applies to new chats. Start one. |
| Runs cost more than expected | See the cost paragraph under Get set up. |
| A skill didn't load on its own | Only `/pstack:setup-pstack` loads from the user's words. The others load when the user types them or when `/pstack:poteto-mode` runs them, and it doesn't run every skill. |
| Parallel agents overwrote each other | Native tasks share the workspace. Use disjoint writes or serialization; code bakeoffs need explicitly approved isolated headless worktrees. |
| Long work stopped | Resume manually from its checkpoint, or explicitly enable a bounded host Goal. Do not use host /loop for pstack. |
| The reply claims success from a green build | Ask for the real command, flow, stored value, or profile. That's the prove-it-works principle. |

For a run that drifts, [`references/prompting.md`](references/prompting.md) has one-line steers. [Guide page 10](../../docs/guide/10-recipes-and-pitfalls.md) has more pitfalls and the recipes worth copying.

## Make pstack my own

- [`/pstack:automate-me`](../automate-me/SKILL.md) drafts a personal mode skill from the user's own history, to use alongside `/pstack:poteto-mode`.
- [`/pstack:reflect`](../reflect/SKILL.md) after a session turns its lessons into skill edits the user approves.
- `/pstack:poteto-mode write a skill for <workflow>` runs the authoring playbook. The eval playbook tests a skill change blind.
- Fix a misbehaving skill in its own PR, not inside the feature work where it went wrong.

[Guide page 9](../../docs/guide/09-make-it-yours.md) covers each of these.

## Reply

Lead with the answer. Give at most one example prompt in a code block, adapted from [`references/recipes.md`](references/recipes.md) when one fits, then the link to that file. Keep it short unless the user asked for the whole map.


## MiniMax execution contract

Resolve the package root from this skill's absolute Location (`<package>/skills/<name>/SKILL.md`). Resolve bundled scripts and references from that root; never change the caller's cwd to the package. Invoke bundled skills as `/pstack:<name>` or `skill(name="pstack:<name>")`. Frontmatter names remain upstream names.

The parent owns `todowrite`, all delegation, questions, and synthesis. Native `task` accepts only `description` (separate from prompt, 1..50 Unicode characters), `prompt`, `agent_name`, and optional `model`, `effort`, `run_in_background`. Omit model and effort by default (inherit-parent). Use installed `poteto-agent` for scoped playbook implementation or an available general agent for investigation. A child cannot call task, task_append, todo tools, or ask_user. It reports BLOCKED and the smallest question to its parent instead. A child performs its bounded assignment itself; any additional skill workflow requiring delegation becomes a request to the parent, not recursive delegation.

Native tasks share the caller's workspace. Before fan-out the parent assigns disjoint writable paths or serializes writers. A branch name or output directory is not cwd isolation. maxWorkers defaults to 2; queue additional lanes without reducing required coverage. A task_append admission acknowledges queued work, not completion. Track its latest returned task ID and wait for terminal evidence before integrating. Confirm the old writer stopped before replacing it.

Honor host approval and permission gates over upstream autonomy language. No unapproved commit, push, rebase, force operation, merge, external send, tracker update, upload, paid operation, or deletion. Never grant full permissions automatically. In host Plan Mode only the canonical Plan file may be written; collect evidence read-only, and defer prototypes, logs, generated files, and implementation until execution is approved. Do not read or modify another task's Plan.

Use only capabilities actually exposed in this session. `deslop`, `control-ui`, `control-cli`, and `visualize` are not bundled. If neither the dependency nor an appropriate repo driver is available, mark that step NOT_RUN with its reason; never claim it passed. Use the available `skill-creator` capability for skill authoring only when present; otherwise report the authoring dependency unavailable. Missing mandatory validation means BLOCKED, never PASS or permission to merge.

Long-running playbooks execute a bounded turn by default, checkpointing remaining work for manual resume. Only a user-explicitly enabled host Goal may continue autonomously within its limits. The host `/loop` is reserved for CodeRabbit, not a pstack scheduler. Use a wake only when a native cron capability is exposed and the user approved that schedule. Without it, hand back a manual resume point. Do not build a daemon, cloud worker service, watcher-based wake bridge, or event subscription to imitate missing host facilities.
