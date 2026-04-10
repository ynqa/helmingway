# Helmingway Specification

## 1. 概要

Helmingway は VS Code extension として動作し、Helm chart と values を編集中に `helm template` の結果を確認できるプレビュー機能を提供する。

v1 では以下を目的とする。

- Helm chart のレンダリング結果を VS Code 上で確認できる
- レンダリング結果を template ファイル単位で確認できる
- 環境ごとの差分を比較できる
- Git commit 間の差分を比較できる
- chart や values の変更時にバックグラウンドで自動再レンダリングできる
- 設定ファイル YAML を起点に対象 chart、環境、比較条件を定義できる

## 2. スコープ

### 2.1 v1 で含むもの

- 1 つの設定ファイル YAML を起点とした chart の定義
- 単一 chart に対する複数 environment の切り替え
- `helm template` の実行と結果キャッシュ
- template 単位のプレビュー表示
- environment 間 diff
- 任意 2 commit 間 diff
- Webview ベースの専用 UI
- 設定 YAML、values、`templates/` の変更監視

### 2.2 v1 で含まないもの

- 複数 chart の同時表示
- Kubernetes クラスタへの apply や dry-run 実行
- 構造化 diff や semantic diff
- Helm 依存 chart の取得や認証の管理
- VS Code 外部ツールとの連携

## 3. ユースケース

### 3.1 レンダリング結果の確認

ユーザーは Helm chart または values を編集し、対象 environment のレンダリング結果を VS Code 内で確認する。

### 3.2 template 単位の確認

ユーザーは特定の template に対応する出力だけを切り出して確認する。

### 3.3 environment 間 diff

ユーザーは同一 chart に対して複数 environment を定義し、同じ template の出力差分を比較する。

### 3.4 commit 間 diff

ユーザーは任意の 2 commit を指定し、同一 template の出力差分を比較する。

## 4. 設定ファイル

### 4.1 基本方針

拡張機能は 1 つの集約設定 YAML を読み込み、その内容に従って chart、environment、diff 対象、プレビュー対象を決定する。

VS Code settings は補助的に使い、主設定は YAML に集約する。

### 4.2 VS Code settings

公開する設定は最小限とし、少なくとも以下を持つ。

- `helmingway.configPath`
  - 設定 YAML のパス
- `helmingway.helmBinaryPath`
  - `helm` 実行ファイルの上書きパス
- `helmingway.autoRender`
  - 自動再レンダリングの有効/無効

### 4.3 設定 YAML の要件

設定 YAML は少なくとも以下の情報を持つ。

- 設定ファイル version
- chart の場所
- `helm template` 実行時の基本オプション
- environment 定義
- environment ごとの values ファイル一覧
- 初期表示に使う preview 条件
- diff 条件

### 4.4 設定 YAML の例

以下は想定する最小構成の一例である。

```yaml
version: 1

chart:
  path: ./charts/example
  releaseName: example
  namespace: default

environments:
  - name: dev
    values:
      - ./env/dev.yaml
  - name: prod
    values:
      - ./env/prod.yaml

preview:
  defaultEnvironment: dev
  templateGlob: templates/**/*.yaml

diff:
  defaultMode: environment
  defaultLeft: dev
  defaultRight: prod
```

### 4.5 バリデーション

設定 YAML の読み込み時は以下を検証する。

- YAML として正しいこと
- 必須フィールドが存在すること
- chart path が解決できること
- environment 名が一意であること
- values ファイルのパスが解決できること

不正な場合は Webview 上にエラーを表示し、直前の成功状態があればそれを保持する。

## 5. レンダリング

### 5.1 実行単位

レンダリングは以下の入力単位で管理する。

- chart
- environment
- template filter
- 比較対象の commit または working tree

### 5.2 実行コマンド

基本コマンドは `helm template` を利用する。

chart path を current working directory とし、設定 YAML で定義された values ファイルを `-f` で順に適用する。

必要に応じて release name や namespace などのオプションを付与する。

### 5.3 出力の扱い

`helm template` の標準出力は 1 つの文字列として扱わず、template ごとに分割した論理単位として保持する。

各出力単位は少なくとも以下の情報を持つ。

- template 識別子
- 表示名
- rendered manifest 本文
- 出力順

### 5.4 エラー処理

`helm template` 実行失敗時は以下を表示する。

- 実行対象 environment または commit 情報
- 標準エラー出力
- 設定またはファイル解決に関する補足情報

エラーが発生しても extension 自体は継続動作させる。

