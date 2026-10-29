import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { transformMarkdown } from '../../adapters/minimax-code/transform.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const json = p => JSON.parse(read(p));
const inv = json('adapters/minimax-code/skill-overrides/source-inventory.json');
const compatibility = json('adapters/minimax-code/compatibility.json');
const patchSet = json('adapters/minimax-code/skill-overrides/patches.json');
const context = {upstreamCommit: inv.upstreamCommit, skillNames: inv.skillNames};
const transform = p => transformMarkdown(p,read(`vendor/pstack/${p}`),context);
const body = s => s.replace(/^---\n[\s\S]*?\n---\n/,'');
const skill = n => body(transform(`skills/${n}/SKILL.md`));
const play = n => transform(`skills/poteto-mode/playbooks/${n}.md`);

test('prompts.inventory: all 58 skills, 23 playbooks, two agents and Benny have real pinned sources', () => {
  assert.equal(inv.skillNames.length,58);
  assert.equal(new Set(compatibility.items.map(i=>i.id)).size,84);
  assert.equal(compatibility.items.filter(i=>i.kind==='skill').length,58);
  assert.equal(compatibility.items.filter(i=>i.kind==='playbook').length,23);
  assert.equal(compatibility.items.filter(i=>i.kind==='agent').length,2);
  assert.equal(compatibility.items.filter(i=>i.kind==='automation').length,1);
  assert.equal(compatibility.schemaVersion,1);
  assert.equal(compatibility.upstreamCommit,inv.upstreamCommit);
  for (const item of compatibility.items) {
    assert.ok(fs.statSync(path.join(root,'vendor/pstack',item.source)).isFile());
    assert.ok(['supported','limited','unsupported'].includes(item.status));
    assert.ok(item.constraints.length && item.tests.length);
  }
  assert.equal(compatibility.items.find(i=>i.id==='skill:make-bot-ui').status,'unsupported');
  assert.equal(compatibility.items.find(i=>i.id==='automation:benny').status,'unsupported');
});

const frontmatter = text => text.match(/^---\n[\s\S]*?\n---\n/)?.[0] ?? '';
const description = text => frontmatter(text).match(/^description:[^\r\n]*(?:\r?\n[ \t]+[^\r\n]*)*/m)?.[0] ?? '';
const namespaceDescription = text => inv.skillNames.reduce((value,name)=>value.replace(new RegExp(`(^|[\\s\\x60"'(>\\[])\\/${name}(?=$|[\\s\\x60"')<\\],.!?:;])`,'gm'),`$1/pstack:${name}`),text);

