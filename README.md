# mdevc

mdevc is a Visual Studio Code extension that lets you edit Markdown files directly, in a view that looks just like the
preview (WYSIWYG). There is no separate editing pane and preview pane, so you can keep writing while you see exactly
how the formatting looks.

The editor is available in English and Japanese (see the Language setting below).

日本語の説明は [README.ja.md](README.ja.md) を参照してください。

## Installation

Search for "mdevc" in the Extensions view of VS Code (Ctrl+Shift+X) and install it.

To install from a `.vsix` file:

1. Get the `mdevc-<version>.vsix` file.
2. In the Extensions view of VS Code (Ctrl+Shift+X), open the "…" menu at the top right, choose
   "Install from VSIX...", and select the `.vsix` file.
   You can also install it from a command prompt with `code --install-extension mdevc-<version>.vsix`.

Requires VS Code 1.90 or later.

## Usage

- `.md` and `.markdown` files open in the mdevc editor.
- For how to write formatting, work with tables, and so on, see the help (read-only), which opens from the editor's
  right-click menu → Open Help, or from "mdevc: Open Help" in the Command Palette.
  The help is shown in the language of the editor (see the Language setting below).
- To edit a file as plain text, click the "Reopen with Text Editor" button at the top right of the editor
  (or run "mdevc: Reopen with Text Editor" from the Command Palette).
  To go back to mdevc from the text editor, click the "Reopen with mdevc" button at the top right.
- Save (Ctrl+S), undo (Ctrl+Z), the unsaved-changes marker, confirmation when closing, and reloading when another app
  changes the file are all handled by VS Code, just as for normal text files.
- Find in Files (Ctrl+Shift+F) and Replace in Files (Ctrl+Shift+H) also work as usual. Replacements are shown
  immediately in any open mdevc editor.
- The "mdevc Outline" view in the Explorer (side bar) lists the headings of the current mdevc editor (click one to move
  to it; headings that contain search matches are emphasized). It is a separate view because the standard VS Code
  "Outline" cannot show the headings of a custom editor such as mdevc.

### Settings

Open File > Preferences > Settings (Ctrl+,) and search for "mdevc" to change the following settings. Changes are
applied immediately to all open editors.

| Setting | Values |
|---|---|
| Language | Auto (default; follows the VS Code display language: Japanese if it is Japanese, otherwise English) / 日本語 (Japanese) / English |
| Doc Style | GitHub style (default) / VS Code style |
| Text Color | Sharp (default) / Easy on the eyes |
| Doc Width | Readable width (max 884px, default) / Fit to the editor width |
| Soft Break | Do not break until a blank line (default) / Break lines as in the source |

The Language setting applies to the editor screen, the messages of the extension, and the help. The names of commands
and settings shown by VS Code itself (such as in the Command Palette and the Settings editor) follow the VS Code display
language.

The light or dark appearance follows the VS Code color theme automatically.

### Find and replace

Ctrl+F (find) and Ctrl+H (replace) show a find and replace bar at the top right of the editor (it works like find in
the VS Code text editor).

| Operation | Keys |
|---|---|
| Find next / find previous | Enter / Shift+Enter (F3 / Shift+F3) |
| Replace and find next | Enter in the replace box |
| Replace all | Ctrl+Alt+Enter |
| Match case / whole word / regular expression | Alt+C / Alt+W / Alt+R |
| Close | Esc |

### Keyboard

Keys used for editing (typing, Ctrl+B bold, Ctrl+I italic, Ctrl+U underline, undo / redo, copy / paste, zoom with
Ctrl++ / Ctrl+- / Ctrl+0, Alt+Shift+5 strikethrough, etc.) are handled by the editor.
Other keys (Ctrl+S, Ctrl+P, Ctrl+Tab, Ctrl+W, F5, Ctrl+Shift+P, etc.) work as VS Code shortcuts.

### Pasting images

When you paste an image from the clipboard, it is saved right away in a "`<file name>.images`" folder next to the file
you are editing, with a name such as `clipboard_image_1.png`, and a relative path to it is written into the document.
You cannot paste images into a new file that has never been saved.

### Known limitations

- When you open a file from the Find in Files results, the editor does not move to the match (it shows the start of
  the file). To see the match, find it with the find and replace bar (Ctrl+F).
- Images written with an absolute path such as `C:\dir\a.png` are not shown (images with a relative path are shown).
- With "Copy for Excel", images in a table may not paste into Excel (because of how a VS Code extension can write to
  the clipboard).

## Development

### Folder structure

| Path | Contents |
|---|---|
| `extension.js` | Entry point of the extension (registers the custom editor and commands) |
| `src/markdownEditor.js` | Syncing between the editor screen (webview) and the VS Code document, pasting images, opening links, etc. |
| `src/images.js` | Saving pasted images, resolving image and link targets |
| `src/outlineView.js` | "mdevc Outline" in the Explorer (the standard VS Code Outline cannot be used from a custom editor) |
| `src/i18n.js` | English text of the messages shown by the extension (the Japanese text is the key) |
| `src/log.js` | Log (the "mdevc" channel in the Output panel) |
| `package.nls.json` / `package.nls.ja.json` | Display strings in `package.json` (settings, commands, etc.) in English / Japanese |
| `README.md` / `README.ja.md` | This file (English) / Japanese version |
| `CHANGELOG.md` | Change log (shown on the "Changelog" tab of the extension's details page) |
| `doc/` | Development notes (not included in the VSIX) |
| `help/HELP.en.md` / `help/HELP.md` | Help in English / Japanese (opened read-only from the right-click menu → Open Help. The one for the language of the editor is opened) |
| `web/` | Editor screen (HTML, JavaScript, CSS). `js/host.js` (communication with VS Code, key routing, colors), `js/findbar.js` (find and replace bar), `js/i18n.js` (English text of the editor screen; the Japanese text is the key) |

There is no build step (the extension runs as plain JavaScript).

### Trying it out

1. Open this folder in VS Code.
2. Press F5 to start a VS Code instance with mdevc loaded (Extension Development Host), and open a `.md` file.
3. The log is shown in the Output panel (Ctrl+Shift+U) by choosing "mdevc". For the editor screen itself, press F12 in
   the editor to open the developer tools.

### Building the VSIX

On a PC with Node.js installed, run the following command in this folder (the first time, you are asked to confirm
downloading vsce).

```
npm run package
```

(If running scripts is disabled in PowerShell, use `npm.cmd run package`. It runs `vsce package` from `scripts` in
`package.json`.)

This creates `mdevc-<version>.vsix`. Change the version with `version` in `package.json`, and record the changes in
`CHANGELOG.md` (shown on the "Changelog" tab of the extension's details page). The files to include in the VSIX are
listed in `.vscodeignore`, so notes in the `doc` folder and similar files are not included.

## License

MIT License (LICENSE.txt)
