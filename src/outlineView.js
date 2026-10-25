// outlineView.js
//
// mdevc（mdew の VS Code 版）の一部。
// エクスプローラーのサイドバーの「mdevc アウトライン」（今の mdevc の編集画面の見出しの一覧）。
//
// VS Code 標準の「アウトライン」（Outline）は、テキストエディタの文書の見出ししか表示できず、mdevc のような独自の
// 編集画面（カスタムエディタ）からは使えないため（VS Code 1.142 で試験中の機能として入ったが、配布する拡張機能では
// まだ使えない）、同じ形のビューを別に用意する。
//  - 見出しの階層を木の形で表示する（折りたたみもできる）。見出しをクリックすると、その見出しへ移動する
//  - 検索で見つかった箇所を含む見出しは、文字を強調する（アイコンは付けない）。今の箇所の見出しは選択した状態にする
// 見出しと検索の印は、編集画面（web\js\main.js の sendOutline・sendOutlineMarks）から届く。

const vscode = require('vscode');

/** ビューの名前（package.json の contributes.views）。 */
const VIEW_ID = 'mdevc.outline';
/** 見出しをクリックした時のコマンド（package.json の contributes.commands）。 */
const REVEAL_COMMAND = 'mdevc.revealHeading';

/**
 * アウトラインの1つの見出し。
 * @typedef {{index: number, level: number, text: string, id: string, parent: OutlineNode|null, children: OutlineNode[]}} OutlineNode
 */

/** 「mdevc アウトライン」の中身（VS Code の TreeDataProvider）。 */
class OutlineView {
  /**
   * @param {vscode.ExtensionContext} a_context 拡張機能の情報
   */
  constructor(a_context) {
    /** 今表示している編集画面（MarkdownEditor。無ければ null）。 */
    this.editor = null;
    /** 見出し（文書の順）と、最上位の見出し。 */
    this.nodes = [];
    this.roots = [];
    /** 検索で見つかった箇所を含む見出しの番号と、今の箇所の見出しの番号（無ければ -1）。 */
    this.hits = new Set();
    this.current = -1;
    this.changed = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.changed.event;
    this.treeView = vscode.window.createTreeView(VIEW_ID, { treeDataProvider: this, showCollapseAll: true });
    a_context.subscriptions.push(
      this.treeView,
      this.changed,
      vscode.commands.registerCommand(REVEAL_COMMAND, (a_index) => {
        if (this.editor) this.editor.post({ cmd: 'revealHeading', index: a_index });
      }),
    );
  }

  /**
   * 表示する編集画面を変える（編集画面がアクティブになった時。閉じた時は null）。
   * @param {object|null} a_editor 編集画面（MarkdownEditor）
   */
  setEditor(a_editor) {
    if (this.editor === a_editor) return;
    this.editor = a_editor;
    this.refresh();
  }

  /**
   * 編集画面から見出しが届いた時（その編集画面を表示している時だけ、表示を変える）。
   * @param {object} a_editor 編集画面（MarkdownEditor）
   */
  onOutlineChanged(a_editor) {
    if (this.editor === a_editor) this.refresh();
  }

  /** 今の編集画面の見出しと検索の印で、表示を作り直す。 */
  refresh() {
    const outline = this.editor ? this.editor.outline : { items: [], hits: [], current: -1 };
    // 見出しのレベルから、木の形にする（同じ文字の見出しは、何番目かで区別して、折りたたんだ状態が保たれるようにする）
    this.nodes = [];
    this.roots = [];
    const stack = [];
    const counts = new Map();
    outline.items.forEach((item, index) => {
      const base = `${item.level}\t${item.text}`;
      const n = (counts.get(base) || 0) + 1;
      counts.set(base, n);
      while (stack.length && stack[stack.length - 1].level >= item.level) stack.pop();
      const parent = stack.length ? stack[stack.length - 1] : null;
      const node = { index, level: item.level, text: item.text, id: `${base}\t${n}`, parent, children: [] };
      (parent ? parent.children : this.roots).push(node);
      this.nodes.push(node);
      stack.push(node);
    });
    this.hits = new Set(outline.hits);
    this.current = outline.current;
    this.treeView.message = this.editor && !this.nodes.length ? '見出しがありません。' : undefined;
    this.changed.fire();
    this.revealCurrent();
  }

  /** 今の箇所の見出しを、選択した状態にして見える位置に出す（ビューを表示している時だけ。入力先は移さない）。 */
  revealCurrent() {
    const node = this.nodes[this.current];
    if (!node || !this.treeView.visible) return;
    // 表示を作り直した直後は、まだ VS Code が新しい見出しを受け取っていないことがあるので、少し後に行う
    setTimeout(() => {
      if (this.nodes[this.current] === node) this.treeView.reveal(node, { select: true, focus: false, expand: true }).then(undefined, () => {});
    }, 50);
  }

  // ===== TreeDataProvider =====

  /**
   * @param {OutlineNode} [a_node] 見出し（省略時は最上位）
   * @returns {OutlineNode[]}
   */
  getChildren(a_node) {
    return a_node ? a_node.children : this.roots;
  }

  /**
   * @param {OutlineNode} a_node 見出し
   * @returns {OutlineNode|null}
   */
  getParent(a_node) {
    return a_node.parent;
  }

  /**
   * @param {OutlineNode} a_node 見出し
   * @returns {vscode.TreeItem}
   */
  getTreeItem(a_node) {
    const hit = this.hits.has(a_node.index);
    // 検索で見つかった見出しは、文字全体を強調する（VS Code の一覧の、一致した文字と同じ色）
    const label = hit ? { label: a_node.text, highlights: [[0, a_node.text.length]] } : a_node.text;
    const item = new vscode.TreeItem(label,
      a_node.children.length ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
    item.id = a_node.id;
    item.tooltip = a_node.text;
    item.command = { command: REVEAL_COMMAND, title: '見出しへ移動', arguments: [a_node.index] };
    return item;
  }
}

module.exports = { OutlineView };
