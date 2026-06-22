<div align="center">

<img src="./logo.svg" alt="73·素" width="120" />

# 73·素

**素净的 Markdown 阅读器** · 需要时也能就地改一笔

[English](./README.md) · 简体中文

[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](./LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-v2-FF5A36.svg)](https://tauri.app)

</div>

---

「73·素」是一个**专心看 Markdown 的桌面应用**。双击 `.md` 文件直接进入阅读，没有目录树、没有侧栏、没有多余按钮——把文档安安静静地排好版给你看。看到错字想改？按 `⌘E` 就地修一笔。

## 特性

- 📖 **打开即读** — 关联为 `.md` 默认应用，双击直达正文；一文件一窗口
- ✏️ **轻量编辑** — `⌘E` 进入编辑原始 Markdown，`⌘S` 就地保存。阅读为主，编辑模式不打扰；有未保存修改也不会被悄悄丢掉
- 🧮 **数学公式** — KaTeX 渲染行内 / 块级公式
- 🎨 **代码高亮** — highlight.js，带一键复制按钮
- 🖼️ **图片与缩放** — 本地图片内联加载，点击放大预览
- 📊 **表格** — 中文不折行，可切换自适应宽度
- 🌗 **深色模式** — 跟随系统，可手动切换
- 🌐 **中英双语** — 界面跟随系统语言，可在标题栏一键切换（含原生菜单）
- 🏷️ **元信息卡片** — YAML frontmatter 折叠成紧凑卡片，不与正文混杂
- ✒️ **克制排版** — 14px 墨色正文、马善政毛笔字标，安静耐读
- 🪟 **自定义标题栏** — 居中标题，可拖拽

## 安装

### macOS

从 [Releases](../../releases) 下载 `73·素_x.x.x_universal.dmg`（同时支持 Intel 与 Apple Silicon），拖入「应用程序」。

> 应用未经 Apple 签名，首次打开请**右键 →「打开」**绕过 Gatekeeper。

### Windows / Linux

从 [Releases](../../releases) 下载对应安装包。文件关联与命令行打开均已支持。

## 从源码构建

需要 [Node.js](https://nodejs.org) 与 [Rust](https://www.rust-lang.org/tools/install)。

```bash
npm install

# 开发（热重载）
npm run tauri dev

# 构建当前平台安装包
npm run tauri build

# macOS 通用二进制（Intel + Apple Silicon）
npm run tauri build -- --target universal-apple-darwin
```

## 技术栈

Tauri v2（Rust 后端）+ Vanilla TypeScript + Vite。Markdown 管线：marked + marked-highlight + marked-katex-extension + highlight.js + KaTeX + DOMPurify + github-markdown-css。

## 许可

代码以 [MIT](./LICENSE) 发布。内置字体「马善政」遵循 SIL OFL 1.1，第三方资源与依赖清单见 [THIRD-PARTY.md](./THIRD-PARTY.md)。
