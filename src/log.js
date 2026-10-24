// log.js
//
// mdevc（mdew の VS Code 版）の一部。
// 動作の記録を、VS Code の「出力」パネルの「mdevc」に書く（mdevs の Log.cs に当たる）。

const vscode = require('vscode');

/** 「出力」パネルの「mdevc」（最初に書く時に作る）。 */
let s_channel = null;

/**
 * 「出力」パネルの「mdevc」。
 * @returns {vscode.LogOutputChannel}
 */
function channel() {
  if (!s_channel) s_channel = vscode.window.createOutputChannel('mdevc', { log: true });
  return s_channel;
}

/**
 * 記録を書く。
 * @param {string} a_message 内容
 * @param {unknown} [a_error] 例外（あれば、内容に続けて書く）
 */
function write(a_message, a_error) {
  if (a_error) channel().error(`${a_message}：${a_error instanceof Error ? (a_error.stack || a_error.message) : String(a_error)}`);
  else channel().info(a_message);
}

/** 後始末（拡張機能を止める時）。 */
function dispose() {
  if (s_channel) s_channel.dispose();
  s_channel = null;
}

module.exports = { write, dispose };
