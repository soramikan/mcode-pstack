# 導入・更新・削除

## 対象環境

検査対象はMiniMax Code 0.6.5と、指定された改変済みソースrevision `ae75db3a770d945fee4505497daa970df7d09e73`です。公開最新版すべてへの互換性は保証しません。macOS/Node 24/Bun 1.4.2で検査し、LinuxはCI対象、Node 22.18とWindows nativeの受入は別扱いです。

## ローカル導入

最初に `npm ci --ignore-scripts`、`npm run validate` を実行します。ネイティブpackageは `plugins/pstack/` に生成済みです。ソースを変更しない利用者は生成し直す必要はありません。

`--data-dir`は必須の絶対パスです。現在のprofileが使うdataDirを確認してください。CLIでは通常 `MINIMAX_DATA_DIR` が優先されますが、導入ツールは環境から勝手に選びません。

```bash
DATA_DIR="/absolute/path/to/active-data-dir"
node scripts/install-local.mjs --data-dir "$DATA_DIR" --dry-run
node scripts/install-local.mjs --data-dir "$DATA_DIR" --apply
mcode plugin list --marketplace local --json
```

通常呼出しと `--dry-run` は読取りだけです。`--apply` のみが変更します。初期状態でローカルPluginはenabledになります。

配置先:

- `<dataDir>/plugins/pstack/`: 実体コピー。symlinkは不可。
- `<dataDir>/agents/poteto-agent/agent.md`
- `<dataDir>/agents/comment-sicko/agent.md`
- `<dataDir>/pstack/`: 導入記録、lock、staging、バックアップ、quarantine。Plugin外なのでpackage digestを変えません。

Agent不要の場合は `--agents none`、片方だけなら `--agents poteto-agent` を指定できます。選択しなかった既存Agentには触れません。Pluginの有効/無効とAgentの存在は別です。`mcode plugin add <local path>` はこの対象CLIでは使えません。

導入後は新しいセッションで `/pstack:setup-pstack` と `/pstack:poteto-mode` を呼びます。既存セッションへのhot reloadは保証しません。taskによるAgent解決を確かめる実モデルsmokeは、利用モデル・権限・課金に同意したうえで別途行ってください。

## 更新・復旧

同じ導入コマンドを使います。管理hashと一致するファイルだけが更新されます。未管理の同名Plugin/Agentやユーザー編集を見つけた場合、書き換えず停止します。ユーザーの一般config.yaml、AGENTS.md、他のskillsは変更しません。

全対象の事前検査、排他lock、staging、バックアップ、配置、再検査、記録の順で実行します。例外時は自分の変更をrollbackし、復旧証拠を保管します。処理中に別の利用者が編集したファイルを上書きしてrollbackしません。

プロセス強制終了や電源断でlockが残った場合、PIDが死んでいるだけで削除しないでください。`<dataDir>/pstack/install.lock/owner.json`、`transactions/<id>/journal.json`、`previous-record.json`、backups/quarantineを照合し、実行中のwriterがないことを確認してから手動復旧します。自動lock強奪や自動強制削除はありません。保管物も勝手に消しません。

## アンインストール

```bash
node scripts/uninstall-local.mjs --data-dir "$DATA_DIR" --dry-run
node scripts/uninstall-local.mjs --data-dir "$DATA_DIR" --apply
```

記録とhashが一致する対象だけをquarantineへ移動するか、直前版の検証済みバックアップへ戻します。更新後の削除では、直前のPlugin版が復元される場合があります。previewの `restore` / `quarantine` を確認してください。復元された直前版は導入管理から外れるので、再導入時は同名衝突を手動解決します。

編集されたAgent、Agentディレクトリに追加されたメモ、project config、run証拠、reflect学習overrideは保持します。ディレクトリ丸ごとの恒久削除は行いません。記録やバックアップの保持期間は利用者が決めてください。

## 導入検査の隔離先

`npm run test:host -- --source /absolute/path/to/minimax-code` はrepoの `tests/.sandbox/host/` 以下へ専用dataDir/workspace/HOMEを作り、Plugin一覧の実readerを通します。指定sourceのcanonical Agent codecもBunで検査用にbundleし、配置した2定義を安定読込みします（loggingだけstub）。これはtaskによる実モデル解決の代わりではありません。telemetryは無効化し、provider認証環境を引き継ぎません。実ユーザー環境へ導入したり、モデルを呼んだりしません。
