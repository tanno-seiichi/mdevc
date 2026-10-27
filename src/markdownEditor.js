// markdownEditor.js
//
// mdevc（mdew の VS Code 版）の一部。
// .md ファイルの編集画面（VS Code のカスタムエディタ）。webview に画面（web フォルダ。mdevs の画面を元にしたもの）を表示し、
// VS Code のテキストの文書との同期、画像の貼り付け、リンクを開く等、画面側（web\js\main.js）とのやり取りを受け持つ。
// mdevs の MarkdownWebHost.cs・MarkdownEditorPane.cs に当たる。
//
// 文書の内容は VS Code のテキストの文書（TextDocument）が持つ。保存・元に戻す（メニューの「元に戻す」）・未保存の印・
// バックアップ・ほかのアプリでの変更の検出は VS Code が行う。
//  - 画面で編集した：画面側が少し待ってから edit で内容を送ってくるので、文書の変わった部分だけを書き換える
//  - 保存する直前：画面側に flush で最新の内容を求めて、文書に反映してから保存させる（onWillSaveTextDocument）
//  - VS Code の側で文書が変わった（「フォルダーを指定して置換」・元に戻す・ファイルを元に戻す・ほかのアプリでの変更等）：
//    setMarkdown で新しい内容を画面側に送る

const vscode = require('vscode');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const log = require('./log');
const images = require('./images');
const { language, t } = require('./i18n');
const { OutlineView } = require('./outlineView');

/** カスタムエディタの種類の名前（package.json の customEditors の viewType）。 */
const VIEW_TYPE = 'mdevc.markdownEditor';
/** 保存する直前に、画面側から最新の内容を受け取るのを待つ時間（ミリ秒）。 */
const FLUSH_TIMEOUT_MS = 3000;
/** 表の行数・列数の最大値（mdevs の TableSizeDialog と同じ）。 */
const MAX_TABLE_ROWS = 50;
const MAX_TABLE_COLS = 20;

/** ヘルプのファイル名（拡張機能の help フォルダ。日本語・英語）。 */
const HELP_FILES = { ja: 'HELP.md', en: 'HELP.en.md' };

/**
 * ヘルプのファイル（右クリックの「ヘルプを開く」で、読み取り専用で開く）。言語（設定の mdevc.language。自動の時は
 * VS Code の表示言語）が日本語の時は help\HELP.md（日本語）、それ以外の時は help\HELP.en.md（英語）。
 * @param {vscode.ExtensionContext} a_context 拡張機能の情報
 * @returns {vscode.Uri}
 */
function helpUri(a_context) {
  const file = 'ja' === language() ? HELP_FILES.ja : HELP_FILES.en;
  return vscode.Uri.joinPath(a_context.extensionUri, 'help', file);
}

/**
 * ヘルプのファイル（日本語・英語のどちらか）か。
 * @param {vscode.ExtensionContext} a_context 拡張機能の情報
 * @param {vscode.Uri} a_uri 文書の場所
 * @returns {boolean}
 */
function isHelpUri(a_context, a_uri) {
  if ('file' !== a_uri.scheme) return false;
  const target = path.normalize(a_uri.fsPath).toLowerCase();
  return Object.values(HELP_FILES).some((f) =>
    path.normalize(vscode.Uri.joinPath(a_context.extensionUri, 'help', f).fsPath).toLowerCase() === target);
}

/**
 * ヘルプを開く（mdevc の編集画面で、読み取り専用で開く）。
 * @param {vscode.ExtensionContext} a_context 拡張機能の情報
 */
async function openHelp(a_context) {
  await vscode.commands.executeCommand('vscode.openWith', helpUri(a_context), VIEW_TYPE);
}

/**
 * 改行を LF にそろえる（画面側は LF で扱う）。
 * @param {string} a_text 文字列
 * @returns {string}
 */
const toLf = (a_text) => a_text.replace(/\r\n?/g, '\n');

