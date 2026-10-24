// mdevc（mdew の VS Code 版）：検索と置換のバー（Ctrl+F・Ctrl+H）。
//
// mdew・mdevs では、検索と置換のウィンドウはホスト側（WPF のウィンドウ・Visual Studio の検索）だったが、VS Code の
// webview の中ではホスト側のウィンドウを出せないため、VS Code のテキストエディタと同じ形のバーを画面の右上に出す。
// 検索・置換の処理は mdevs と同じもの（main.js の window.__mdevs.find・replace 等。find.js の FindEngine）を使う。
//  - Enter：次を検索、Shift+Enter：前を検索、F3・Shift+F3 も同じ、Esc：閉じる
//  - 置換の入力欄で Enter：置換して次へ、Ctrl+Alt+Enter：すべて置換
//  - Alt+C：大文字と小文字を区別する、Alt+W：単語単位、Alt+R：正規表現

/**
 * id で要素を取得する。
 * @param {string} a_id 要素の id
 * @returns {HTMLElement}
 */
const $ = (a_id) => document.getElementById(a_id);

/** バーの HTML。 */
const BAR_HTML = `
  <button id="fb-toggle" class="fb-icon" title="置換モードの切り替え" aria-label="置換モードの切り替え"></button>
  <div class="fb-rows">
    <div class="fb-row">
      <div class="fb-field">
        <input id="fb-find" type="text" placeholder="検索" spellcheck="false" aria-label="検索">
        <button class="fb-opt" data-opt="matchCase" title="大文字と小文字を区別する (Alt+C)">Aa</button>
        <button class="fb-opt fb-word" data-opt="wholeWord" title="単語単位で検索する (Alt+W)">ab</button>
        <button class="fb-opt" data-opt="regex" title="正規表現を使用する (Alt+R)">.*</button>
      </div>
      <span id="fb-status" aria-live="polite"></span>
      <button class="fb-icon" data-act="prev" title="前の一致項目 (Shift+Enter)" aria-label="前の一致項目">&#x2191;</button>
      <button class="fb-icon" data-act="next" title="次の一致項目 (Enter)" aria-label="次の一致項目">&#x2193;</button>
      <button class="fb-icon" data-act="close" title="閉じる (Escape)" aria-label="閉じる">&#x2715;</button>
    </div>
    <div class="fb-row fb-replace-row">
      <div class="fb-field">
        <input id="fb-replace" type="text" placeholder="置換" spellcheck="false" aria-label="置換">
      </div>
      <button class="fb-text" data-act="replace" title="置換 (Enter)">置換</button>
      <button class="fb-text" data-act="replaceAll" title="すべて置換 (Ctrl+Alt+Enter)">すべて置換</button>
    </div>
  </div>`;

