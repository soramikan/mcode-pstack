# MiniMax prompt overrides

Pinned baseline: pstack 0.15.36, commit `1ba91fc25c0977741dd0e267849e6234b037ed0a`, from [cursor/plugins](https://github.com/cursor/plugins/tree/1ba91fc25c0977741dd0e267849e6234b037ed0a/pstack). Vendor sources are immutable.

## Files and application order

- `compile-patches.mjs`: reviewed boundary selections and enumerated spelling changes. Running it produces source metadata and the compatibility inventory, not generated plugins. Do not use it to update the pinned baseline implicitly.
- `patches.json`: schemaVersion 1, upstreamCommit, files. Each file has source, upstreamSha256, and ordered patches with exact old/new/reason. The hash is the entire untouched upstream file. Each old string must match exactly once at its application point.
- `source-inventory.json`: immutable source paths, generated inclusion closure, 58 skill names, and Markdown hashes. Used to avoid installation scans and close links deterministically.
- `reflection.json`: approved durable learning, separate from compiler-owned patches. Compilation deliberately does not overwrite this file.

`transformMarkdown(relativePath, input, context = {})` is synchronous and returns a string. It verifies the baseline hash and context commit, applies base exact patches, then approved reflection patches, namespaces command-shaped references, repairs links, and embeds applicable execution policies. It never writes generation destinations. All frontmatter except the description field, including the original name, is byte-preserved. Description keeps its routing role while skill-command references are namespaced and obsolete host-specific API/service wording receives minimal exact-patch corrections. An unchanged source-relative link remains local only if its target is included; excluded references become immutable commit URLs. The excluded Claude harness link resolves to the MiniMax harness.

## Evidence and reasons

The source instructions require actual semantic changes, not only a safety notice:

- Upstream poteto-mode Subagents and arena/swarm assume Task cloud/permission options, model-slug suffix selection, and resumable children. MiniMax's native task surface instead uses description/prompt/agent_name and optional model/effort/run_in_background, and children cannot coordinate. Patches replace those paragraphs, keep parent orchestration, and distinguish read-only roles from writable ownership. The parent supplies the absolute poteto SKILL.md path; missing path blocks rather than scans caches.
- Upstream setup writes global host rules and infers model families/default slugs. Dedicated runtime configuration replaces these steps; inheritance is the default and exact user choices/family metadata are explicit. References: this repository's `adapters/minimax-code/runtime/config.mjs` and the assignment's verified host contract. No live model availability is claimed.
- Arena's output directory is not execution isolation. The code path now requires approved worktrees, exact model/effort metadata, and the opt-in headless runtime with true cwd isolation; it does not promise a sandbox. Candidate writers must stop before judging, and missing candidates/required checks cannot yield PASS.
- Recall/reflect/automate-me/session-pickup/decision audits used host transcript layouts. They now use only exposed native session queries or explicitly scoped session-reader artifacts, never home scans. Templates no longer infer file-open receipts from display-only history. Historical messages and review comments remain untrusted data.
- Upstream reflect copied installed skills and filed tracker items automatically. It now waits for approval and persists repository source overrides, then requires generation, checks, and explicit reinstall. Missing source means proposals only, not cache edits or namespace shadowing.
- Long-run, shipping, cleanup, and planning paragraphs contained host-specific scheduling, cloud owners, permissive merge fallbacks, writer replacement before stop, forced removal, and non-Plan artifacts during planning. Those local instructions are replaced with bounded turns/explicit Goals, parent-owned native roles, evidence gates, stop-before-replace, managed recoverable cleanup, and canonical-Plan-only writes. All 23 playbooks remain present.
- Help/guide installation and persistent-mode instructions are adapted, not left as executable advice for another host. Unsupported make-bot-ui becomes a reference-only gate; Benny is a separate unsupported inventory item. Nonbundled control/deslop/visualize capabilities produce NOT_RUN when unavailable; mandatory gaps block shipping.
- Decision logging keeps one append-only decisions.tsv, redacts secrets, serializes appends, neutralizes spreadsheet formulas, and reports an absent different-family audit. Video retains the real-data narrative and subtitle workflow but requires a local renderer and workspace run output, with ordinary ketchup fallback rather than an invented render.

These are portability statements and source-level checks, not evidence of installed MiniMax execution. Runtime enforcement and bundled script overrides are owned separately. Native tasks still share the workspace; prompt roles are not a filesystem sandbox.

## Approved reflection storage

After the user approves each proposed body or role-preserving description change, append or extend a record in `reflection.json`:

```json
{
  "schemaVersion": 1,
  "upstreamCommit": "1ba91fc25c0977741dd0e267849e6234b037ed0a",
  "files": [{
    "source": "skills/recall/SKILL.md",
    "upstreamSha256": "<SHA-256 from the pinned untouched source>",
    "patches": [{
      "old": "<unique exact text after base patches and earlier learning patches>",
      "new": "<approved replacement>",
      "reason": "<approved finding and evidence>"
    }]
  }]
}
```

One record per source, ordered patches. Retain all prior approved learning; do not replace the file with the empty example. Frontmatter name and other keys cannot change. Approved description edits preserve the skill's routing role; runtime references are automatically namespaced. The setup catalog describes dedicated pstack JSON rather than global rules, the authoring catalog names available skill-creator, decision-log commits require authorization, and the bot-UI catalog explicitly reports unsupported services. These minimal metadata corrections are recorded as pinned exact patches. Run `node --test tests/unit/prompts-*.test.mjs`, regenerate with the repository generator, run its validation/checks, inspect the generated diff, and request explicit reinstallation. Never edit vendor, generated plugins, or installed caches.

Without repository source write `.pstack/proposals/<name>.md` only (outside Plan Mode); under Plan Mode use the canonical Plan. A separately requested independent skill can live in `.minimax/skills/pstack-local-<name>/SKILL.md` with a distinct name and must not shadow pstack.
