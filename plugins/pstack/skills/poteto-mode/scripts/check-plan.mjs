#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";

const RULE =
	"Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.";
// Localized labels preserve the upstream phase/evidence/gate model without
// prescribing a particular host UI, worker count, scheduler or model name.
const ALIASES = {
	"How to read this": ["読み方", "この計画の読み方"],
	"Program checklist": ["実行チェックリスト", "プログラムチェックリスト"],
	"Close the program": ["完了条件", "プログラムの終了"],
	"Arm the program": ["実行準備"], "Spawn owners": ["担当者の割当", "担当と所有権"],
	"PR mechanics": ["PR運用"], "Verdict and merge": ["判定とマージ"], "Boot recipe": ["開始手順"],
	"Depends on.": ["依存関係", "依存関係。"], "Files.": ["対象ファイル", "対象ファイル。"],
	"Build.": ["実装", "実装。"], "You see.": ["期待する結果", "期待する結果。"],
	"Verify, unit.": ["単体検証", "単体検証。"], "Verify, live.": ["実動検証", "実動検証。"],
	"Verify, perf.": ["性能検証", "性能検証。"], "Review gate.": ["レビューゲート", "レビューゲート。"],
	"Merge.": ["マージ", "マージ。"],
};
const canonical = (title) => Object.entries(ALIASES).find(([key, aliases]) => title === key || aliases.includes(title))?.[0] ?? title;
const hasRule = (text) => text.startsWith(RULE) || /単体.*(?:実動|ライブ).*性能.*(?:証拠|確認|検証)/.test(text);
const evidence = (text) => /Save `[^`]+`|(?:保存|証拠|記録).*`[^`]+`/.test(text);
const predicate = (text) => /Pass when|合格条件|成功条件/.test(text);
const SUB_BLOCKS = [
	"Depends on.",
	"Files.",
	"Build.",
	"You see.",
	"Verify, unit.",
	"Verify, live.",
	"Verify, perf.",
	"Review gate.",
	"Merge.",
];
const PROGRAM_H3 = ["Arm the program", "Spawn owners", "PR mechanics", "Verdict and merge", "Boot recipe"];
const HOW_TO_READ_MARKERS = [
	/One box is one unit of work|一つのチェック.*作業単位/,
	/names the evidence|証拠.*(?:指定|明記)/,
	/Check a box only when its evidence exists|証拠.*(?:存在|揃|ある).*チェック/,
];
const PERF_ITEMS = ["Metric.", "Probe.", "Baseline.", "Rule."];
const BOX = /^\s*- \[[ x]\] (.*)$/;

const file = process.argv[2];
if (!file) {
	console.error("Usage: node check-plan.mjs <plan.md>");
	process.exit(2);
}

const raw = fs.readFileSync(file, "utf8").split(/\r?\n/);
const problems = [];
const fail = (line, message) => problems.push(`${file}:${line}: ${message}`);

let start = 0;
if (raw[0] === "---") {
	start = raw.indexOf("---", 1) + 1;
}

const lines = [];
let fence = null;
const openingFence = (text) => {
	const match = text.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
	if (!match || (match[1][0] === "`" && match[2].includes("`"))) return null;
	return { char: match[1][0], length: match[1].length };
};
const closingFence = (text, opening) => {
	const match = text.match(/^ {0,3}(`+|~+)[ \t]*$/);
	return Boolean(
		match &&
		match[1][0] === opening.char &&
		match[1].length >= opening.length,
	);
};
for (let i = start; i < raw.length; i++) {
	const text = raw[i];
	const n = i + 1;
	let code = Boolean(fence);
	if (fence && closingFence(text, fence)) {
		code = false;
		fence = null;
	} else if (!fence) {
		fence = openingFence(text);
		code = Boolean(fence);
	}
	lines.push({ n, text, code });
	if (code) continue;
	const prose = text
		.replace(/(?<!`)(`+)(?!`)(.*?)(?<!`)\1(?!`)/g, "`")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
		.replace(/\]\([^)]*\)/g, "]");
	if (/[\u2013\u2014]/.test(prose)) fail(n, "long dash");
	if (/[\u2018\u2019\u201c\u201d]/.test(prose)) fail(n, "curly quote");
	if (/: \S/.test(prose)) fail(n, "mid-sentence colon");
}

const h2 = (l) => (!l.code && l.text.startsWith("## ") ? canonical(l.text.slice(3).trim()) : null);
const sections = [];
for (const l of lines) {
	const title = h2(l);
	if (title !== null) sections.push({ title, n: l.n, body: [] });
	else if (sections.length) sections.at(-1).body.push(l);
}
const find = (title) => sections.find((s) => s.title === title);
const bodyText = (s) => s.body.map((l) => l.text).join("\n");
const boxes = (ls) => ls.filter((l) => !l.code && BOX.test(l.text)).map((l) => ({ n: l.n, text: l.text.match(BOX)[1] }));

const h1 = lines.findIndex((l) => !l.code && l.text.startsWith("# "));
if (h1 === -1) fail(1, "no H1 title");
const howToRead = find("How to read this");
if (!howToRead) fail(1, 'no "## How to read this" section');
if (h1 !== -1 && howToRead) {
	const intro = lines.slice(h1 + 1).filter((l) => l.n < howToRead.n && l.text.trim() !== "");
	if (intro.length >= 10) fail(lines[h1].n, `intro is ${intro.length} lines, under ten required`);
	for (const marker of HOW_TO_READ_MARKERS) {
		if (!marker.test(bodyText(howToRead))) fail(howToRead.n, `How to read this lacks evidence/checkbox guidance (${marker})`);
	}
}

