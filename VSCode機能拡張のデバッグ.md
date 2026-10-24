# VSCode機能拡張のデバッグ

`launch.json` を置いて起動する方法が確実です。

1. `mdevc` フォルダの中に `.vscode` フォルダを作ります。
2. 前にチャットで送った `launch.json` をそこに保存します。手元にない場合は、次の内容で `mdevc\.vscode\launch.json` を作ってください。

json

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "mdevc を実行",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}"]
    }
  ]
}
```

3. VS Code で `mdevc` フォルダを開いたまま F5 を押します。

新しい VS Code のウィンドウ（タイトルに「拡張機能開発ホスト」と出ます）が開いたら起動成功です。そのウィンドウで `.md` ファイルを開いて試してください。
