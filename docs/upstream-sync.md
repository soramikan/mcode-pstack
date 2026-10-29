# 上流更新と学習差分

## 原本の固定

`upstream.lock.json` はcommit SHA、各ファイルのGit blob SHA/SHA-256、tree hash、58 skills/23 playbooks/2 agentsのinventoryを記録します。通常の生成・テストは通信せず、mainを参照しません。`vendor/pstack/` と `vendor/upstream-generator.mjs` は変更禁止です。

```bash
# remote treeを照合して追加・削除・変更を表示。ローカル変更なし
node scripts/sync-upstream.mjs --commit <40文字のcommit-SHA>
```

新しいcommitへの書込みは、adapterのcompatibility inventoryを明示的にrebaseした後だけ許可します。単にcommit欄を書き換えて適合確認を省略しないでください。まずGitHubの固定commit差分で、追加skill、model/権限指示、scripts・依存・licenseの変更を調べます。そのうえで以下を行います。

1. 原本が現在のlockと一致することを検査し、取得対象と移植対象を確認する。
2. 新しいcommit向けのcompatibility inventoryを準備し、明示的にsource syncする。
3. exact patchのold/newと基準hash、source inventory、reflection差分を再検証・rebaseする。
4. 必要な補助scriptの差分・bundle依存を確認し、生成・unit/upstream/host検査を実行する。
5. 新機能を黙って省かず、対応状態・制約・test IDを埋める。差分を人が確認してから明示再導入する。

```bash
node scripts/sync-upstream.mjs --commit <確認済みSHA> --write
npm run generate
npm run verify
```

固定SHAとGit blob hashが一致しない取得、truncated tree、原本へのローカル改変は拒否します。生成途中や取得途中の残骸・旧版は `.pstack/` 配下へ保管し、無断削除しません。残留lockはownerとstagingを調べてから手動で回復します。

## 生成

```bash
npm run generate
npm run check:generated
```

生成器は明示stagingを作り、native schema・inventory・参照・サイズ・旧runtime指示を検査した後、生成済みPluginとAgentsを公開します。`--check` は管理出力を変更しません。ただし再現性確認用のstagingとlock記録を `.pstack/generation/` に作ります。bundleも比較対象で、node_modulesをpackageに入れません。

原本・移植source・生成先を混ぜないでください。生成先の手編集は次回生成で失われ、`--check` で差分になります。

## reflectの変更先

pstack自身の改善は、承認後に `adapters/minimax-code/skill-overrides/reflection.json` の基準hash付きexact patch、または明示されたpolicyへ保存します。patchのoldは移植base patch適用後・namespace/link共通変換前の本文に対して一意に一致する必要があります。nameは保持し、descriptionの変更は旧runtime指示の適合や承認済み学習に必要な最小差分だけにします。vendor・生成済みpackage・インストール済みpackageを直接編集しません。

保存→生成→検査→明示再導入→新セッションで効果確認、が通常経路です。上流更新で基準が崩れた場合は停止して競合を解消します。学習差分を黙って消しません。

source repoを変更できなければ `.pstack/proposals/` へpatch提案を置きます。利用者が独自skillを選んだ場合だけ `.minimax/skills/pstack-local-<name>/` に参照閉包ごと複製し、`/pstack-local-<name>` で呼びます。元の `/pstack:<name>` を上書きしたとは扱いません。project skillのexternal discoveryが無効なら、利用者にその制約を伝え、一般設定を勝手に変更しません。