test('prompts.frontmatter: names and other keys are exact; only description references/host wording adapt', () => {
  const wordingChanges=new Set(['setup-pstack','automate-me','show-me-your-work','make-bot-ui']);
  for (const n of inv.skillNames) {
    const p=`skills/${n}/SKILL.md`, original=read(`vendor/pstack/${p}`), result=transform(p);
    assert.equal(frontmatter(result).replace(description(result),''),frontmatter(original).replace(description(original),''),p);
    assert.match(frontmatter(result),new RegExp(`^name: ${n}$`,'m'));
    assert.ok(description(result).length > 'description:'.length,p);
    if(!wordingChanges.has(n)) assert.equal(description(result),namespaceDescription(description(original)),p);
    assert.ok(Buffer.byteLength(result)<=100*1024,p);
    assert.match(body(result), /parent owns|parent owns|parent chat|parent-owned|parent supplies|parent arranges|parent launches|parent coordinator|parent requests|parent spawns|parent may|parent queues|parent runs|parent assigns|parent creates|parent asks|parent delegates|parent and|parent configuration|parent model|parent goal|parent role|parent review|parent writes|parent tool|parent to|parent must|parent's|The parent/);
  }
});

test('prompts.boundaries: production Markdown has no executable legacy host calls', () => {
  const bad = /\.cursor\/(?:skills|rules|plans|projects|scratch|plugins)|\b(?:subagent_type|cloud_base_branch|readonly)\s*[:=]|\benvironment\s*[:=]\s*["']?(?:cloud|local)|\bTask\(|\/loop\s+\d|rm -rf|bun install/;
  const failures=[];
  for(const p of inv.included.filter(p=>p.endsWith('.md'))) {
    const text=transform(p);
    for (const [i,line] of text.split('\n').entries()) if(bad.test(line)) failures.push(`${p}:${i+1}: ${line}`);
  }
  assert.deepEqual(failures,[]);
});

test('prompts.namespace: command-shaped runtime references and descriptions are namespaced', () => {
  for(const p of inv.included.filter(p=>p.endsWith('.md'))) {
    const text=transform(p);
    for (const name of inv.skillNames) assert.doesNotMatch(text,new RegExp(`(^|[\\s\\x60"'(>\\[])\\/${name}(?=$|[\\s\\x60"')<\\],.!?:;])`,'m'),p);
  }
  assert.equal(transformMarkdown('example.md','Use `/how` and skill(name="recall").\n',context),'Use `/pstack:how` and skill(name="pstack:recall").\n');
});

test('prompts.playbooks: every playbook retains its named procedure and embeds parent/approval boundaries', () => {
  for(const item of compatibility.items.filter(i=>i.kind==='playbook')) {
    const text=transform(item.source);
    assert.match(text,/^### /);
    assert.match(text,/parent owns `todowrite`/);
    assert.match(text,/No unapproved commit, push, rebase/);
    assert.match(text,/bounded turn/);
  }
  for(const name of ['autonomous-run','autopilot-full','autopilot-stack','babysit']) assert.match(play(name),/manual resume|manual resumption/);
  assert.match(play('shipping'),/BLOCKED and stops merging/);
  assert.match(play('worktree-cleanup'),/recoverable deletion/);
  assert.match(play('multi-phase-plan'),/only the canonical Plan/);
});

test('prompts.links: every production Markdown link is included locally or pinned upstream', () => {
  const included=new Set([...inv.included,'docs/harness/minimax-code.md']);
  for(const p of inv.included.filter(p=>p.endsWith('.md'))) {
    for(const match of transform(p).matchAll(/!?\[[^\]\n]*\]\(([^\s)]+)\)/g)) {
      const href=match[1];
      if (/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(href)) continue;
      const destination=path.posix.normalize(path.posix.join(path.posix.dirname(p),decodeURIComponent(href.split('#')[0])));
      assert.ok(included.has(destination) || [...included].some(f=>f.startsWith(`${destination.replace(/\/$/,'')}/`)),`${p}: ${href}`);
    }
  }
});

test('prompts.agents: canonical delegates cannot coordinate or discover an installation', () => {
  for(const n of ['poteto-agent','comment-sicko']) {
    const text=read(`adapters/minimax-code/agent-overrides/${n}/agent.md`);
    assert.doesNotMatch(text,/^is_background:|^model:|^effort:/m);
    assert.match(text,/cannot call task|Do not call task/);
    assert.match(text,/todo tools|todo tool/);
    assert.match(text,/ask_user/);
  }
  const p=read('adapters/minimax-code/agent-overrides/poteto-agent/agent.md');
  assert.match(p,/BLOCKED: parent must supply the absolute/);
  assert.match(p,/read the entire poteto-mode SKILL.md/);
  assert.match(p,/read-only role/);
  assert.doesNotMatch(p,/\.cursor\//);
});

test('prompts.semantic: host-specific workflows are meaningfully adapted', () => {
  assert.match(description(transform('skills/setup-pstack/SKILL.md')),/dedicated pstack JSON configuration/);
  assert.doesNotMatch(description(transform('skills/setup-pstack/SKILL.md')),/always-applied rule/);
  assert.match(description(transform('skills/make-bot-ui/SKILL.md')),/Unsupported Cursor\/Grok Bot/);
  assert.match(description(transform('skills/automate-me/SKILL.md')),/available skill-creator/);
  assert.match(skill('setup-pstack'),/\.pstack\/config.json/);
  assert.match(skill('setup-pstack'),/inherit-parent/);
  assert.match(skill('setup-pstack'),/Do not change max\/xhigh\/high\/fast suffixes/);
  assert.match(skill('poteto-mode'),/1\.\.50 Unicode/);
  assert.match(skill('arena'),/real cwd/);
  assert.match(skill('arena'),/candidate dropouts/);
  assert.match(skill('arena'),/completed or stopped before cross-judging/);
  assert.match(skill('swarm'),/maxWorkers/);
  for(const n of ['recall','reflect','automate-me','show-me-your-work']) assert.match(skill(n),/runtime\/session-reader.mjs/);
  assert.match(skill('reflect'),/reflection.json/);
  assert.match(skill('reflect'),/explicitly ask for reinstallation/);
  assert.match(skill('show-me-your-work'),/one canonical append-only `decisions.tsv`/);
  assert.match(skill('show-me-your-work'),/formula injection/);
  assert.match(skill('show-me-your-work'),/Different-family audit NOT_RUN/);
  assert.match(skill('ketchup-video'),/Video NOT_RUN/);
  assert.match(skill('make-bot-ui'),/UNSUPPORTED and stop/);
  assert.match(skill('principle-never-block-on-the-human'),/never waives approval/);
});

test('prompts.pinning: every patch validates exact source SHA, reason, and drift rejection', () => {
  for(const file of patchSet.files) {
    const input=read(`vendor/pstack/${file.source}`);
    assert.equal(createHash('sha256').update(input).digest('hex'),file.upstreamSha256);
    assert.ok(file.patches.every(p=>p.old && typeof p.new==='string' && p.reason));
  }
  assert.throws(()=>transformMarkdown('skills/arena/SKILL.md',read('vendor/pstack/skills/arena/SKILL.md')+'changed',context),/hash mismatch/);
  assert.throws(()=>transformMarkdown('example.md','example',{...context,upstreamCommit:'0'.repeat(40)}),/rebase/);
  assert.throws(()=>transformMarkdown('../escape.md','text',context),/vendor-relative/);
});

test('prompts.reflection: approved learning patches apply after base changes, survive regeneration and fail on drift', async () => {
  // Evaluate the same module against an in-memory reflection file; never modify real source fixtures.
  const source=read('adapters/minimax-code/transform.mjs');
  const record=patchSet.files.find(f=>f.source==='skills/recall/SKILL.md');
  const learned={schemaVersion:1,upstreamCommit:inv.upstreamCommit,files:[{source:record.source,upstreamSha256:record.upstreamSha256,patches:[{old:'# Recall',new:'# Recall\n\nApproved durable lesson.',reason:'Approved fixture lesson.'}]}]};
  const injected=source.replace("import { readFileSync } from 'node:fs';",'const readFileSync = globalThis.readMock;').replace("import { createHash } from 'node:crypto';",'const createHash = globalThis.createHash;').replace("import path from 'node:path';",'const path = globalThis.path;').replaceAll('import.meta.url',JSON.stringify(new URL('../../adapters/minimax-code/transform.mjs',import.meta.url).href)).replace('export function transformMarkdown','function transformMarkdown');
  const sandbox={readMock:(url,...args)=>String(url).endsWith('/reflection.json')?JSON.stringify(learned):fs.readFileSync(url,...args),createHash,path,Buffer,URL};
  vm.createContext(sandbox); vm.runInContext(injected,sandbox);
  const input=read(`vendor/pstack/${record.source}`);
  const first=sandbox.transformMarkdown(record.source,input,context);
  assert.match(first,/Approved durable lesson/);
  assert.equal(first,sandbox.transformMarkdown(record.source,input,context));
  assert.equal(first.match(/^---\n[\s\S]*?\n---\n/)[0],input.match(/^---\n[\s\S]*?\n---\n/)[0]);
  learned.files[0].patches[0].old='nonexistent anchor';
  const next={...sandbox,readMock:(url,...args)=>String(url).endsWith('/reflection.json')?JSON.stringify(learned):fs.readFileSync(url,...args)};
  vm.createContext(next);vm.runInContext(injected,next);
  assert.throws(()=>next.transformMarkdown(record.source,input,context),/Exact patch drift/);
  learned.files[0].patches[0]={old:'name: recall',new:'name: shadow',reason:'Invalid metadata fixture.'};
  const metadata={...sandbox,readMock:(url,...args)=>String(url).endsWith('/reflection.json')?JSON.stringify(learned):fs.readFileSync(url,...args)};
  vm.createContext(metadata);vm.runInContext(injected,metadata);
  assert.throws(()=>metadata.transformMarkdown(record.source,input,context),/Cannot change pinned name or other frontmatter keys/);
  learned.files[0].patches[0]={old:'from your own chat history',new:'from your explicitly scoped chat history',reason:'Approved description routing clarification.'};
  const catalog={...sandbox,readMock:(url,...args)=>String(url).endsWith('/reflection.json')?JSON.stringify(learned):fs.readFileSync(url,...args)};
  vm.createContext(catalog);vm.runInContext(injected,catalog);
  const adapted=catalog.transformMarkdown(record.source,input,context);
  assert.match(description(adapted),/explicitly scoped chat history/);
  assert.equal(frontmatter(adapted).replace(description(adapted),''),frontmatter(input).replace(description(input),''));
});
