<div align="center">

<img src="./logo.svg" alt="73·素" width="120" />

# 73·素

**A clean, distraction-free Markdown reader** — with quick inline edits when you need them.

English · [简体中文](./README.zh-CN.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](./LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-v2-FF5A36.svg)](https://tauri.app)

</div>

---

**73·素** (*sù* — "plain, unadorned") is a desktop app for **reading** Markdown. Double-click a `.md` file and you're straight into the text — no file tree, no panels, no clutter. Just your document, quietly typeset. And when you spot a typo, hit `⌘E` to fix it in place.

## Features

- 📖 **Open and read** — set it as the default app for `.md`; double-click goes straight to the content. One file, one window.
- ✏️ **Quick edit** — press `⌘E` to edit the raw Markdown, `⌘S` to save in place. Reader-first: editing stays out of the way until you ask for it, and unsaved changes are never lost silently.
- 🧮 **Math** — inline and block formulas via KaTeX.
- 🎨 **Syntax highlighting** — highlight.js, with a one-click copy button on every code block.
- 🖼️ **Images & zoom** — local images load inline; click to zoom.
- 📊 **Tables** — CJK text doesn't break mid-word; toggle between fit-to-width and scroll.
- 🌗 **Dark mode** — follows the system, or toggle manually.
- 🌐 **Bilingual (中 / EN)** — the UI follows your system language and switches with one click in the title bar — native menu included.
- 🏷️ **Frontmatter card** — YAML frontmatter folds into a compact card instead of cluttering the body.
- ✒️ **Restrained typography** — 14px ink-toned body text and a brush-stroke wordmark; calm and easy on the eyes.
- 🪟 **Custom title bar** — centered title, draggable.

## Install

### macOS

Download `73·素_x.x.x_universal.dmg` from [Releases](../../releases) (works on both Intel and Apple Silicon) and drag it into Applications.

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

Tauri v2 (Rust backend) + vanilla TypeScript + Vite. Markdown pipeline: marked + marked-highlight + marked-katex-extension + highlight.js + KaTeX + DOMPurify + github-markdown-css.

## License

Released under the [MIT](./LICENSE) license. The bundled "Ma Shan Zheng" font is under SIL OFL 1.1; see [THIRD-PARTY.md](./THIRD-PARTY.md) for the full list of third-party assets and dependencies.
