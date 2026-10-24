// mdevc（mdew の VS Code 版）：VS Code（拡張機能の側。extension.js）とのやり取りの窓口、キー入力の振り分け、
// VS Code の配色の読み取り。
//
// 画面（main.js 等）は mdevs（Visual Studio 版）と同じものを使い、WebView2 の window.chrome.webview の代わりに、
// ここの host（VS Code の webview の acquireVsCodeApi を同じ形にしたもの）でメッセージをやり取りする。

/** VS Code の webview の窓口。ブラウザ単体で開いた場合（動作確認用）は null。 */
// eslint-disable-next-line no-undef
const vscode = 'function' === typeof acquireVsCodeApi ? acquireVsCodeApi() : null;

/**
 * ホストとのやり取りの窓口（WebView2 の window.chrome.webview と同じ形。main.js の send・メッセージの受け取りで使う）。
 * ブラウザ単体で開いた場合は null。
 */
export const host = vscode ? {
  /**
   * ホストへメッセージを送る。
   * @param {string|object} a_message メッセージ（JSON の文字列か、オブジェクト）
   */
  postMessage(a_message) {
    vscode.postMessage('string' === typeof a_message ? JSON.parse(a_message) : a_message);
  },
  /**
   * ホストからのメッセージを受け取る（ev.data がメッセージのオブジェクト）。
   * @param {string} a_type イベントの種類（'message'）
   * @param {(ev: MessageEvent) => void} a_listener 受け取る関数
   */
  addEventListener(a_type, a_listener) {
    window.addEventListener(a_type, a_listener);
  },
} : null;

if (vscode) {
  // VS Code が webview に入れる既定の見た目（body の余白・code・引用・リンクの色等）は使わない（mdevs と同じ見た目にする）
  document.getElementById('_defaultStyles')?.remove();
  // VS Code の webview では alert・confirm が使えない（何も表示されない）ため、alert は VS Code の通知で出す。
  // confirm（mdew で、保存していない変更を破棄して別のファイルを開く時等の確認）は、VS Code の中では別のタブで開くため
  // 確認は要らない（常に「はい」）
  window.alert = (a_message) => vscode.postMessage({ cmd: 'alert', message: String(a_message ?? '') });
  window.confirm = () => true;
}

// ===== VS Code の配色 =====

/** 暗い配色の時に画面へ渡す色（main.js の applyTheme の値の名前 → VS Code が webview に入れる CSS の変数）。 */
const THEME_COLORS = {
  bg: '--vscode-editor-background',
  fg: '--vscode-editor-foreground',
  border: '--vscode-panel-border',
  menuBg: '--vscode-menu-background',
  menuFg: '--vscode-menu-foreground',
  menuBorder: '--vscode-menu-border',
  menuHover: '--vscode-menu-selectionBackground',
  menuHoverFg: '--vscode-menu-selectionForeground',
  menuSep: '--vscode-menu-separatorBackground',
};

/**
 * VS Code の配色（暗いか・色）を読む。VS Code は、配色の種類を body のクラス（vscode-light・vscode-dark・
 * vscode-high-contrast・vscode-high-contrast-light）で、色を html の CSS の変数（--vscode-*）で知らせる。
 * @returns {{dark: boolean}|null} main.js の applyTheme に渡す値（暗い時は色も）。VS Code がまだ配色を入れていなければ null
 *   （最初の配色は、ホストが HTML に入れてある。markdownEditor.js の buildHtml）
 */
function readTheme() {
  const cls = document.body.classList;
  if (![...cls].some((c) => c.startsWith('vscode-'))) return null;
  const dark = cls.contains('vscode-dark') || (cls.contains('vscode-high-contrast') && !cls.contains('vscode-high-contrast-light'));
  const theme = { dark };
  if (dark) {
    const style = getComputedStyle(document.documentElement);
    for (const [name, cssVar] of Object.entries(THEME_COLORS)) {
      const value = style.getPropertyValue(cssVar).trim();
      if (value) theme[name] = value;
    }
  }
  return theme;
}

/**
 * VS Code の配色に合わせる（今すぐと、配色が変わった時）。
 * @param {(theme: {dark: boolean}) => void} a_apply 配色を画面に反映する関数（main.js の applyTheme）
 */
