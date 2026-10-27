// i18n.js
//
// 拡張機能の側（VS Code に出すお知らせ・入力欄等）の文字の英語対応（日本語・英語の切り替え）。
// 画面側（web\js\i18n.js）と同じく、日本語の文字をそのままキーにして書き（t('表を挿入')）、英語の時はこの辞書の英語を
// 返す。文字の中の {0}・{1}… は、t の 2 つ目以降の引数で置き換える。
// 言語は、設定の「言語」（mdevc.language）。auto（既定）の時は VS Code の表示言語（日本語なら日本語、それ以外は英語）。

const vscode = require('vscode');

/** 英語の辞書（日本語 → 英語）。 */
const EN = {
  '処理中にエラーが発生しました。{0}': 'An error occurred. {0}',
  'このリンクは開けません。{0}': 'This link cannot be opened. {0}',
  'リンク先のファイルが見つかりません。{0}': 'The linked file was not found. {0}',
  'この画像は開けません（元のファイルが見つからないか、埋め込みの画像です）。{0}':
    'This image cannot be opened (the original file was not found, or it is an embedded image). {0}',
  '画像を貼り付けるには、先にファイルを保存してください（画像はファイルの隣の「<ファイル名>.images」フォルダに保存します）。':
    'Save the file before pasting images (images are saved in the "<file name>.images" folder next to the file).',
  'クリップボードの画像を貼り付けられませんでした。{0}': 'Could not paste the image from the clipboard. {0}',
  '表を挿入': 'Insert Table',
  '行数（見出し行を含む）× 列数を入力してください（例：3x3）': 'Enter the number of rows (including the header row) × columns (e.g. 3x3)',
  '「行数x列数」の形で入力してください（例：3x3）': 'Enter it as "rows x columns" (e.g. 3x3)',
  '行数は 1〜{0} にしてください': 'The number of rows must be 1 to {0}',
  '列数は 1〜{0} にしてください': 'The number of columns must be 1 to {0}',
  'リンクにする': 'Make Link',
  'リンク先の URL を入力してください': 'Enter the URL of the link',
  '見出しがありません。': 'There are no headings.',
  '見出しへ移動': 'Go to Heading',
};

/**
 * 今の言語。
 * @returns {'ja'|'en'}
 */
function language() {
  const setting = vscode.workspace.getConfiguration('mdevc').get('language');
  if ('ja' === setting || 'en' === setting) return setting;
  return vscode.env.language.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

/**
 * 文字を、今の言語にする。
 * @param {string} a_text 日本語の文字（辞書のキー）
 * @param {...(string|number)} a_args {0}・{1}… に入れる値
 * @returns {string}
 */
function t(a_text, ...a_args) {
  const text = 'en' === language() && Object.prototype.hasOwnProperty.call(EN, a_text) ? EN[a_text] : a_text;
  return a_args.length ? text.replace(/\{(\d+)\}/g, (m, i) => (i < a_args.length ? String(a_args[i]) : m)) : text;
}

module.exports = { language, t };
