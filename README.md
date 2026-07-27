<div align="center">

<img src="./logo.svg" alt="73" width="112" />

# 73

**markdown viewer** — a clean, distraction-free reader, with quick edits when you need them.

English · [简体中文](./README.zh-CN.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](./LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-v2-FF5A36.svg)](https://tauri.app)

</div>

---

**73** is a desktop app for **reading** Markdown. Double-click a `.md` file and you're straight into the text — no file tree, no crowded panels, no clutter. Just your document, quietly typeset. Spot a typo? Hit `⌘E` to fix it in place.

## Features

- 📖 **Open and read** — set it as the default app for `.md`; double-click goes straight to the content. One file, one window.
- 🗂️ **Outline sidebar** — a collapsible heading tree; click to jump, and it highlights the section you're reading. Off by default, one tap to open.
- ✏️ **Live typeset editing** — press `⌘E` for a Typora-like single-canvas editor: headings, emphasis, links, quotes, and code render as you type, while Markdown markers reveal themselves on the active line. Press `⌘S` to save in place.
- 🖍️ **Highlighter** — select text in the reader to highlight it in one of four colors; it's written back as `==` / `<mark>` and saved to the file.
- 🧮 **Math** — inline and block formulas via KaTeX, including formulas written across several lines.
- ✨ **Syntax highlighting** — highlight.js, with a one-click copy button on every code block.
- 🖼️ **Images & zoom** — local images load inline; click to zoom.
- 📊 **Tables** — CJK text doesn't break mid-word; toggle between fit-to-width and horizontal scroll.
- 🌗 **Themes** — dark mode (follows the system, or manual), four accent colors, and a sans ⇄ serif reading font.
- 🧼 **Tidy rendering** — YAML frontmatter folds into a compact card; presentational `<font>` tags from rich-text exports (e.g. Yuque) are stripped for clean reading.
- 🌐 **Bilingual (中 / EN)** — the UI follows your system language and switches from the native menu (**View → Language**).
- 🪟 **Out of the way** — custom centered title bar, a word count in the status bar, and closing the window tucks the app into the background (reopen from the Dock) instead of quitting.

## Install

### macOS

Download `73Su_x.x.x_universal.dmg` from [Releases](../../releases) (works on both Intel and Apple Silicon) and drag it into Applications.

> The app isn't notarized by Apple. On first launch, **right-click → Open** to get past Gatekeeper.

### Windows / Linux

Download the matching installer from [Releases](../../releases). File association and opening from the command line are both supported.

## Build from source

Requires [Node.js](https://nodejs.org) and [Rust](https://www.rust-lang.org/tools/install).

```bash
npm install

# Develop (hot reload)
npm run tauri dev

# Build an installer for the current platform
npm run tauri build

# macOS universal binary (Intel + Apple Silicon)
npm run tauri build -- --target universal-apple-darwin
```

## Tech stack

Tauri v2 (Rust backend) + vanilla TypeScript + Vite. Editor: CodeMirror 6. Markdown pipeline: marked + marked-highlight + highlight.js + KaTeX (custom multi-line extension) + DOMPurify + github-markdown-css.

## License

Released under the [MIT](./LICENSE) license. The bundled "Ma Shan Zheng" font is under SIL OFL 1.1; see [THIRD-PARTY.md](./THIRD-PARTY.md) for the full list of third-party assets and dependencies.
