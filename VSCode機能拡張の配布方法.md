# VSCode機能拡張の配布方法

VSIX ファイルにして渡すのが一番簡単です。mdevs と同じ考え方です。

**1. VSIX を作る**

Node.js が入っている PC で、`mdevc` フォルダで次のコマンドを実行します。

```
npx @vscode/vsce package --allow-missing-repository
```

`mdevc-0.0.1.vsix` ができます。これが配布するファイルです。必要なものはすべてこの 1 つに入っています。

**2. 相手に渡す**

メールや共有フォルダなどで `.vsix` ファイルを渡します。

**3. 相手がインストールする**

- VS Code の「拡張機能」ビュー（`Ctrl+Shift+X`）を開きます。
- 右上の「…」→「VSIX からのインストール...」で、受け取ったファイルを選びます。
- コマンドで入れる場合は `code --install-extension mdevc-0.0.1.vsix` です。

インストールすると、拡張機能の一覧の mdevc の詳細ページに README と変更履歴（CHANGELOG）が表示されます。

**更新版を配るとき**

1. `package.json` の `"version"`（今は `0.0.1`）を上げます。
2. `CHANGELOG.md` に変更内容を書きます。
3. もう一度 VSIX を作って渡します。

相手は同じ手順でインストールすれば、上書きで更新されます。

**誰でも検索して入れられるようにしたい場合**

Visual Studio Marketplace に公開すると、VS Code の拡張機能の検索から誰でもインストールでき、更新も自動で届きます。そのためには、Microsoft のアカウントで発行者（publisher）を登録して `vsce publish` で公開します。`package.json` の `publisher`（今は `tanno-seiichi`）は、登録した発行者の ID と一致させる必要があります。公開したくなったら手順を詳しく説明します。
