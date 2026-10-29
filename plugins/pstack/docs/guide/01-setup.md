# Set up pstack

In this page you install the plugin, pick which models pstack uses, and run your first task. Setup is one command plus a short conversation.

## Install the plugin

Use the port repository's documented local installer and confirm the generated MiniMax plugin manifest/catalog. Do not run upstream host installation commands. [MiniMax harness](../harness/minimax-code.md) describes capabilities and limits.

## Pick your models

Run:

```text
/pstack:setup-pstack
```

Setup shows dedicated pstack role choices and asks which exact source-qualified model keys and separate effort settings you explicitly want. It saves project `.pstack/config.json`, or `<dataDir>/pstack/config.json` only when you explicitly supply and choose that dataDir. No global host config, AGENTS, or rules changes.

Defaults are inherit-parent and unset effort, maxWorkers 2. Budget labels never alter model suffixes or choose another model. An unavailable configured role stops for a user choice; errors are not a model catalog.

Only explicit approved selections override inheritance. Show provenance before changing them. Re-running setup preserves unrelated role choices and never silently resets models.

The inherit-parent role omits native task model; effort stays unset unless explicitly approved. Panel seats are queued within maxWorkers, and repeated use of one model is labeled same-model attempts. Family diversity needs approved metadata, not a name prefix.

## Accept the verification offers, or don't

At the end of setup, `/pstack:setup-pstack` looks for a way to prove app behavior in your project, either a `verify-*` skill or an existing harness. If it finds neither, it offers once to generate one with [`/pstack:create-verification-skill`](../../skills/create-verification-skill/SKILL.md).

Say yes and it writes `.minimax/skills/verify-<app>/`, a project-local skill that teaches agents to drive your app the way a user does. It proves the skill works once before handing it over. Say no and setup moves on. You can run `/pstack:create-verification-skill` yourself any time. [Verify and ship](./06-verify-and-ship.md#create-a-project-verification-skill) covers it in depth.

If you're new to pstack, say yes. An agent that can check its own work keeps going until the check passes. An agent that can't hands every result back to you to check by hand. Of everything in this guide, the verification skill pays off the most.

Then setup offers once to generate a formal verification skill with [`/pstack:create-formal-verification-skill`](../../skills/create-formal-verification-skill/SKILL.md), unless the project already has one. Tests check the cases someone thought to write. A formal verification skill checks one key property of your code, such as "a job never runs twice at once", in every case within a stated scope. Say yes when your code has concurrency, retries, a state machine, or a parser, where a bug is costly and tests rarely reach the case that breaks. Otherwise say no, and run it later if that changes. [Verify and ship](./06-verify-and-ship.md#prove-a-property-with-a-formal-verification-skill) covers it.

Confirm the saved pstack path and role provenance before using the next delegate. No always-applied host rule is created.

## Keep the cost in check

pstack spends extra tokens on subagents and review panels. That's the price of the rigor. To spend fewer:

- Rerun `/pstack:setup-pstack` and pick a smaller reasoning budget or cheaper models. A strong model in the main chat with cheaper, faster models in the code roles is a good split.
- Set a role to `auto` or `inherit-parent` so it runs on the chat's own model.
- Shorten a panel list. Each entry runs one subagent.
- Save `/pstack:poteto-mode` for work that needs rigor. A small, obvious edit doesn't.

## Run your first task

Pick something real but small, and describe it the way you'd describe it to a colleague:

```text
/pstack:poteto-mode add a --json flag to this command. text output stays byte-identical. verify both.
```

Watch the todo list. Its first items are the matched playbook's steps copied in, the Feature playbook for this prompt. If `/pstack:poteto-mode` skips a step, the step stays in the list with `skip: <reason>`, so you can see what it chose not to do.

Use normal follow-ups within the same task. Invoke `/pstack:poteto-mode` again for each new task, or load the exposed skill tool by its namespaced name. No persistent mode UI or keyboard behavior is promised.

Next: [Route work through `/pstack:poteto-mode`](./02-poteto-mode.md).