export function watchTheme(a_apply) {
  if (!vscode) return;
  let last = '';
  const update = () => {
    const theme = readTheme();
    if (!theme) return;
    const key = JSON.stringify(theme);
    if (key === last) return; // a_apply が body のクラスを変えた時も呼ばれるので、変わっていなければ何もしない
    last = key;
    a_apply(theme);
  };
  update();
  const observer = new MutationObserver(update);
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
}

// ===== キー入力の振り分け =====

/**
 * Ctrl を押しながらの時に、編集画面で使うキー（KeyboardEvent の code）。mdevs の KeyboardRouter と同じ：すべて選択・
 * コピー・切り取り・貼り付け（A・C・X・V・Insert）、元に戻す・やり直し（Z・Y）、太字・斜体・下線（B・I・U）、単語単位の
 * 移動・削除（矢印・Home・End・BackSpace・Delete）、表の行の挿入（Enter）、表示倍率（テンキーの +・-・0）。
 */
const CTRL_EDITOR_CODES = new Set([
  'KeyA', 'KeyB', 'KeyC', 'KeyI', 'KeyU', 'KeyV', 'KeyX', 'KeyY', 'KeyZ', 'Insert',
  'Backspace', 'Delete', 'Enter', 'NumpadEnter', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'Home', 'End',
  'NumpadAdd', 'NumpadSubtract', 'Numpad0',
]);
/** Ctrl を押しながらの時に、編集画面で使うキー（KeyboardEvent の key）：インラインコード（Ctrl+Shift+`。日本語キーボードは
 * @ のキー）、表示倍率（+・=・;・-・0）。 */
const CTRL_EDITOR_KEYS = new Set(['`', '@', '+', '=', ';', '-', '0']);

/**
 * キーの行き先。
 *  - 'editor'：編集画面（VS Code には渡さない）
 *  - 'find'・'replace'：検索と置換のバー（Ctrl+F・Ctrl+H）
 *  - 'vscode'：VS Code（Ctrl+S・Ctrl+P・Ctrl+Tab・Ctrl+W・ファンクションキー・Alt のメニュー等。VS Code の設定どおりに動く）
 * 編集画面で使うキーは mdevs の KeyboardRouter と同じ：Ctrl・Alt なしのキーはファンクションキー以外すべて（文字・Enter・
 * Tab・Esc・矢印・IME 等。ファンクションキーは F12（開発者ツール）だけ）、Ctrl のキーは CTRL_EDITOR_CODES・CTRL_EDITOR_KEYS、
 * Alt+Shift+5（取り消し線）。
 * @param {KeyboardEvent} e キーのイベント
 * @returns {'editor'|'find'|'replace'|'vscode'}
 */
function keyTarget(e) {
  if (e.altKey) {
    return !e.ctrlKey && e.shiftKey && 'Digit5' === e.code ? 'editor' : 'vscode';
  }
  if (e.ctrlKey || e.metaKey) {
    if ('KeyF' === e.code) return e.shiftKey ? 'vscode' : 'find';
    if ('KeyH' === e.code) return e.shiftKey ? 'vscode' : 'replace';
    return CTRL_EDITOR_CODES.has(e.code) || CTRL_EDITOR_KEYS.has(e.key) ? 'editor' : 'vscode';
  }
  if (/^F\d+$/.test(e.key)) {
    return 'F12' === e.key && !e.shiftKey ? 'editor' : 'vscode';
  }
  return 'editor';
}

/**
 * キー入力を、VS Code のショートカットと編集画面とに振り分ける。VS Code は、webview の中で押されたキーを window で受け取って
 * VS Code のショートカットとして処理する（太字の Ctrl+B でサイドバーが開閉する等）ので、編集画面で使うキーは document で
 * 止めて、window へ届かないようにする。
 * @param {object} a_handlers 処理
 * @param {(replace: boolean) => void} a_handlers.openFind 検索と置換のバーを開く
 * @param {(e: KeyboardEvent) => boolean} a_handlers.handleKey 振り分けの前に処理するキー（検索と置換のバーを開いている時の
 *   F3・Esc。処理したら true を返し、VS Code には渡さない）
 */
export function installKeyRouter(a_handlers) {
  if (!vscode) return;
  document.addEventListener('keydown', (e) => {
    if (a_handlers.handleKey(e)) {
      e.stopPropagation();
      return;
    }
    const target = keyTarget(e);
    if ('vscode' === target) return;
    e.stopPropagation();
    if ('find' === target || 'replace' === target) {
      e.preventDefault();
      a_handlers.openFind('replace' === target);
    }
  });
}
