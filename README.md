# helmingway

## Features

- [ ] VSCode 拡張として、[設定](./helmingway.yaml)に基づいて Helm チャートの alias ごとのレンダリング結果をプレビューできる
- [ ] VSCode 上のプレビューで、レンダリング結果をファイル単位に絞り込める
- [ ] VSCode 上のプレビューで、レンダリング結果を Kubernetes リソース単位に絞り込める
- [ ] VSCode 上で、Helm チャートのレンダリング結果について alias 間の差分をチェックできる
- [ ] VSCode 上で、Helm チャートのレンダリング結果と実際の Kubernetes リソースとの差分をチェックできる
- [ ] VSCode 上で、Helm チャートのレンダリング結果について git commit 間の差分をチェックできる

## Release Scope

- [ ] Helmingway の Side View から chart / alias / resource を選択してプレビューを開ける
- [ ] Explorer の右クリックメニューから [設定](./helmingway.yaml) を起点にプレビューを開ける
- [ ] エディタ右上のタイトルバーから [設定](./helmingway.yaml) を起点にプレビューを開ける

## Implementation Steps

- [x] Step 1: VSCode 拡張として起動できる最小構成を作る
- [x] Step 2: 空の Side View を表示する
- [x] Step 3: [設定](./helmingway.yaml) を読み込んで chart / alias を表示する
- [x] Step 4: alias をクリックしたら仮のプレビューを開く
- [x] Step 5: `helm template` を実行して alias ごとのレンダリング結果を表示する
- [x] Step 6: reload で alias ごとの `helm template` を再実行する
- [x] Step 7: alias ごとのレンダリング結果をキャッシュする
- [ ] Step 8: alias ごとのレンダリング状態を管理する
- [ ] Step 9: alias のレンダリング状態を Side View に表示する
- [ ] Step 10: プレビュー表示をキャッシュ参照に切り替える
