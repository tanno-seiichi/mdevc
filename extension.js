// extension.js
//
// mdevc（mdew の VS Code 版）：拡張機能の入り口。
// .md ファイルを、mdew と同じ見た目のまま直接編集できる編集画面（カスタムエディタ。src\markdownEditor.js）で開く。
// mdevs（Visual Studio 版）の mdevsPackage.cs に当たる。

const vscode = require('vscode');
const log = require('./src/log');
const { MarkdownEditorProvider, VIEW_TYPE, openHelp } = require('./src/markdownEditor');

/**
 * コマンドの対象の文書（エディタのタイトルのボタン・右クリックのメニューから呼ばれた時はその文書、コマンドパレットから
 * 呼ばれた時は今のタブの文書）。
 * @param {vscode.Uri|undefined} a_uri VS Code が渡す文書の場所
 * @returns {vscode.Uri|undefined}
 */
function targetUri(a_uri) {
  if (a_uri instanceof vscode.Uri) return a_uri;
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText) return input.uri;
  return undefined;
}

/**
 * 拡張機能を始める（.md ファイルを開いた時等に、VS Code が呼ぶ）。
 * @param {vscode.ExtensionContext} a_context 拡張機能の情報
 */
function activate(a_context) {
  log.write(`mdevc ${a_context.extension.packageJSON.version} を始めました（VS Code ${vscode.version}）。`);
  MarkdownEditorProvider.register(a_context);
  a_context.subscriptions.push(
    // テキストエディタで開き直す（mdevc の編集画面のタイトルのボタン）
    vscode.commands.registerCommand('mdevc.openWithTextEditor', async (a_uri) => {
      const uri = targetUri(a_uri);
      if (uri) await vscode.commands.executeCommand('vscode.openWith', uri, 'default');
    }),
    // mdevc で開き直す（Markdown のテキストエディタのタイトルのボタン・エクスプローラーの右クリック）
    vscode.commands.registerCommand('mdevc.openWithMdevc', async (a_uri) => {
      const uri = targetUri(a_uri);
      if (uri) await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
    }),
    // ヘルプを開く（コマンドパレット。編集画面の右クリックの「ヘルプを開く」と同じ）
    vscode.commands.registerCommand('mdevc.openHelp', () => openHelp(a_context)),
  );
}

/** 拡張機能を止める。 */
function deactivate() {
  log.dispose();
}

module.exports = { activate, deactivate };