const program = find("Program checklist");
if (!program) fail(1, 'no "## Program checklist" section');
else {
	const h3s = program.body.filter((l) => !l.code && l.text.startsWith("### ")).map((l) => canonical(l.text.slice(4).trim()));
	let cursor = 0;
	for (const name of PROGRAM_H3) {
		const at = h3s.findIndex((t, i) => i >= cursor && t.startsWith(name));
		if (at === -1) fail(program.n, `Program checklist lacks "### ${name}" in order`);
		else cursor = at + 1;
	}
	const ownership = program.body.filter((l) => !l.code && !l.text.startsWith("#")).map((l) => l.text).join("\n");
	if (!/(?:owner|担当|所有).*(?:`[^`]+`|[=:：]|负责)/i.test(ownership))
		fail(program.n, "Program checklist names no owner/scope assignment");
}

const close = find("Close the program");
if (!close) fail(1, 'no "## Close the program" section');
const programIndex = sections.indexOf(program);
const closeIndex = sections.indexOf(close);
const prSections = programIndex === -1 || closeIndex === -1 ? [] : sections.slice(programIndex + 1, closeIndex);
if (prSections.length === 0) fail(1, "no PR sections between Program checklist and Close the program");

const report = [];
for (const pr of prSections) {
	const heads = [];
	for (const l of pr.body) {
		if (l.code) continue;
		const m = l.text.match(/^\*\*([^*]+)\*\*(.*)$/);
		if (m && SUB_BLOCKS.includes(canonical(m[1]))) heads.push({ name: canonical(m[1]), n: l.n, rest: m[2].trim(), lines: [] });
		else if (heads.length) heads.at(-1).lines.push(l);
	}
	const names = heads.map((h) => h.name);
	if (names.join("|") !== SUB_BLOCKS.join("|")) {
		fail(pr.n, `${pr.title}: sub-blocks are [${names.join(", ")}], expected [${SUB_BLOCKS.join(", ")}]`);
	}
	const block = (name) => heads.find((h) => h.name === name);
	const counts = {};
	for (const h of heads) counts[h.name] = boxes(h.lines).length;

	const depends = block("Depends on.");
	if (depends && depends.rest === "") fail(depends.n, `${pr.title}: Depends on names nothing`);
	for (const name of ["Files.", "Build.", "You see.", "Verify, unit.", "Merge."]) {
		const b = block(name);
		if (b && boxes(b.lines).length === 0) fail(b.n, `${pr.title}: ${name} has no box`);
	}
	for (const name of ["Verify, unit.", "Verify, live.", "Verify, perf."]) {
		const b = block(name);
		if (b && !hasRule(b.rest)) fail(b.n, `${pr.title}: ${name} does not open with the unit/live/perf evidence rule`);
	}

	const live = block("Verify, live.");
	if (live) {
		const checks = boxes(live.lines);
		if (!checks.length) fail(live.n, `${pr.title}: live verification has no checks`);
		for (const check of checks) {
			if (!evidence(check.text)) fail(check.n, `${pr.title}: live check names no saved evidence path`);
			if (!predicate(check.text)) fail(check.n, `${pr.title}: live check has no pass predicate`);
		}
	}

	const perf = block("Verify, perf.");
	if (perf) {
		const perfNames = { "指標。": "Metric.", "計測。": "Probe.", "基準値。": "Baseline.", "判定基準。": "Rule." };
		const items = boxes(perf.lines).map((b) => perfNames[b.text.split(" ")[0]] ?? b.text.split(" ")[0]);
		if (items.join("|") !== PERF_ITEMS.join("|")) fail(perf.n, `${pr.title}: perf boxes are [${items.join(", ")}], expected [${PERF_ITEMS.join(", ")}]`);
	}

	const gate = block("Review gate.");
	if (gate) {
		const gateBoxes = boxes(gate.lines);
		if (/^(?:None\.|なし[。.]?)/.test(gate.rest)) {
			if (gateBoxes.length) fail(gate.n, `${pr.title}: Review gate says None but has boxes`);
		} else {
			const text = gate.lines.map((l) => l.text).join("\n");
			if (gateBoxes.length === 0) fail(gate.n, `${pr.title}: Review gate has no box`);
			if (!/(?:evidence|screenshot|video|証拠|記録)/i.test(text)) fail(gate.n, `${pr.title}: Review gate lacks evidence`);
			if (!/(?:operator|reviewer|承認者|確認者|担当者)/i.test(text)) fail(gate.n, `${pr.title}: Review gate lacks an approver`);
		}
	}

	const total = boxes(pr.body).length;
	const cells = SUB_BLOCKS.filter((s) => s !== "Depends on.").map((s) => `${s.replace(/[ ,.]+/g, "-").replace(/-$/, "").toLowerCase()}=${counts[s] ?? 0}`);
	report.push(`${pr.title}  boxes=${total}  ${cells.join(" ")}`);
}

if (closeIndex !== -1) {
	const tail = sections.slice(closeIndex + 1);
	for (const s of tail) {
		if (!/^(?:Appendix|付録)/.test(s.title)) fail(s.n, `"## ${s.title}" after Close the program is not an appendix`);
	}
	if (!tail.some((s) => /Prototype evidence|試作.*証拠|プロトタイプ.*証拠/.test(s.title))) fail(close.n, 'no prototype evidence appendix');
}

for (const line of report) console.log(line);
console.log(`${prSections.length} PR sections, ${problems.length} problems`);
for (const p of problems) console.error(p);
process.exit(problems.length ? 1 : 0);
