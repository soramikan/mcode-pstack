# mcode-pstack

[pstack](https://github.com/cursor/plugins/tree/1ba91fc25c0977741dd0e267849e6234b037ed0a/pstack) 0.15.36をMiniMax Codeへ移植した、非公式の配布・生成プロジェクトです。上流の著作者はLauren Tanです。

全58 skills・23 playbooks・2 agentsを追跡し、MiniMax Codeで使える委譲・モデル設定・検証・履歴・隔離実行へ適合させています。Cursor専用サービスは代替できる範囲と非対応を明示します。登録だけで全機能が無条件に動くわけではありません。

## 使い始める

Node 24 LTSとBun 1.4.2を推奨します。生成・上流テストにはBunが必要です。配布済みMarkdownの読込み自体はBunを要求しません。

```bash
npm ci --ignore-scripts
npm run check:generated
npm run validate
```

導入先は**現在使っているMiniMax CodeのdataDirを明示**してください。未指定のホームを探索したり、自動的にユーザー設定を書き換えたりしません。

```bash
DATA_DIR="/absolute/path/to/active-data-dir"
node scripts/install-local.mjs --data-dir "$DATA_DIR" --dry-run
# 差分と導入先を確認してから実行
node scripts/install-local.mjs --data-dir "$DATA_DIR" --apply
```

新しいMiniMax Codeセッションで、まず `/pstack:setup-pstack`、次に `/pstack:poteto-mode` を呼び出します。PluginとCustom Agentsは別管理です。導入ツールは両方を配置しますが、Plugin単体のコピーではAgentを登録しません。ローカルPluginは配置直後から有効になる点に注意してください。

モデルは継承が既定です。役割ごとのモデル・推論強度は、正確なキーをユーザーが明示選択した場合だけ設定します。単一モデルの独立候補を「複数モデルによる審査」とは表示しません。

## 検査

```bash
npm test
npm run test:upstream
npm run verify
# インストール済みCLIの実readerを、隔離dataDirで検査（モデル呼出しなし）
npm run test:host -- --source /absolute/path/to/minimax-code
```

TLC/JRE、実モデル・課金経路、GitHubへの書込み、ブラウザーdriver、永続wake等は通常の検査に含めません。依存がなければskip/BLOCKED/NOT_RUNとし、検証成功には数えません。host検査は専用workspace/dataDir/HOMEをrepo内に作ります。これはOSレベルのsandboxではありません。

## 構成

- `vendor/pstack/`: 固定commitの原本。変更禁止。
- `adapters/minimax-code/`: 移植差分・runtime・全機能の対応表。変更はここへ。
- `plugins/pstack/`: 生成済みネイティブPlugin。直接編集禁止。
- `agent-configs/`: 別配布するcanonical Custom Agent定義。
- `scripts/`: 固定取得・生成・検査・安全な導入/削除ツール。
- `tests/`: 合成履歴、偽mcode、排他制御、障害復旧の検査。

[導入・更新・削除](docs/installation.md) · [対応機能と制約](docs/compatibility.md) · [上流更新・reflect差分](docs/upstream-sync.md) · [runtime API](docs/runtime.md)

本プロジェクトの実装やテストは、MiniMax Code本体・既存のCodeRabbit用 `/loop`・通常ユーザー設定・実会話を変更しません。無断のモデル呼出し、push/PR/merge、外部公開も行いません。

MIT。上流著作権表示を保持しています。MiniMax/Cursorの公式リリースではありません。