/**
 * 文書の内容を a_newText にするための、変わった部分だけの書き換え（先頭と末尾の同じ部分を除いた範囲）。
 * VS Code の「元に戻す」の単位・カーソル位置・装飾が、変わっていない部分で崩れないようにする。
 * @param {vscode.TextDocument} a_document 文書
 * @param {string} a_newText 新しい内容（文書の改行の種類にしたもの）
 * @returns {{range: vscode.Range, text: string}|null} 同じなら null
 */
function minimalChange(a_document, a_newText) {
  const oldText = a_document.getText();
  if (oldText === a_newText) return null;
  const max = Math.min(oldText.length, a_newText.length);
  let prefix = 0;
  while (prefix < max && oldText.charCodeAt(prefix) === a_newText.charCodeAt(prefix)) prefix++;
  let suffix = 0;
  while (suffix < max - prefix &&
    oldText.charCodeAt(oldText.length - 1 - suffix) === a_newText.charCodeAt(a_newText.length - 1 - suffix)) suffix++;
  // CRLF の間で切らない
  if (prefix > 0 && '\r' === oldText[prefix - 1]) prefix--;
  if (suffix > 0 && '\n' === oldText[oldText.length - suffix] && '\r' === oldText[oldText.length - suffix - 1]) suffix--;
  const range = new vscode.Range(a_document.positionAt(prefix), a_document.positionAt(oldText.length - suffix));
  return { range, text: a_newText.slice(prefix, a_newText.length - suffix) };
}

/**
 * 「ツール」の設定（package.json の contributes.configuration の mdevc.*）を、画面側の settings のメッセージにする
 * （main.js の applySettings。mdevs の MdevsSettings.CreateMessage と同じ形）。
 * @returns {object}
 */
function createSettingsMessage() {
  const config = vscode.workspace.getConfiguration('mdevc');
  return {
    cmd: 'settings',
    docStyle: 'vscode' === config.get('docStyle') ? 'vscode' : 'github',
    textColor: 'soft' === config.get('textColor') ? 'soft' : 'sharp',
    fullWidth: 'full' === config.get('docWidth'),
    joinSoftBreaks: 'source' !== config.get('softBreak'),
    // 画面の言語（'ja'・'en'。設定の mdevc.language。自動の時は VS Code の表示言語。i18n.js）
    language: language(),
  };
}