## 6. バックグラウンド実行

### 6.1 監視対象

自動再レンダリングは以下の変更を監視対象とする。

- 設定 YAML
- 現在参照中の values ファイル
- chart 配下の `templates/`

### 6.2 挙動

- ファイル変更を検知したら関連 environment のレンダリングを再実行する
- 短時間に連続変更が発生した場合は適切に debounce する
- 実行中に追加変更があった場合は古い結果で上書きしない
- 成功時は Webview を更新する
- 失敗時は最後の成功結果を保持しつつエラー状態を更新する

### 6.3 キャッシュ

レンダリング結果は environment 単位でキャッシュする。

表示切り替えや diff 切り替えでは、入力条件が変わらない限り `helm template` を再実行せずキャッシュを利用する。

## 7. UI

### 7.1 表示方式

プレビューと diff は専用 Webview パネルで提供する。

### 7.2 主要 UI 要素

Webview は少なくとも以下の要素を持つ。

- environment 選択
- diff モード選択
- 左右比較対象の選択
- template 一覧
- rendered manifest 表示領域
- diff 表示領域
- ローディング表示
- エラー表示

### 7.3 基本レイアウト

基本レイアウトは以下とする。

- 左カラム: template 一覧
- 上部: environment と diff 条件の選択
- メイン領域: 単一プレビューまたは diff

### 7.4 template 一覧

- `helm template` の結果に対応する template 単位で一覧表示する
- template を選択すると対象本文を表示する
- 選択中 template が比較対象で存在しない場合は未生成として表示する

## 8. Diff

### 8.1 diff モード

v1 では以下の 2 モードを提供する。

- environment vs environment
- commit vs commit

### 8.2 environment diff

- 同一 template を基準に左右 environment を比較する
- 差分がない場合も差分なしとして明示する
- 片側にしか存在しない出力は追加または削除として扱う

### 8.3 commit diff

- 任意の 2 commit を指定して同一 template の差分を表示する
- working tree を破壊しない方法で比較用入力を組み立てる
- UI 上は commit 指定だけを意識させ、内部実装は隠蔽する

### 8.4 diff 表現

v1 の diff はテキスト diff とする。

manifest の構造理解や Kubernetes リソース単位の semantic diff は対象外とする。

## 9. 拡張機能のコマンド

少なくとも以下のコマンドを提供する。

- `Helmingway: Open Preview`
  - Webview を開く
- `Helmingway: Refresh Preview`
  - 手動で再レンダリングする
- `Helmingway: Open Config`
  - 設定 YAML を開く

## 10. 内部データモデル

内部では少なくとも以下の型を持つ。

- `HelmingwayConfig`
- `EnvironmentSpec`
- `PreviewSpec`
- `DiffSpec`
- `RenderedTemplateFile`
- `RenderResult`
- `DiffRequest`

Webview と extension host のメッセージも型で定義する。

少なくとも以下の要求と応答を持つ。

- 初期状態取得
- environment 切り替え
- template 切り替え
- diff 条件変更
- 手動再レンダリング

## 11. エラー表示と状態管理

UI では少なくとも以下の状態を区別して表示する。

- 初回ロード中
- 正常表示中
- 再レンダリング中
- レンダリング失敗
- 設定ファイル不正

再レンダリング中でも前回成功結果があれば本文表示は維持する。

## 12. テスト

### 12.1 設定ファイル

- 最小構成の設定 YAML を正常に読める
- 必須項目不足を検出できる
- 不正 YAML をエラーとして扱える

### 12.2 レンダリング

- environment ごとに異なる values で別結果になる
- 出力が template 単位に分割される
- `helm template` 失敗を UI 向けエラーに変換できる

### 12.3 監視

- 設定 YAML の変更で再レンダリングされる
- values ファイルの変更で再レンダリングされる
- `templates/` の変更で再レンダリングされる
- 連続変更で不要な多重実行を抑制できる

### 12.4 Diff

- environment 間 diff が生成できる
- 差分なしを正しく表現できる
- commit 間 diff が生成できる

### 12.5 UI

- template 選択で本文が切り替わる
- diff モード切り替えで表示が更新される
- ローディング、正常、失敗の各状態を表示できる

## 13. 前提

- ユーザー環境で `helm` コマンドが利用可能であること
- 対象 chart はローカルファイルとして参照可能であること
- v1 は単一 chart を対象とし、複数 chart 管理は扱わない
- v1 の diff はテキストベースであること