/** 検索と置換のバー。 */
export class FindBar {
  /**
   * @param {object} a_api 検索・置換の処理（main.js の window.__mdevs と同じもの）
   * @param {(opts: object) => string} a_api.find 次（前）を検索（'found'・'notfound'・'error'）
   * @param {(opts: object) => string} a_api.findIncremental 今の箇所の先頭から検索（検索する文字列を変えた時）
   * @param {(opts: object) => number} a_api.replace 置換・すべて置換（置換した件数。誤りは -1）
   * @param {() => {total: number, index: number}} a_api.findStatus 見つかった件数と、今の箇所の番号（0 から。無ければ -1）
   * @param {() => string} a_api.selectedText 範囲選択している文字列（1行のものだけ）
   * @param {() => void} a_api.close 検索の色を消し、編集画面に入力を戻す
   * @param {() => boolean} a_api.readOnly 読み取り専用か（ヘルプ。置換の入力欄は出さない）
   */
  constructor(a_api) {
    this.api = a_api;
    /** 検索の条件（大文字と小文字・単語単位・正規表現）。 */
    this.opts = { matchCase: false, wholeWord: false, regex: false };
    /** 処理の結果の文（正規表現の誤り・置換した件数等。次の操作まで、件数の代わりに表示する）。 */
    this.message = '';
    this.statusTimer = 0;
    const bar = document.createElement('div');
    bar.id = 'findbar';
    bar.setAttribute('role', 'dialog');
    bar.setAttribute('aria-label', '検索と置換');
    bar.innerHTML = BAR_HTML;
    document.body.append(bar);
    this.bar = bar;
    this.findInput = $('fb-find');
    this.replaceInput = $('fb-replace');

    bar.addEventListener('click', (e) => {
      const button = e.target.closest('button');
      if (!button) return;
      if ('fb-toggle' === button.id) this.setReplaceMode(!this.replaceMode);
      else if (button.dataset.opt) this.toggleOption(button.dataset.opt);
      else this.run(button.dataset.act);
    });
    // ボタンを押しても、入力欄から入力先が移らないようにする
    bar.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) e.preventDefault();
    });
    this.findInput.addEventListener('input', () => this.search());
    bar.addEventListener('keydown', (e) => this.onKeyDown(e));
    // 文書を編集した時は、件数を数え直す
    document.addEventListener('input', (e) => {
      if (this.isOpen && !bar.contains(e.target)) this.scheduleStatus();
    }, true);
  }

  /** バーを表示しているか。 */
  get isOpen() {
    return this.bar.classList.contains('open');
  }

  /** 置換の入力欄を表示しているか。 */
  get replaceMode() {
    return this.bar.classList.contains('replace');
  }

  /**
   * 置換の入力欄の表示・非表示を切り替える。
   * @param {boolean} a_on 表示するか
   */
  setReplaceMode(a_on) {
    if (this.api.readOnly()) a_on = false; // 読み取り専用（ヘルプ）は置換しない
    this.bar.classList.toggle('replace', a_on);
    $('fb-toggle').title = a_on ? '置換モードを閉じる' : '置換モードの切り替え';
  }

  /**
   * バーを開く（開いていれば、入力欄に入力を移す）。範囲選択している文字列があれば、検索する文字列にする。
   * @param {boolean} a_replace 置換の入力欄も表示するか（Ctrl+H）
   */
  open(a_replace) {
    const selected = this.api.selectedText();
    const wasOpen = this.isOpen;
    this.bar.classList.add('open');
    if (a_replace) this.setReplaceMode(true);
    else if (!wasOpen) this.setReplaceMode(false);
    const input = a_replace && wasOpen && this.findInput.value && !selected ? this.replaceInput : this.findInput;
    if (selected) this.findInput.value = selected;
    input.focus();
    input.select();
    if (selected || !wasOpen) this.search();
  }

  /** バーを閉じる（検索の色を消し、編集画面に入力を戻す）。 */
  close() {
    if (!this.isOpen) return;
    this.bar.classList.remove('open');
    clearTimeout(this.statusTimer);
    this.api.close();
  }

  /**
   * 検索の条件を切り替える（大文字と小文字・単語単位・正規表現）。
   * @param {string} a_name 条件の名前
   */
  toggleOption(a_name) {
    this.opts[a_name] = !this.opts[a_name];
    this.bar.querySelector(`[data-opt="${a_name}"]`).classList.toggle('on', this.opts[a_name]);
    this.search();
  }

  /** 今の検索の条件（window.__mdevs.find 等に渡す形）。 */
  get query() {
    return {
      query: this.findInput.value,
      replacement: this.replaceInput.value,
      matchCase: this.opts.matchCase,
      wholeWord: this.opts.wholeWord,
      regex: this.opts.regex,
    };
  }

  /** 検索する文字列・条件を変えた時：今の箇所の先頭から探し直す（VS Code と同じく、入力するたびに探す）。 */
  search() {
    this.message = '';
    if (!this.findInput.value) {
      this.api.close(); // 色を消す（入力欄からは入力を移さない）
      this.findInput.focus();
      this.updateStatus();
      return;
    }
    this.api.findIncremental(this.query);
    this.updateStatus();
  }

  /**
   * ボタン・キーの操作を実行する。
   * @param {string} a_action prev・next・replace・replaceAll・close
   */
  run(a_action) {
    if ('close' === a_action) {
      this.close();
      return;
    }
    if (!this.findInput.value) {
      this.findInput.focus();
      return;
    }
    this.message = '';
    const q = this.query;
    if ('prev' === a_action || 'next' === a_action) {
      this.api.find({ ...q, backward: 'prev' === a_action });
    } else if ('replace' === a_action) {
      // 今の箇所（選択している箇所）を置換して、次の箇所へ（今の箇所が無ければ、次の箇所を選ぶだけ）
      if (this.api.replace({ ...q, all: false }) >= 0) this.api.find({ ...q, backward: false });
    } else if ('replaceAll' === a_action) {
      const count = this.api.replace({ ...q, all: true });
      if (count > 0) this.message = `${count} 件を置換しました`;
    }
    this.updateStatus();
  }

  /**
   * 検索・置換の処理（find.js の FindEngine）からの表示の更新（main.js の postToWindow）。正規表現の誤り等の文を表示する。
   * @param {{status?: string}} a_update 表示の更新
   */
  onEngineUpdate(a_update) {
    if (!this.isOpen || 'string' !== typeof a_update.status) return;
    // 置換した件数の文は run で短く出すので、誤りの文だけを出す
    if (/正規表現/.test(a_update.status)) {
      this.message = '正規表現が正しくありません';
      this.updateStatus();
    }
  }

  /** 少し待ってから、件数を数え直す（文書を編集した時）。 */
  scheduleStatus() {
    clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => this.updateStatus(), 350);
  }

  /** 件数（「今の箇所 / 全体」）か、処理の結果の文を表示する。 */
  updateStatus() {
    const status = $('fb-status');
    let text = '';
    let none = false;
    if (this.message) {
      text = this.message;
      none = /正しくありません/.test(text);
    } else if (this.findInput.value) {
      const { total, index } = this.api.findStatus();
      none = 0 === total;
      text = none ? '結果なし' : `${index >= 0 ? index + 1 : '?'} / ${total}`;
    }
    status.textContent = text;
    this.bar.classList.toggle('no-results', none);
  }

  /**
   * バーの中でのキー操作。
   * @param {KeyboardEvent} e キーのイベント
   */
  onKeyDown(e) {
    const inReplace = e.target === this.replaceInput;
    if ('Escape' === e.key) {
      e.preventDefault();
      this.close();
    } else if ('Enter' === e.key && e.ctrlKey && e.altKey) {
      e.preventDefault();
      this.run('replaceAll');
    } else if ('Enter' === e.key && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      this.run(inReplace ? 'replace' : (e.shiftKey ? 'prev' : 'next'));
    } else if ('F3' === e.key) {
      e.preventDefault();
      this.run(e.shiftKey ? 'prev' : 'next');
    } else if (e.altKey && !e.ctrlKey && ['KeyC', 'KeyW', 'KeyR'].includes(e.code)) {
      e.preventDefault();
      this.toggleOption({ KeyC: 'matchCase', KeyW: 'wholeWord', KeyR: 'regex' }[e.code]);
    } else {
      return;
    }
    e.stopPropagation(); // VS Code（Alt のメニュー・F3 等）にも、編集画面にも渡さない
  }

  /**
   * バーの外（編集画面）でのキー：バーを開いていれば、F3・Shift+F3 で次（前）を検索し、Esc で閉じる（右クリックのメニューを
   * 開いている時の Esc は、メニューを閉じる）。
   * @param {KeyboardEvent} e キーのイベント
   * @returns {boolean} 処理したか
   */
  handleGlobalKey(e) {
    if (!this.isOpen || e.ctrlKey || e.altKey || e.defaultPrevented) return false;
    if ('F3' === e.key && this.findInput.value) {
      e.preventDefault();
      this.run(e.shiftKey ? 'prev' : 'next');
      return true;
    }
    if ('Escape' === e.key && !e.shiftKey && !document.querySelector('.md-menu')) {
      e.preventDefault();
      this.close();
      return true;
    }
    return false;
  }
}