/** 1つの編集画面（webview）と、その文書。 */
class MarkdownEditor {
  /**
   * @param {vscode.ExtensionContext} a_context 拡張機能の情報
   * @param {vscode.TextDocument} a_document 文書
   * @param {vscode.WebviewPanel} a_panel 編集画面
   * @param {OutlineView} a_outlineView サイドバーの「mdevc アウトライン」
   */
  constructor(a_context, a_document, a_panel, a_outlineView) {
    this.context = a_context;
    this.outlineView = a_outlineView;
    /** 画面側の見出し（{level, text} の配列）と、検索で見つかった箇所を含む見出し・今の箇所の見出しの番号。 */
    this.outline = { items: [], hits: [], current: -1 };
    this.document = a_document;
    this.panel = a_panel;
    /** 画面側の準備ができたか（ready が届いた）。 */
    this.ready = false;
    /** 画面側の内容（最後に受け取った・送った内容。改行は LF）。VS Code の文書がこれと同じ時は、画面側に送らない。 */
    this.webText = null;
    /** 文書に反映している途中の内容（改行は LF。反映の途中で届く文書の変更の通知を、画面側に送らないため）。 */
    this.applyingText = null;
    /** 文書に反映している途中か（反映は1つずつ順に行う）。 */
    this.applying = false;
    /** flush の結果を待っている要求（番号 → 結果を受け取る関数）。 */
    this.flushWaiters = new Map();
    this.nextFlushId = 1;
    /** 後始末するもの。 */
    this.disposables = [];
    /** 読み取り専用か（ヘルプ。画面側で編集できなくし、文書にも反映しない）。 */
    this.readOnly = isHelpUri(a_context, a_document.uri);

    const webview = a_panel.webview;
    webview.options = { enableScripts: true, localResourceRoots: this.resourceRoots() };
    webview.html = this.buildHtml();
    this.disposables.push(
      webview.onDidReceiveMessage((a_msg) => this.onMessage(a_msg)),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document === this.document) this.onDocumentChanged(e);
      }),
      vscode.workspace.onWillSaveTextDocument((e) => {
        if (e.document === this.document) e.waitUntil(this.flush());
      }),
      vscode.workspace.onDidSaveTextDocument((a_doc) => {
        if (a_doc === this.document) this.onSaved();
      }),
    );
    a_panel.onDidDispose(() => this.dispose());
    // 「mdevc アウトライン」には、今アクティブな編集画面の見出しを表示する
    a_panel.onDidChangeViewState(() => {
      if (a_panel.active) this.outlineView.setEditor(this);
    });
    if (a_panel.active) this.outlineView.setEditor(this);
    log.write(`開きました：${this.displayPath}`);
  }

  /** 記録に書く文書の場所。 */
  get displayPath() {
    return 'file' === this.document.uri.scheme ? this.document.uri.fsPath : this.document.uri.toString();
  }

  /** 文書のフォルダ（画像・リンクの相対パスの基準。保存していない新規の文書は null）。 */
  get docFolder() {
    return 'untitled' === this.document.uri.scheme ? null : vscode.Uri.joinPath(this.document.uri, '..');
  }

  /**
   * webview が読み込めるフォルダ：画面（web フォルダ）、文書のドライブ全体（文書の外の画像を相対パス・絶対パスで書いた
   * 場合も表示できるように。mdevs と同じ）、ワークスペースのフォルダ。
   * @returns {vscode.Uri[]}
   */
  resourceRoots() {
    const roots = [vscode.Uri.joinPath(this.context.extensionUri, 'web')];
    const folder = this.docFolder;
    if (folder) {
      roots.push('file' === folder.scheme ? vscode.Uri.file(path.parse(folder.fsPath).root) : folder);
    }
    for (const f of vscode.workspace.workspaceFolders || []) roots.push(f.uri);
    return roots;
  }

  /**
   * 画面の HTML（web\index.html に、読み込み元の場所・セキュリティの設定・最初の設定と配色を入れたもの）。
   * @returns {string}
   */
  buildHtml() {
    const webview = this.panel.webview;
    const webDir = vscode.Uri.joinPath(this.context.extensionUri, 'web');
    const nonce = crypto.randomBytes(16).toString('base64');
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} https: http: data: blob:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource} data:`,
      `script-src 'nonce-${nonce}' ${webview.cspSource}`,
    ].join('; ');
    const kind = vscode.window.activeColorTheme.kind;
    const dark = vscode.ColorThemeKind.Dark === kind || vscode.ColorThemeKind.HighContrast === kind;
    let html = fs.readFileSync(path.join(webDir.fsPath, 'index.html'), 'utf8');
    // 読み込み元（./app.css・./js/main.js 等）を web フォルダにする（文書を開くと、main.js が文書のフォルダに変える）
    html = html.replace('<head>', `<head>
  <base href="${webview.asWebviewUri(webDir)}/" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <script nonce="${nonce}">window.__mdevsSettings = ${JSON.stringify(createSettingsMessage())};</script>`);
    html = html.replace('<script type="module"', `<script nonce="${nonce}" type="module"`);
    // 画面が一瞬白く表示されないよう、最初の配色を VS Code の配色の種類で合わせておく（色は host.js が読んで合わせる）
    html = html.replace(/<body>/, `<body${dark ? ' class="theme-dark"' : ''}>`);
    return html;
  }

  /**
   * 画面側にメッセージを送る。
   * @param {object} a_message メッセージ
   */
  post(a_message) {
    this.panel.webview.postMessage(a_message);
  }

  /** 設定を画面側に送る（起動時と、設定を変えた時）。 */
  postSettings() {
    if (this.ready) this.post(createSettingsMessage());
  }

  /** 文書の内容を画面側に表示させる（load を送る）。 */
  postLoad() {
    const text = toLf(this.document.getText());
    this.webText = text;
    const folder = this.docFolder;
    this.post({
      cmd: 'load',
      path: this.displayPath,
      name: path.posix.basename(this.document.uri.path),
      docBase: folder ? `${this.panel.webview.asWebviewUri(folder)}/` : null,
      markdown: text,
      force: true,
    });
    // 保存していない内容（VS Code を閉じる前の編集を、VS Code が戻した時等）は、画面側も未保存の状態にする
    if (this.document.isDirty) this.post({ cmd: 'dirtyState', dirty: true });
  }

  /**
   * 画面側からのメッセージを処理する（cmd ごとに振り分ける）。VS Code の中では使わないもの（ファイルを開く・フォルダ・
   * 最近使ったファイル等）は無視する。
   * @param {{cmd: string}} a_msg メッセージ
   */
  async onMessage(a_msg) {
    try {
      switch (a_msg.cmd) {
        case 'ready':
          this.ready = true;
          this.post({ cmd: 'init', debug: false, tempDir: null });
          if (this.readOnly) this.post({ cmd: 'readOnly', value: true });
          this.postSettings();
          this.postLoad();
          // 設定・文書を送り終えたので、画面を見せてもらう（起動直後のちらつき防止。main.js の reveal）
          this.post({ cmd: 'reveal' });
          break;
        case 'edit':
          if (!this.readOnly) await this.applyWebText(a_msg.markdown);
          break;
        case 'outline':
          this.outline = { items: a_msg.items || [], hits: [], current: -1 };
          this.outlineView.onOutlineChanged(this);
          break;
        case 'outlineMarks':
          this.outline = { ...this.outline, hits: a_msg.hits || [], current: a_msg.current ?? -1 };
          this.outlineView.onOutlineChanged(this);
          break;
        case 'openHelp':
          await openHelp(this.context);
          break;
        case 'flushed': {
          const resolve = this.flushWaiters.get(a_msg.id);
          this.flushWaiters.delete(a_msg.id);
          if (resolve) resolve(a_msg.markdown);
          break;
        }
        case 'alert':
          vscode.window.showWarningMessage(a_msg.message);
          break;
        case 'devTools':
          await vscode.commands.executeCommand('workbench.action.webview.openDeveloperTools');
          break;
        case 'openUrl':
          await this.openUrl(a_msg.url);
          break;
        case 'openRelative':
          await this.openRelative(a_msg.path);
          break;
        case 'openImage':
          await this.openImage(a_msg.src);
          break;
        case 'pasteImage':
          await this.pasteImage(a_msg.id, a_msg.type, a_msg.data);
          break;
        case 'importImages':
          await this.importImages(a_msg.id, a_msg.srcs || []);
          break;
        case 'tableSizeDialog':
          await this.askTableSize();
          break;
        case 'linkDialog':
          await this.askLinkUrl();
          break;
        case 'dirty':
        case 'save':
        case 'findUpdate':
          break; // 未保存の印・保存・検索は VS Code が行う
        default:
          log.write(`未対応のメッセージ：${a_msg.cmd}`);
          break;
      }
    } catch (ex) {
      log.write(`画面側からのメッセージ（${a_msg.cmd}）の処理中にエラー`, ex);
      vscode.window.showErrorMessage(t('処理中にエラーが発生しました。{0}', ex instanceof Error ? ex.message : ex));
    }
  }

  // ===== 文書との同期 =====

  /**
   * 画面側の内容を文書に反映する（変わった部分だけを書き換える）。反映は1つずつ順に行い、反映している間に届いた内容は、
   * 終わってから最新のものだけを反映する。
   * @param {string} a_markdown 画面側の内容（改行は LF）
   */
  async applyWebText(a_markdown) {
    this.webText = a_markdown;
    if (this.applying) return;
    this.applying = true;
    try {
      while (this.applyingText !== this.webText) {
        const text = this.webText;
        this.applyingText = text;
        const change = minimalChange(this.document, this.withDocumentEol(text));
        if (change) {
          const edit = new vscode.WorkspaceEdit();
          edit.replace(this.document.uri, change.range, change.text);
          if (!(await vscode.workspace.applyEdit(edit))) log.write('編集した内容を文書に反映できませんでした。');
        }
      }
    } finally {
      this.applying = false;
      this.applyingText = null;
    }
  }

  /**
   * 改行を、文書の改行の種類（CRLF・LF）にする。
   * @param {string} a_text 内容（改行は LF）
   * @returns {string}
   */
  withDocumentEol(a_text) {
    return vscode.EndOfLine.CRLF === this.document.eol ? a_text.replace(/\n/g, '\r\n') : a_text;
  }

  /**
   * 文書が変わった時：画面側の内容と違えば（VS Code の側で変わった時）、画面側に新しい内容を送る。
   * 内容が変わらず、保存していない状態だけが変わった時は、それを知らせる。
   * @param {vscode.TextDocumentChangeEvent} e 変更の内容
   */
  onDocumentChanged(e) {
    if (!this.ready) return;
    if (0 === e.contentChanges.length) {
      this.post({ cmd: 'dirtyState', dirty: this.document.isDirty });
      return;
    }
    const text = toLf(this.document.getText());
    if (text === this.webText || text === this.applyingText) return; // 画面側で編集した内容を反映した
    this.webText = text;
    this.post({ cmd: 'setMarkdown', markdown: text, dirty: this.document.isDirty });
  }

  /**
   * 保存する直前：画面側から最新の内容を受け取り、文書に反映する書き換えを返す（VS Code が保存の前に反映する）。
   * @returns {Promise<vscode.TextEdit[]>}
   */
  flush() {
    if (!this.ready || this.readOnly) return Promise.resolve([]);
    const id = this.nextFlushId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.flushWaiters.delete(id);
        log.write('保存する内容を編集画面から受け取れませんでした（時間切れ）。文書の今の内容を保存します。');
        resolve([]);
      }, FLUSH_TIMEOUT_MS);
      this.flushWaiters.set(id, (a_markdown) => {
        clearTimeout(timer);
        this.webText = a_markdown;
        const change = minimalChange(this.document, this.withDocumentEol(a_markdown));
        resolve(change ? [vscode.TextEdit.replace(change.range, change.text)] : []);
      });
      this.post({ cmd: 'flush', id });
    });
  }

  /** 保存した時：画面側に知らせる（保存した内容を、元の内容として取り込み直す）。 */
  onSaved() {
    if (!this.ready) return;
    const folder = this.docFolder;
    this.post({
      cmd: 'saved',
      path: this.displayPath,
      name: path.posix.basename(this.document.uri.path),
      docBase: folder ? `${this.panel.webview.asWebviewUri(folder)}/` : null,
      markdown: toLf(this.document.getText()),
    });
    log.write(`保存しました：${this.displayPath}`);
  }

  // ===== リンク・画像を開く =====

  /**
   * リンク先の URL を、既定のブラウザ・メールソフトで開く（http・https・mailto だけ）。
   * @param {string} a_url リンク先の URL
   */
  async openUrl(a_url) {
    if (!/^(https?:|mailto:)/i.test(a_url || '')) {
      vscode.window.showWarningMessage(t('このリンクは開けません。{0}', a_url));
      return;
    }
    await vscode.env.openExternal(vscode.Uri.parse(a_url, true));
  }

  /**
   * 相対パスで書かれたファイルへのリンクを、開いているファイルのフォルダ基準で解決して、VS Code で開く
   * （.md ファイルは mdevc で開く）。
   * @param {string} a_relativePath リンクに書かれた相対パス（# より後ろは除いたもの）
   */
  async openRelative(a_relativePath) {
    const uri = this.docFolder ? images.resolveReference(this.document.uri, a_relativePath, false) : null;
    if (!uri || !(await images.exists(uri))) {
      vscode.window.showWarningMessage(t('リンク先のファイルが見つかりません。{0}', a_relativePath));
      return;
    }
    await vscode.commands.executeCommand('vscode.open', uri);
  }

  /**
   * 画像を既定のアプリで開く（画像のダブルクリック・右クリックの「画像を開く」）。
   * @param {string} a_src 画像の参照先（文書に書かれたまま）
   */
  async openImage(a_src) {
    const src = (a_src || '').trim();
    if (/^https?:/i.test(src)) {
      await this.openUrl(src);
      return;
    }
    const uri = this.docFolder || /^(file:|[a-zA-Z]:[\\/])/i.test(src) ? images.resolveReference(this.document.uri, src) : null;
    if (!uri || !(await images.exists(uri))) {
      vscode.window.showWarningMessage(t('この画像は開けません（元のファイルが見つからないか、埋め込みの画像です）。{0}', src));
      return;
    }
    await vscode.env.openExternal(uri);
  }

  // ===== 画像の貼り付け =====

  /**
   * 保存していない新規の文書には、画像を貼り付けられないことを知らせる。
   * @returns {boolean} 貼り付けられるか
   */
  canStoreImages() {
    if (this.docFolder) return true;
    vscode.window.showWarningMessage(t('画像を貼り付けるには、先にファイルを保存してください（画像はファイルの隣の「<ファイル名>.images」フォルダに保存します）。'));
    return false;
  }

  /**
   * 貼り付けられた画像を「<ファイル名>.images\clipboard_image_連番.拡張子」に保存し、その相対パスを画面側へ返す
   * （imagePasted を送る）。
   * @param {number} a_id 画面側が付けた画像の番号（そのまま返す）
   * @param {string} a_mimeType 画像の種類（image/png 等）
   * @param {string} a_base64 画像のデータ（Base64）
   */
  async pasteImage(a_id, a_mimeType, a_base64) {
    if (!this.canStoreImages()) return;
    try {
      const rel = await images.savePastedImage(this.document.uri, a_mimeType, a_base64);
      this.post({ cmd: 'imagePasted', id: a_id, url: rel, alt: path.posix.basename(rel).replace(/\.[^.]*$/, '') });
    } catch (ex) {
      log.write('クリップボードの画像を保存できませんでした', ex);
      vscode.window.showErrorMessage(t('クリップボードの画像を貼り付けられませんでした。{0}', ex instanceof Error ? ex.message : ex));
    }
  }

  /**
   * 他のアプリが置いた画像のファイル（Excel の一時ファイル等。file:///…）を、「<ファイル名>.images」へコピーする。
   * 結果は imagesImported で返す。
   * @param {number} a_id 画面側が付けた要求の番号（そのまま返す）
   * @param {string[]} a_srcs 画像の参照先
   */
  async importImages(a_id, a_srcs) {
    const urls = [];
    const canStore = this.docFolder !== null;
    for (const src of a_srcs) {
      let url = null;
      if (canStore) {
        try {
          url = await images.importImage(this.document.uri, src);
        } catch (ex) {
          log.write('貼り付けた画像をコピーできませんでした', ex);
        }
      }
      urls.push(url);
    }
    this.post({ cmd: 'imagesImported', id: a_id, urls });
  }

  // ===== ダイアログ =====

  /** 右クリックのメニュー「表を挿入…」：行数・列数を聞く（結果は tableSize。取りやめは 0 行 0 列）。 */
  async askTableSize() {
    const parse = (a_text) => {
      const m = /^\s*(\d+)\s*[xX×*,、\s]\s*(\d+)\s*$/.exec(a_text || '');
      return m ? { rows: Number(m[1]), cols: Number(m[2]) } : null;
    };
    const value = await vscode.window.showInputBox({
      title: t('表を挿入'),
      prompt: t('行数（見出し行を含む）× 列数を入力してください（例：3x3）'),
      value: '3x3',
      validateInput: (a_text) => {
        const size = parse(a_text);
        if (!size) return t('「行数x列数」の形で入力してください（例：3x3）');
        if (size.rows < 1 || size.rows > MAX_TABLE_ROWS) return t('行数は 1〜{0} にしてください', MAX_TABLE_ROWS);
        if (size.cols < 1 || size.cols > MAX_TABLE_COLS) return t('列数は 1〜{0} にしてください', MAX_TABLE_COLS);
        return null;
      },
    });
    const size = undefined === value ? null : parse(value);
    this.post({ cmd: 'tableSize', rows: size ? size.rows : 0, cols: size ? size.cols : 0 });
  }

  /** 右クリックのメニュー「リンクにする…」：リンク先の URL を聞く（結果は linkUrl。取りやめは空）。 */
  async askLinkUrl() {
    const value = await vscode.window.showInputBox({
      title: t('リンクにする'),
      prompt: t('リンク先の URL を入力してください'),
      placeHolder: 'https://',
    });
    this.post({ cmd: 'linkUrl', url: (value || '').trim() });
  }

  // ===== 後始末 =====

  /** 編集画面を閉じた時。 */
  dispose() {
    if (this.outlineView.editor === this) this.outlineView.setEditor(null);
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    for (const resolve of this.flushWaiters.values()) resolve(this.webText ?? toLf(this.document.getText()));
    this.flushWaiters.clear();
    log.write(`閉じました：${this.displayPath}`);
  }
}

/** mdevc のカスタムエディタ（.md ファイルを開く時に、編集画面を作る）。 */
class MarkdownEditorProvider {
  /**
   * カスタムエディタを登録する。
   * @param {vscode.ExtensionContext} a_context 拡張機能の情報
   * @returns {MarkdownEditorProvider}
   */
  static register(a_context) {
    const provider = new MarkdownEditorProvider(a_context);
    provider.outlineView = new OutlineView(a_context);
    a_context.subscriptions.push(
      vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
        // 隠れているタブも画面を残しておく（切り替えるたびに読み直さない。画面側の元に戻す・表示の位置も残る）
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }),
      // 設定を変えたら、開いているすべての編集画面にすぐに反映する
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration('mdevc')) return;
        log.write('設定が変わりました。');
        for (const editor of provider.editors) editor.postSettings();
        // 言語を変えた時は、サイドバーの「mdevc アウトライン」の文字も作り直す
        if (e.affectsConfiguration('mdevc.language')) provider.outlineView.refresh();
      }),
    );
    return provider;
  }

  /**
   * @param {vscode.ExtensionContext} a_context 拡張機能の情報
   */
  constructor(a_context) {
    this.context = a_context;
    /** 開いている編集画面。 */
    this.editors = new Set();
    /** サイドバーの「mdevc アウトライン」（register で作る）。 */
    this.outlineView = null;
  }

  /**
   * .md ファイルを開いた時に、編集画面を作る（VS Code が呼ぶ）。
   * @param {vscode.TextDocument} a_document 文書
   * @param {vscode.WebviewPanel} a_panel 編集画面
   */
  resolveCustomTextEditor(a_document, a_panel) {
    const editor = new MarkdownEditor(this.context, a_document, a_panel, this.outlineView);
    this.editors.add(editor);
    a_panel.onDidDispose(() => this.editors.delete(editor));
  }
}

module.exports = { MarkdownEditorProvider, VIEW_TYPE, minimalChange, openHelp };
