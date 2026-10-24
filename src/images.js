// images.js
//
// mdevc（mdew の VS Code 版）の一部。
// 貼り付けた画像の保存と、画像の参照先からファイルの場所を求める処理。
//
// mdew・mdevs は、貼り付けた画像を一時フォルダに置いて、保存する時に「<ファイル名>.images」へ移していた。VS Code では、
// 文書の内容を VS Code が持ち、保存も VS Code が行うため、貼り付けた時にすぐ「<ファイル名>.images」へ保存して、文書には
// そのフォルダへの相対パスを書く（VS Code の Markdown の画像の貼り付けと同じ考え方）。

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

/** 貼り付けた画像のファイル名の先頭（clipboard_image_1.png 等。mdew と同じ）。 */
const PASTED_IMAGE_BASE_NAME = 'clipboard_image';

/** 画像の種類（MIME）→ 拡張子。 */
const EXT_OF_MIME = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/bmp': '.bmp', 'image/webp': '.webp',
};

/** 画像として扱うファイルの拡張子。 */
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico']);

/**
 * ファイル・フォルダがあるか。
 * @param {vscode.Uri} a_uri 場所
 * @returns {Promise<boolean>}
 */
async function exists(a_uri) {
  try {
    await vscode.workspace.fs.stat(a_uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * 文書の画像を置くフォルダ（文書の隣の「<ファイル名>.images」。mdew と同じ）。
 * @param {vscode.Uri} a_docUri 文書の場所
 * @returns {{dir: vscode.Uri, name: string}} フォルダの場所と名前
 */
function imageFolderOf(a_docUri) {
  const base = path.posix.basename(a_docUri.path);
  const name = `${base.replace(/\.[^.]*$/, '')}.images`;
  return { dir: vscode.Uri.joinPath(a_docUri, '..', name), name };
}

/**
 * フォルダの中で、ほかのファイルと重ならない「clipboard_image_連番.拡張子」の名前を作る（連番は 1 から）。
 * @param {vscode.Uri} a_dir フォルダ
 * @param {string} a_ext 拡張子（. 付き）
 * @returns {Promise<string>}
 */
async function sequentialName(a_dir, a_ext) {
  for (let i = 1; ; i++) {
    const name = `${PASTED_IMAGE_BASE_NAME}_${i}${a_ext}`;
    if (!(await exists(vscode.Uri.joinPath(a_dir, name)))) return name;
  }
}

/**
 * 画像を文書の「<ファイル名>.images」フォルダに保存して、文書から見た相対パスを返す。
 * @param {vscode.Uri} a_docUri 文書の場所
 * @param {Uint8Array} a_bytes 画像のデータ
 * @param {string} a_ext 拡張子（. 付き）
 * @returns {Promise<string>} 文書から見た相対パス（「README.images/clipboard_image_1.png」の形）
 */
async function saveImage(a_docUri, a_bytes, a_ext) {
  const { dir, name: folderName } = imageFolderOf(a_docUri);
  await vscode.workspace.fs.createDirectory(dir);
  const fileName = await sequentialName(dir, a_ext);
  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, fileName), a_bytes);
  return `${folderName}/${fileName}`;
}

/**
 * 貼り付けた画像（クリップボードの画像。Base64）を保存する。
 * @param {vscode.Uri} a_docUri 文書の場所
 * @param {string} a_mimeType 画像の種類（image/png 等）
 * @param {string} a_base64 画像のデータ（Base64）
 * @returns {Promise<string>} 文書から見た相対パス
 */
function savePastedImage(a_docUri, a_mimeType, a_base64) {
  return saveImage(a_docUri, Buffer.from(a_base64, 'base64'), EXT_OF_MIME[a_mimeType] || '.png');
}

/**
 * 他のアプリが置いた画像のファイル（Excel の一時ファイル等。file:///…）を、文書の画像のフォルダへコピーする。
 * @param {vscode.Uri} a_docUri 文書の場所
 * @param {string} a_src 画像の参照先（file:///…）
 * @returns {Promise<string|null>} 文書から見た相対パス（コピーできなければ null）
 */
async function importImage(a_docUri, a_src) {
  let file;
  try {
    file = vscode.Uri.parse(a_src, true);
  } catch {
    return null;
  }
  if ('file' !== file.scheme || !IMAGE_EXTS.has(path.extname(file.fsPath).toLowerCase())) return null;
  // 一時ファイルはこの PC にあるので、PC のファイルとして読む（文書がリモートにある時も）
  const bytes = await fs.promises.readFile(file.fsPath);
  return saveImage(a_docUri, bytes, path.extname(file.fsPath).toLowerCase());
}

/**
 * 文書に書かれた参照先（相対パス・絶対パス・file:///…）を、ファイルの場所にする。
 * @param {vscode.Uri} a_docUri 文書の場所
 * @param {string} a_ref 参照先（# より後ろ・? より後ろは除く）
 * @param {boolean} [a_decode] 相対パスの %20 等を元に戻すか（画像の参照先。リンクは画面側で戻してあるので false）
 * @returns {vscode.Uri|null} 解決できなければ null（http・data: 等）
 */
function resolveReference(a_docUri, a_ref, a_decode = true) {
  const ref = (a_ref || '').trim().split(/[?#]/)[0];
  if (!ref || ref.startsWith('//')) return null;
  if (/^file:/i.test(ref)) {
    try {
      return vscode.Uri.parse(ref, true);
    } catch {
      return null;
    }
  }
  if (/^[a-zA-Z]:[\\/]/.test(ref) || /^\\\\/.test(ref)) return vscode.Uri.file(ref);
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(ref)) return null; // http・data: 等
  let decoded = ref;
  try {
    if (a_decode) decoded = decodeURIComponent(ref);
  } catch {
    // 正しくエンコードされていなければ、そのまま
  }
  return vscode.Uri.joinPath(a_docUri, '..', ...decoded.replace(/\\/g, '/').split('/').filter((s) => s.length));
}

module.exports = { savePastedImage, importImage, resolveReference, exists };
