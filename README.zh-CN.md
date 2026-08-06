<div align="center">

<img src="./logo.svg" alt="Sū" width="112" />

# 📖 Sū

**macOS 上的原生 Markdown 阅读器** · 双击即读，`⌘E` 就地改，支持 Mermaid 与 ASCII 图

[English](./README.md) · 简体中文

[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](./LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-v2-FF5A36.svg)](https://tauri.app)

</div>

---

「Sū（素）」是一个**专心看 Markdown 的桌面应用**。双击 `.md` 文件直接进入阅读，没有文件树、没有满屏面板、没有多余按钮——把文档安安静静地排好版给你看。看到错字想改？按 `⌘E` 就地修一笔。

<p align="center">
  <img src="https://cdn.jsdelivr.net/gh/youhaqiu/su-md-viewer@master/docs/screenshot-read.zh.png" alt="用 Sū 阅读 Markdown" width="820" />
</p>

## 特性

- 📖 **打开即读** — 关联为 `.md` 默认应用，双击直达正文；一文件一窗口
- 📄 **纯文本也读得好** — `.txt` 走同一条渲染管线，`#` 标题、`-` 列表照样排版；同时保住纯文本自己的排版：ASCII 图与空格对齐的表格原样等宽显示（前者还会被认成图表卡片），只缩进的段落也留着缩进
- 🗂️ **大纲侧栏** — 可折叠的标题树，点击跳转、随滚动高亮当前章节；默认收起，一键展开
- ✏️ **实时排版编辑** — `⌘E` 进入类 Typora 的单画布编辑，标题、强调、链接、引用与代码即时呈现；光标所在行自动显示 Markdown 标记，`⌘S` 就地保存
- 🖍️ **荧光笔** — 在阅读区选中文字即可高亮，四种颜色；以 `==` / `<mark>` 写回并保存到文件
- 🧮 **数学公式** — KaTeX 渲染行内 / 块级公式，支持跨行书写的公式
- ✨ **代码高亮** — highlight.js，带一键复制按钮
- 🔀 **流程图统一适配** — Mermaid、flowchart.js 的 `flow` 语法、以及用 `+ - |` 或制表符手画的 ASCII 图，统统渲染成同一种卡片，并统一画成**手绘草图风**（抖动线条、斜线涂鸦、手写体标签）。工具条上还能换风格：规整、霓虹发光、渐变玻璃、赛博电路，共五种；再加一个「彩色」开关，五种风格都能开，每个节点按顺序取一个色相（从当前主题色起步）。节点可以拖着改布局，连线自动重走；另有缩放平移、看源码、导出 SVG / PNG，配色跟着主题走。没标语言的代码块会自动识别，老文档一个字都不用改
- 🖼️ **图片与缩放** — 本地图片内联加载，点击放大预览
- 📊 **表格** — 中文不折行，可在自适应宽度与横向滚动间切换
- 🌗 **外观** — 标题栏一枚「外观」浮层收齐三档：深浅（跟随系统 / 浅色 / 深色）、四套主题色、黑体 ⇄ 宋体阅读字体
- 📍 **不丢阅读位置** — 切深浅色 / 主题色 / 字体 / 语言、收展目录都留在原处，不会弹回文档顶部；`⌘E` 进出编辑模式也落在同一段文字上
- 🧼 **干净渲染** — YAML frontmatter 折叠成紧凑卡片；自动剥除富文本导出（如语雀）残留的 `<font>` 样式标签
- 🌐 **中英双语** — 界面跟随系统语言，可在原生菜单**「视图 → 语言」**切换
- 🪟 **不打扰** — 自定义居中标题栏、状态栏字数统计；关窗口就是真关掉（有未保存修改会先问一句），关掉最后一个窗口即退出应用

## 几眼看清它长什么样

**`⌘E` 就地改**：光标所在行显示 Markdown 标记，其余部分保持排版。

<p align="center">
  <img src="https://cdn.jsdelivr.net/gh/youhaqiu/su-md-viewer@master/docs/screenshot-edit.png" alt="实时排版编辑" width="820" />
</p>

**深色模式**下的表格、公式与手绘 ASCII 图，同在一页。

<p align="center">
  <img src="https://cdn.jsdelivr.net/gh/youhaqiu/su-md-viewer@master/docs/screenshot-dark.png" alt="深色模式下的公式与 ASCII 图" width="820" />
</p>

**五种图表风格**，卡片工具条上一键切换——同一份 Mermaid / `flow` / ASCII 源码，五种画法。

<p align="center">
  <img src="https://cdn.jsdelivr.net/gh/youhaqiu/su-md-viewer@master/docs/diagram-styles.zh.png" alt="手绘、规整、霓虹、渐变玻璃与赛博电路五种图表风格" width="900" />
</p>

## 安装

### macOS

从 [Releases](../../releases) 下载 `Su_x.x.x_universal.dmg`（同时支持 Intel 与 Apple Silicon），拖入「应用程序」。

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

Tauri v2（Rust 后端）+ Vanilla TypeScript + Vite。编辑器：CodeMirror 6。Markdown 管线：marked + marked-highlight + highlight.js + KaTeX（自建多行扩展）+ DOMPurify + github-markdown-css。图表：自建管线（解析器 → 图模型 → 分层排版 → Canvas / SVG 渲染）负责 ASCII 手绘图、`flow` 语法，以及 mermaid 的流程图与状态图；mermaid 其余图种（时序、甘特、类图…）回落到懒加载的官方库。手绘笔触统一由 Rough.js 生成。

## 许可

代码以 [MIT](./LICENSE) 发布。第三方资源与依赖清单见 [THIRD-PARTY.md](./THIRD-PARTY.md)。
