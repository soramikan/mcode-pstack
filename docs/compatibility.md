# 対応機能と検証範囲

正は [compatibility.json](../adapters/minimax-code/compatibility.json) です。58 skills、23 playbooks、2 agents、Bennyの**84項目**を登録し、source、status、制約、test IDを持たせています。packageにも同じinventoryを同梱します。

`status: supported` は移植したprompt/API契約の対応状態です。実モデルでの全ワークフロー受入が終わったことを意味しません。`limited` は追加能力・明示設定が必要、`unsupported` は同等サービスを提供しない機能です。unit/fixture、上流検査、インストール済みreader、実モデルsmokeを区別してください。

## 機能群

| 機能 | 対応と条件 |
|---|---|
| poteto-mode・24 principles・調査/品質/文章 | 原文を基準に必要差分だけを適用。namespace、親子役割、承認境界を適合 |
| setup-pstack・モデルrole | 専用JSON。継承が既定、正確なユーザー選択のみ使用。利用可能モデルの自動推測・無断試し課金なし |
| arena / swarm / interrogate / architect | taskによる独立委譲。同じファイルを書く候補は別worktreeのheadless runnerが必要。モデル多様性がなければ明示 |
| poteto-agent / comment-sicko | native canonical形式で別配置。子は質問・再委譲を親へ返す。Pluginのagentsフォルダだけでは登録されない |
| recall / reflect / automate-me | exposedなsession queryまたは指定digest/manifest。全ホーム走査なし。改善差分は承認後source overrideへ |
| show-me-your-work | run配下の単一decisions.tsv。append-only、単行化、formula injection対策。架空の異family監査表示なし |
| statechart | Node/Bun検査と一部production経路。Java/TLCの実行には明示既存runtimeが必要。自動JRE/JAR/pele導入なし |
| watch-pr | Bun/git/認証済みghが必要。CI queryをboundedに実行。認証や実GitHub書込みは通常fixture検査の範囲外 |
| worktree audit / check-plan | 既定fetchなし。refreshは明示承認時だけ。Plan pathは明示入力、日本語見出し対応 |
| 長時間playbooks | 有限turn、またはユーザーが有効にしたGoal。停止条件・試行数・期限・writer所有権が必要 |
| shipping / cleanup | 明示許可範囲内。必須検証がBLOCKEDならmerge停止。dirty state保全、旧writer停止後の交代 |
| ketchup / ketchup-video | 実在evidenceのみ。動画にはlocal rendererが必要。なければNOT_RUNと通常ketchup。無断upload・モデル生成なし |
| make-bot-ui | **非対応ゲート**。Cursor/Grok webhook/routine UI等を提供しない。無断server構築もしない |
| Cursor Automations / Benny | **非対応**。Benny専用3 skillsは通常58 skillsと別枠で、Pluginとして配布しない |

## ホストの制約

- taskは親とworkspaceを共有します。cwdを渡す引数はありません。promptにworktree名を書くことは隔離ではありません。
- headless runnerはcwdを分離しますが、OS・ネットワーク・認証のsandboxにはなりません。モデル/effortのeffective metadata、確認済みpermission、base SHA、成果物が揃わなければ起動しません。
- runnerのpermissionは確認済みsmartのみです。offはread-onlyではなく権限強制無効化なので拒否します。fullへの自動昇格もありません。対話許可が必要なら親へ戻します。
- `disable-model-invocation`とallowed-toolsは、このホストでは強制認可になりません。本文の明示依頼ゲートはありますが、host側のmanual-only保証を提供したとは説明しません。
- 改変済みMiniMax Codeの `/loop` はCodeRabbit専用です。pstackの一般的な継続・wakeに流用しません。cron機能がなければ手動再開です。
- 外部verification skill、ブラウザー/CLI driver、MCP、rendererの不存在はBLOCKED/NOT_RUNです。skipをPASSへ読み替えません。
- hot reload、Windows native、Node 22.18、任意の公式最新版は別途受入が必要です。

## 通常検査と未実施

`npm run verify` は生成再現性・schema・全項目の構造/変換契約・Node unit tests・上流Bun/Node testsを実行します。結果は `.pstack/checks/verification.json` に保存します。`npm run test:host -- --source <指定source>` はpublic validatorとインストール済みMiniMax readerを通し、隔離dataDirでpstack@localの58 skillsを確認します。

実モデルによるskill読込み・Agent解決・実装/レビューの縦断smoke、利用可能モデル・effort・課金、TLCによる実比較、GitHubへのpush/PR/mergeは未実施として残します。これらの許可と必要なruntimeが揃うまでは、完全なライブ受入済みリリースとは扱わないでください。CIファイルは作成しますが、ここでリモートCIを起動したとはみなしません。
