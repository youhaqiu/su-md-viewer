import { invoke } from "@tauri-apps/api/core";
import { open, ask, message } from "@tauri-apps/plugin-dialog";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Marked, type TokenizerAndRendererExtension } from "marked";
import { markedHighlight } from "marked-highlight";
import katex from "katex";
import hljs from "highlight.js";
import DOMPurify from "dompurify";
import {
  t as i18n,
  getLocale,
  setLocale,
  refreshLocale,
  LANG_STORAGE_KEY,
} from "./i18n";
import { createMdEditor, type EditorViewState, type MdEditor } from "./editor";
import { preserveTextLayout } from "./plaintext";
import { enhanceDiagrams, refreshDiagrams } from "./diagram";
import {
  STYLE_KEY as DIAGRAM_STYLE_KEY,
  TOOLS_EVENT as DIAGRAM_TOOLS_EVENT,
  TOOLS_KEY as DIAGRAM_TOOLS_KEY,
} from "./diagram/theme";

// 不引 highlight.js 自带主题：它是 GitHub 的高饱和配色，跟这里安静的正文调子不搭，
// 而且只有浅色一套，深色得再补一遍。token 配色统一写在 styles.css 里，走 CSS 变量。
import "github-markdown-css/github-markdown.css";
import "katex/dist/katex.min.css";

// 配置 marked：开启 GFM，并对代码块做语法高亮
const marked = new Marked(
  markedHighlight({
    emptyLangClass: "hljs",
    langPrefix: "hljs language-",
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : "plaintext";
      return hljs.highlight(code, { language }).value;
    },
  }),
);
// breaks:true → 源文件里的单个回车也会换行（贴近 Typora / Obsidian 的观感）
marked.setOptions({ gfm: true, breaks: true });

// ===== 数学公式（KaTeX）：$...$ 行内、$$...$$ 块级 =====
// 自建扩展而非直接用 marked-katex-extension：官方规则不允许 $...$ 内出现换行，
// 于是作者把长公式断成多行书写时（$ … =↵\frac{…} $）就整段渲染失败。这里放宽为
// 允许公式跨单个换行，但遇到空行（段落分隔）即停止，避免落单的 $ 吞掉整段文字。
// 结尾需为非 $ / 非换行的实字符，配合非贪婪匹配就近闭合。
const KATEX_INLINE_RE =
  /^(\${1,2})(?!\$)((?:\\.|\n(?!\n)|[^\\\n])*?(?:\\.|[^\\\n$]))\1/;
// 块级：$$ 独占起止行，中间任意内容（含空行）。
const KATEX_BLOCK_RE = /^(\${1,2})\n((?:\\[^]|[^\\])+?)\n\1(?:\n|$)/;

function renderKatex(text: string, displayMode: boolean): string {
  return katex.renderToString(text, { throwOnError: false, displayMode });
}

const katexInline: TokenizerAndRendererExtension = {
  name: "katexInline",
  level: "inline",
  start(src) {
    const i = src.indexOf("$");
    return i < 0 ? undefined : i;
  },
  tokenizer(src) {
    const m = KATEX_INLINE_RE.exec(src);
    if (!m) return undefined;
    return {
      type: "katexInline",
      raw: m[0],
      text: m[2].trim(),
      displayMode: m[1].length === 2,
    };
  },
  renderer(token) {
    return renderKatex(token.text ?? "", Boolean((token as { displayMode?: boolean }).displayMode));
  },
};

const katexBlock: TokenizerAndRendererExtension = {
  name: "katexBlock",
  level: "block",
  start(src) {
    const i = src.indexOf("$$");
    return i < 0 ? undefined : i;
  },
  tokenizer(src) {
    const m = KATEX_BLOCK_RE.exec(src);
    if (!m) return undefined;
    return {
      type: "katexBlock",
      raw: m[0],
      text: m[2].trim(),
      displayMode: m[1].length === 2,
    };
  },
  renderer(token) {
    return renderKatex(token.text ?? "", Boolean((token as { displayMode?: boolean }).displayMode)) + "\n";
  },
};

marked.use({ extensions: [katexBlock, katexInline] });

// 荧光笔：把 ==高亮文字== 渲染成 <mark>（黄色），与 Obsidian / Typora 同款语法
const highlightExtension: TokenizerAndRendererExtension = {
  name: "highlight",
  level: "inline",
  start(src) {
    return src.indexOf("==");
  },
  tokenizer(src) {
    const m = /^==(?=\S)([\s\S]*?\S)==/.exec(src);
    if (m) {
      return {
        type: "highlight",
        raw: m[0],
        text: m[1],
        tokens: this.lexer.inlineTokens(m[1]),
      };
    }
    return undefined;
  },
  renderer(token) {
    return `<mark class="hl">${this.parser.parseInline(token.tokens ?? [])}</mark>`;
  },
};
marked.use({ extensions: [highlightExtension] });

// ===== 界面元素引用 =====
// 放在最前面：下面各处 applyXxx() 在模块初始化阶段就会跑一遍，那时若引用还没初始化会踩 TDZ。
const titleEl = document.querySelector<HTMLSpanElement>("#title")!;
const emptyEl = document.querySelector<HTMLDivElement>("#empty")!;
const previewEl = document.querySelector<HTMLElement>("#preview")!;
const overlayEl = document.querySelector<HTMLDivElement>("#drop-overlay")!;
const dropHintEl = document.querySelector<HTMLSpanElement>("#drop-hint")!;
const tocToggleBtn = document.querySelector<HTMLButtonElement>("#toc-toggle")!;
const tocEl = document.querySelector<HTMLElement>("#toc")!;
const tocListEl = document.querySelector<HTMLElement>("#toc-list")!;
const tocTitleEl = document.querySelector<HTMLSpanElement>("#toc-title")!;
const appearanceBtn = document.querySelector<HTMLButtonElement>("#appearance-toggle")!;
const appearanceMenu = document.querySelector<HTMLDivElement>("#appearance-menu")!;

// ===== 阅读位置：切主题 / 字体 / 配色 / 语言时留在原处，别弹回文档顶部 =====
// 不能只记 scrollTop：这些操作会重画图表、换字体、重排正文，高度一变像素值就对不上，
// 何况重渲染时图片和图表卡片是异步撑开的，当场恢复也只会被后到的高度顶跑。
// 于是锚定「视口顶部那一块正文元素 + 它相对视口顶的偏移」，并在随后的高度变化里持续校正。
type ReadAnchor = { index: number; offset: number; top: number };

function captureAnchor(): ReadAnchor {
  const top = previewEl.scrollTop;
  const base = previewEl.getBoundingClientRect().top;
  const kids = Array.from(previewEl.children) as HTMLElement[];
  for (let i = 0; i < kids.length; i++) {
    const r = kids[i].getBoundingClientRect();
    if (r.bottom - base > 1) return { index: i, offset: r.top - base, top }; // 第一个还没滚出去的块
  }
  return { index: -1, offset: 0, top };
}

// 把锚点元素挪回原来的位置，返回落定后的 scrollTop（用于分辨后续滚动是不是用户自己动的）
function applyAnchor(a: ReadAnchor): number {
  const kid = previewEl.children[a.index] as HTMLElement | undefined;
  if (kid) {
    const base = previewEl.getBoundingClientRect().top;
    previewEl.scrollTop += kid.getBoundingClientRect().top - base - a.offset;
  } else {
    previewEl.scrollTop = a.top; // 正文整个换了（无锚点可循）：退回原像素位置
  }
  return previewEl.scrollTop;
}

let stopKeeping: (() => void) | null = null;

// 在接下来的一小段时间里盯着正文高度变化持续校正锚点；用户一动手就立刻收手，别跟人抢滚动条
function keepAnchor(a: ReadAnchor, ms = 2000) {
  stopKeeping?.();
  if (previewEl.hidden) return; // 编辑模式下预览不可见，量不出位置也没必要动
  let expected = applyAnchor(a);
  const ro = new ResizeObserver(() => {
    expected = applyAnchor(a);
  });
  for (const kid of Array.from(previewEl.children)) ro.observe(kid);
  const onScroll = () => {
    if (Math.abs(previewEl.scrollTop - expected) > 2) stop(); // 位置对不上 → 是用户滚的
  };
  const stop = () => {
    ro.disconnect();
    clearTimeout(timer);
    previewEl.removeEventListener("scroll", onScroll);
    previewEl.removeEventListener("wheel", stop);
    previewEl.removeEventListener("pointerdown", stop);
    if (stopKeeping === stop) stopKeeping = null;
  };
  const timer = window.setTimeout(stop, ms);
  previewEl.addEventListener("scroll", onScroll);
  previewEl.addEventListener("wheel", stop, { passive: true });
  previewEl.addEventListener("pointerdown", stop);
  stopKeeping = stop;
}

// 执行一个会改变正文排版的动作，做完把阅读位置放回原处
function keepReadingPos(fn: () => void | Promise<void>): void {
  const a = captureAnchor();
  const done = fn();
  if (done instanceof Promise) void done.then(() => keepAnchor(a));
  else keepAnchor(a);
}

// ===== 深色模式：默认跟随系统，可手动切换，选择持久化、多窗口同步 =====
const THEME_KEY = "theme"; // "light" | "dark" | 未设置(跟随系统)
// 标题栏图标统一规格：24 网格、16px 显示、线宽 1.7、圆头圆角，画面控制在 3～21 之间。
// 之前每枚是各写各的（15/16px、1.5/1.7/1.8 线宽），排在一起就一枚粗一枚细、一枚大一枚小。
const ICON_ATTRS = `viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"`;

const darkMql = window.matchMedia("(prefers-color-scheme: dark)");

// 编辑器实例（CodeMirror）。在 DOM 引用就绪后创建；这里先声明，供 applyTheme 同步深色。
let mdEditor: MdEditor | null = null;

function effectiveTheme(): "light" | "dark" {
  const s = localStorage.getItem(THEME_KEY);
  if (s === "light" || s === "dark") return s;
  return darkMql.matches ? "dark" : "light";
}

// 深浅三档：跟随系统 / 浅色 / 深色（跟随系统 = 不写这条设置）
type ThemeChoice = "system" | "light" | "dark";

function themeChoice(): ThemeChoice {
  const s = localStorage.getItem(THEME_KEY);
  return s === "light" || s === "dark" ? s : "system";
}

function setThemeChoice(c: ThemeChoice) {
  if (c === "system") localStorage.removeItem(THEME_KEY);
  else localStorage.setItem(THEME_KEY, c);
  applyTheme();
}

function applyTheme() {
  const t = effectiveTheme();
  const root = document.documentElement;
  root.setAttribute("data-theme", t);
  root.setAttribute("data-color-mode", t); // 供 github-markdown.css 切换
  root.setAttribute("data-light-theme", "light");
  root.setAttribute("data-dark-theme", "dark");
  mdEditor?.setDark(t === "dark"); // 同步编辑器配色
  syncAppearance();
  // 图表按新配色重画：mermaid 那类要整张重出，重画期间卡片高度会塌一下，得守住阅读位置
  keepReadingPos(() => refreshDiagrams());
}

darkMql.addEventListener("change", () => {
  if (!localStorage.getItem(THEME_KEY)) applyTheme(); // 仅在跟随系统时响应
});
window.addEventListener("storage", (e) => {
  if (e.key === THEME_KEY) applyTheme(); // 其他窗口切换时同步
});
applyTheme();

// ===== 阅读字体：黑体 ⇄ 宋体，持久化、多窗口同步 =====
const FONT_KEY = "font"; // "sans" | "serif"
type FontId = "sans" | "serif";
const SANS_GLYPH_FONT = '"PingFang SC", -apple-system, "Microsoft YaHei", sans-serif';
const SERIF_GLYPH_FONT = 'Georgia, "Songti SC", "STSong", "SimSun", serif';

function effectiveFont(): FontId {
  return localStorage.getItem(FONT_KEY) === "serif" ? "serif" : "sans";
}

function setFont(f: FontId) {
  localStorage.setItem(FONT_KEY, f);
  applyFont();
}

function applyFont() {
  const f = effectiveFont();
  // 换字体会改变行高与折行，正文整体高度随之变化 → 同样守住阅读位置
  keepReadingPos(() => document.documentElement.setAttribute("data-font", f));
  syncAppearance();
}

window.addEventListener("storage", (e) => {
  if (e.key === FONT_KEY) applyFont(); // 其他窗口切换时同步
});
applyFont();

// ===== 主题色：4 套配色预设，持久化、多窗口同步 =====
const ACCENT_KEY = "accent"; // localStorage：未设置时用默认珊瑚橙
const ACCENTS = [
  { id: "coral", swatch: "#ff5a36" },
  { id: "indigo", swatch: "#2f6feb" },
  { id: "teal", swatch: "#1f8a70" },
  { id: "violet", swatch: "#6b4eea" },
] as const;
type AccentId = (typeof ACCENTS)[number]["id"];
const DEFAULT_ACCENT: AccentId = "coral";
// 调色板：原来是三个 r=5 的大圆叠在一起，16px 下糊成一坨黑团。换成画家调色板——
// 和图表卡片工具条里的「配色」是同一枚，两处说的也是同一件事。
function effectiveAccent(): AccentId {
  const s = localStorage.getItem(ACCENT_KEY);
  return ACCENTS.some((a) => a.id === s) ? (s as AccentId) : DEFAULT_ACCENT;
}

function setAccent(a: AccentId) {
  localStorage.setItem(ACCENT_KEY, a);
  applyAccent();
}

function applyAccent() {
  document.documentElement.setAttribute("data-accent", effectiveAccent());
  syncAppearance();
  keepReadingPos(() => refreshDiagrams()); // 图表按新主题色重画，阅读位置不动
}

// ===== 外观浮层：深浅 / 主题色 / 正文字体 =====
// 这三样原先各占标题栏一枚按钮。它们改的是同一件事——这篇文档看起来什么样——
// 而且都是「设一次就不太动」的偏好，各摆一枚按钮既占地方又让标题栏显得杂。
// 合成一枚「外观」按钮，点开是一张小面板，三档各一行。
const APPEARANCE_ICON = `<svg ${ICON_ATTRS}><path d="M12 3.6a8.4 8.4 0 1 0 0 16.8c1.15 0 1.75-.78 1.75-1.55 0-1.45-1.15-1.55-1.15-2.6 0-.78.66-1.35 1.5-1.35h1.55A4.7 4.7 0 0 0 20.4 10c0-3.6-3.75-6.4-8.4-6.4z"/><circle cx="7.9" cy="11.2" r="1.15" fill="currentColor" stroke="none"/><circle cx="10.5" cy="7.7" r="1.15" fill="currentColor" stroke="none"/><circle cx="14.9" cy="8.2" r="1.15" fill="currentColor" stroke="none"/></svg>`;
// 浮层的两个 DOM 引用在文件开头一并取了：applyTheme() 在模块初始化阶段就会调 syncAppearance()，
// 引用放在这里会踩 TDZ（整个模块直接崩掉，标题栏一枚按钮都出不来）。

// 一组分段单选（深浅、字体都用它）
function segmented<T extends string>(
  options: { id: T; label: string; font?: string }[],
  current: () => T,
  onPick: (id: T) => void,
): HTMLDivElement {
  const seg = document.createElement("div");
  seg.className = "ap-seg";
  seg.setAttribute("role", "radiogroup");
  for (const o of options) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ap-seg-item";
    b.dataset.value = o.id;
    b.setAttribute("role", "radio");
    b.textContent = o.label;
    if (o.font) b.style.fontFamily = o.font; // 字体那档用本尊显示，所见即所得
    b.addEventListener("click", () => onPick(o.id));
    seg.appendChild(b);
  }
  seg.dataset.current = current();
  return seg;
}

function group(label: string, control: HTMLElement): HTMLDivElement {
  const g = document.createElement("div");
  g.className = "ap-group";
  const l = document.createElement("div");
  l.className = "ap-label";
  l.textContent = label;
  g.append(l, control);
  return g;
}

// 按当前语言重建浮层（切语言时调用一次即可刷新全部文案）
function buildAppearanceMenu() {
  appearanceBtn.innerHTML = APPEARANCE_ICON;
  appearanceBtn.title = i18n("appearance.title");
  appearanceMenu.innerHTML = "";

  appearanceMenu.appendChild(
    group(
      i18n("appearance.mode"),
      segmented<ThemeChoice>(
        [
          { id: "system", label: i18n("appearance.system") },
          { id: "light", label: i18n("appearance.light") },
          { id: "dark", label: i18n("appearance.dark") },
        ],
        themeChoice,
        setThemeChoice,
      ),
    ),
  );

  const swatches = document.createElement("div");
  swatches.className = "ap-swatches";
  swatches.setAttribute("role", "radiogroup");
  for (const { id, swatch } of ACCENTS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ap-swatch";
    b.dataset.value = id;
    b.setAttribute("role", "radio");
    b.title = i18n("accent." + id);
    b.style.setProperty("--swatch", swatch);
    b.addEventListener("click", () => setAccent(id));
    swatches.appendChild(b);
  }
  appearanceMenu.appendChild(group(i18n("appearance.accent"), swatches));

  appearanceMenu.appendChild(
    group(
      i18n("appearance.font"),
      segmented<FontId>(
        [
          { id: "sans", label: i18n("font.sans"), font: SANS_GLYPH_FONT },
          { id: "serif", label: i18n("font.serif"), font: SERIF_GLYPH_FONT },
        ],
        effectiveFont,
        setFont,
      ),
    ),
  );

  syncAppearance();
}

// 把三档的当前值刷到浮层上（浮层还没建好时静默跳过——applyTheme 在建之前就会跑一次）
function syncAppearance() {
  if (!appearanceMenu.childElementCount) return;
  const mark = (root: Element, current: string) => {
    root.querySelectorAll<HTMLElement>("[role='radio']").forEach((el) => {
      el.setAttribute("aria-checked", el.dataset.value === current ? "true" : "false");
    });
  };
  const [modeGroup, accentGroup, fontGroup] = Array.from(appearanceMenu.children);
  mark(modeGroup, themeChoice());
  mark(accentGroup, effectiveAccent());
  mark(fontGroup, effectiveFont());
}

function closeAppearance() {
  appearanceMenu.hidden = true;
}

appearanceBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  appearanceMenu.hidden = !appearanceMenu.hidden;
});
// 点空白处 / 按 Esc 关闭浮层（面板里点选不关，方便连着调几档）
document.addEventListener("click", (e) => {
  if (
    !appearanceMenu.hidden &&
    !appearanceMenu.contains(e.target as Node) &&
    !appearanceBtn.contains(e.target as Node)
  ) {
    closeAppearance();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeAppearance();
});
window.addEventListener("storage", (e) => {
  if (e.key === ACCENT_KEY) applyAccent(); // 其他窗口切换时同步
  if (e.key === DIAGRAM_STYLE_KEY) keepReadingPos(() => refreshDiagrams(true)); // 图表绘制风格同步
  if (e.key === DIAGRAM_TOOLS_KEY) window.dispatchEvent(new Event(DIAGRAM_TOOLS_EVENT)); // 工具条收展同步
});

buildAppearanceMenu();

// 记住当前已打开的文档，切换语言时重渲染以刷新动态文案（复制/折行按钮等）
let currentDoc: { markdown: string; path: string } | null = null;

// ===== 编辑模式：阅读 ⇄ 单画布实时排版编辑，手动保存（⌘S）=====
const editToggleBtn = document.querySelector<HTMLButtonElement>("#edit-toggle")!;
const saveBtn = document.querySelector<HTMLButtonElement>("#save-btn")!;
const imageBtn = document.querySelector<HTMLButtonElement>("#image-btn")!;
const editorEl = document.querySelector<HTMLDivElement>("#editor")!;
const editStatusEl = document.querySelector<HTMLElement>("#edit-status")!;
const liveLabelEl = document.querySelector<HTMLSpanElement>("#live-label")!;
const docStatsEl = document.querySelector<HTMLSpanElement>("#doc-stats")!;

// 创建 CodeMirror 编辑器。回调里引用的函数在后文声明（函数声明已提升）。
mdEditor = createMdEditor({
  parent: editorEl,
  dark: effectiveTheme() === "dark",
  placeholder: i18n("edit.placeholder"),
  onChange: (value) => {
    if (currentDoc && isEditMode) currentDoc.markdown = value;
    updateEditUI();
  },
  onImagePaste: (files) => insertImages(files.map((file) => ({ file }))),
});

let isEditMode = false;
let savedMarkdown = ""; // 最近一次落盘的内容，用于判断「是否有未保存修改」
let docName = ""; // 当前文件名（标题栏脏标记会在前面加 •）

// ===== 目录（大纲）：左侧栏列出各级标题，点击跳转、随滚动高亮当前章节 =====
const TOC_KEY = "toc"; // localStorage："0"=收起，其余=展开（默认展开）
// 目录开关：原来是「列表」图标，但它开的其实是左边那条侧栏，而不是「一份清单」。
// 换成侧栏图标——一个方框加一道竖线，左边那一栏就是要拉出来的东西，开关和结果对得上。
const TOC_ICON = `<svg ${ICON_ATTRS}><rect x="3.4" y="4.6" width="17.2" height="14.8" rx="2.6"/><line x1="9.7" y1="4.6" x2="9.7" y2="19.4"/></svg>`;
const CARET_ICON = `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>`;
let tocOpen = localStorage.getItem(TOC_KEY) === "1"; // 默认收起，用户开过才记住展开
let hasToc = false; // 当前文档是否有标题（无标题则不显示目录按钮）
type TocEntry = { el: HTMLElement; link: HTMLButtonElement };
let tocEntries: TocEntry[] = [];

// 铅笔：原来是「一道斜杠 + 一条底线」，16px 下只看得出斜杠。换成带笔头的铅笔本身。
const PENCIL_ICON = `<svg ${ICON_ATTRS}><path d="M4.4 19.6l4.1-1.1L19 8a2 2 0 0 0-2.8-2.8L5.6 15.6l-1.2 4z"/><path d="M14.6 7.4l2.8 2.8"/></svg>`;
const EYE_ICON = `<svg ${ICON_ATTRS}><path d="M2.6 12S6 5.9 12 5.9 21.4 12 21.4 12 18 18.1 12 18.1 2.6 12 2.6 12z"/><circle cx="12" cy="12" r="2.9"/></svg>`;
const SAVE_ICON = `<svg ${ICON_ATTRS}><path d="M18.6 20.5H5.4a1.9 1.9 0 0 1-1.9-1.9V5.4a1.9 1.9 0 0 1 1.9-1.9h9.7l5.4 5.4v9.7a1.9 1.9 0 0 1-1.9 1.9z"/><path d="M16.4 20.5v-6.9H7.6v6.9M7.6 3.5v4.3h6.1"/></svg>`;
const SAVED_ICON = `<svg ${ICON_ATTRS}><path d="M5.4 12.4l4.2 4.2 9-9"/></svg>`;
// 图片：相框 + 山与太阳，编辑器里「插入图片」按钮用
const IMAGE_ICON = `<svg ${ICON_ATTRS}><rect x="3.2" y="4.8" width="17.6" height="14.4" rx="2.4"/><circle cx="9" cy="10" r="1.6"/><path d="M4.6 17.2l4.2-4.2a1.6 1.6 0 0 1 2.3 0l3.4 3.4M13.2 15.6l1.9-1.9a1.6 1.6 0 0 1 2.3 0l2.9 2.9"/></svg>`;

// 当前生效的文本：编辑时以编辑器为准，预览时以已渲染文档为准
function currentText(): string {
  return isEditMode ? mdEditor?.getValue() ?? "" : currentDoc?.markdown ?? "";
}

function isDirty(): boolean {
  return currentDoc !== null && currentText() !== savedMarkdown;
}

// 按当前模式（有无文档 / 预览 or 编辑）切换各区域与按钮的显隐
function applyMode() {
  const hasDoc = currentDoc !== null;
  emptyEl.hidden = hasDoc;
  previewEl.hidden = !hasDoc || isEditMode;
  editorEl.hidden = !hasDoc || !isEditMode;
  editStatusEl.hidden = !hasDoc; // 底部状态栏（字数）阅读/编辑模式都显示
  editToggleBtn.hidden = !hasDoc;
  saveBtn.hidden = !hasDoc || (!isEditMode && !isDirty());
  imageBtn.hidden = !hasDoc || !isEditMode;
  // 目录：仅在阅读模式、有文档且文档含标题时可用；是否展开由 tocOpen 决定
  const tocShow = hasDoc && !isEditMode && hasToc && tocOpen;
  tocToggleBtn.hidden = !hasDoc || isEditMode || !hasToc;
  tocToggleBtn.setAttribute("aria-pressed", String(tocShow));
  tocEl.hidden = !tocShow;
  document.body.dataset.mode = isEditMode ? "edit" : "preview";
}

// 刷新编辑相关按钮的图标 / 文案 / 状态
function updateEditUI() {
  editToggleBtn.innerHTML = isEditMode ? EYE_ICON : PENCIL_ICON;
  editToggleBtn.title = isEditMode ? i18n("edit.toPreview") : i18n("edit.toEdit");
  editToggleBtn.setAttribute("aria-pressed", String(isEditMode));
  imageBtn.innerHTML = IMAGE_ICON;
  imageBtn.title = i18n("edit.insertImage");
  if (!saveBtn.classList.contains("saved")) saveBtn.innerHTML = SAVE_ICON;
  const dirty = isDirty();
  saveBtn.title = i18n("edit.save");
  saveBtn.disabled = !dirty;
  saveBtn.classList.toggle("dirty", dirty);
  updateDocStats();
  applyMode();
  updateTitle();
}

function updateDocStats() {
  // 编辑时按源码计数；阅读时按渲染后的可见正文计数（不含 Markdown 语法 / 已剥离的 <font>）
  const text = isEditMode ? currentText() : previewEl.textContent ?? "";
  const characters = Array.from(text.replace(/\s/g, "")).length;
  const words = text.trim()
    ? (text.match(/[\p{Script=Han}]|[\p{L}\p{N}_'-]+/gu) ?? []).length
    : 0;
  docStatsEl.textContent = i18n("edit.stats", {
    words: String(words),
    chars: String(characters),
  });
}

// 标题栏：未保存时在文件名前加 • 提示
function updateTitle() {
  if (!currentDoc) return;
  const dot = isDirty() ? "• " : "";
  titleEl.textContent = dot + docName;
  getCurrentWindow().setTitle(`${dot}${docName} — Sū`);
}

// 离开编辑时记下改到哪儿（含光标列位置），原地折返时用它精确还原
let editView: (EditorViewState & { line: number }) | null = null;

// 进入编辑：把 Markdown 灌进实时排版画布
function enterEdit() {
  if (!currentDoc) return;
  const line = sourceLineOf(captureAnchor()); // 得趁预览还看得见时量
  isEditMode = true;
  mdEditor!.setValue(currentDoc.markdown);
  applyMode();
  updateEditUI();
  mdEditor!.refresh(); // 容器刚显示，需重新测量布局
  // 阅读位置没挪动过（⌘E 出去看一眼又回来）就连光标一起还原，别把光标打回段首；
  // 挪过了就以阅读位置为准，落到刚才读到的那一段
  if (editView && Math.abs(editView.line - line) <= 2) mdEditor!.setViewState(editView);
  else mdEditor!.revealLine(line + 1);
  mdEditor!.focus();
}

// 完成编辑：用画布中的内容生成完整阅读预览（未保存内容仍只在内存）
async function exitToPreview() {
  if (!currentDoc) return;
  const line = mdEditor!.currentLine() - 1; // 编辑时正看着哪一行
  editView = { ...mdEditor!.getViewState(), line }; // 记下改到哪儿，原地折返时用
  isEditMode = false;
  await render(mdEditor!.getValue(), currentDoc.path);
  updateEditUI();
  scrollPreviewToLine(line); // 回到刚才改到的那一段
}

function toggleEdit() {
  if (!currentDoc) return;
  if (isEditMode) exitToPreview();
  else enterEdit();
}

// 保存：把当前内容写回原文件
async function save() {
  if (!currentDoc || !isDirty()) return;
  const content = currentText();
  try {
    await invoke("write_file", { path: currentDoc.path, content });
    savedMarkdown = content;
    currentDoc.markdown = content;
    updateEditUI();
    flashSaved();
  } catch (err) {
    await message(i18n("edit.saveError", { err: String(err) }), {
      title: i18n("edit.saveErrorTitle"),
      kind: "error",
    });
  }
}

// 保存成功后短暂闪一个对勾
function flashSaved() {
  saveBtn.innerHTML = SAVED_ICON;
  saveBtn.classList.add("saved");
  setTimeout(() => {
    saveBtn.innerHTML = SAVE_ICON;
    saveBtn.classList.remove("saved");
  }, 1200);
}

// ===== 插入图片：存到文档同目录的 assets/（默认图片目录），光标处插入相对路径 =====
// 两个入口共用这一套：编辑器里粘贴剪贴板图片（onImagePaste），或标题栏按钮挑本地文件。
type ImageInput = { file: File } | { path: string };

function fileToBase64(file: File): Promise<string> {
  return file.arrayBuffer().then((buf) => {
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  });
}

async function insertImages(inputs: ImageInput[]) {
  if (!currentDoc || !isEditMode) return;
  for (const input of inputs) {
    try {
      let data: string;
      let nameHint: string | null = null;
      if ("file" in input) {
        data = await fileToBase64(input.file);
        // 剪贴板给的文件名（image.png）没有保留价值，交给后端按时间戳起名
        nameHint = input.file.name && input.file.name !== "image.png" ? input.file.name : null;
      } else {
        // 磁盘上的文件：读出内容（复用 read_image_data_url，剥掉 data URL 前缀即 base64）
        const dataUrl = await invoke<string>("read_image_data_url", { path: input.path });
        data = dataUrl.slice(dataUrl.indexOf(",") + 1);
        nameHint = input.path.split("/").pop() ?? null;
      }
      const rel = await invoke<string>("save_image", {
        docPath: currentDoc.path,
        nameHint,
        data,
      });
      mdEditor!.insertAtCursor(`![](${rel})`);
    } catch (err) {
      showToast(i18n("img.insertFailed", { err: String(err) }));
    }
  }
}

// 「插入图片」按钮：系统文件选择器挑本地图片，多选
imageBtn.addEventListener("click", async () => {
  if (!currentDoc || !isEditMode) return;
  const picked = await open({
    multiple: true,
    filters: [
      {
        name: i18n("file.imageDialogName"),
        extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"],
      },
    ],
  });
  if (!picked) return;
  const paths = Array.isArray(picked) ? picked : [picked];
  insertImages(paths.map((path) => ({ path })));
});

// 有未保存修改时弹窗确认是否放弃（切换文件 / 关窗口前调用）
async function confirmDiscardIfDirty(): Promise<boolean> {
  if (!isDirty()) return true;
  return await ask(i18n("edit.discardConfirm"), {
    title: i18n("edit.discardTitle"),
    kind: "warning",
    okLabel: i18n("edit.discardOk"),
    cancelLabel: i18n("edit.discardCancel"),
  });
}

editToggleBtn.addEventListener("click", toggleEdit);
saveBtn.addEventListener("click", save);

// 快捷键：⌘E 切换阅读 / 编辑，⌘S 保存
document.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;
  if (e.key === "s") {
    e.preventDefault();
    save();
  } else if (e.key.toLowerCase() === "e") {
    e.preventDefault();
    toggleEdit();
  }
});

// 点红灯关闭按钮：真正关掉这个窗口（早先是隐藏到后台，于是开了几个文档窗口再关，
// 它们其实都还在，只是看不见）。有未保存修改时先问一句，确认放弃才放行。
// 关掉全部窗口后应用仍留在 Dock（macOS 惯例），点图标会开一个新的空窗口。
getCurrentWindow().onCloseRequested(async (event) => {
  if (!(await confirmDiscardIfDirty())) {
    event.preventDefault();
  }
});

// ===== 国际化：把静态界面文案按当前语言刷新；语言按钮显示当前语言、点击切换 =====
function applyI18n() {
  const loc = getLocale();
  document.documentElement.setAttribute("lang", loc === "zh" ? "zh" : "en");
  dropHintEl.textContent = i18n("drop.hint");
  tocToggleBtn.title = i18n("toc.toggle");
  tocTitleEl.textContent = i18n("toc.title");
  liveLabelEl.textContent = i18n("edit.live");
  mdEditor?.setPlaceholder(i18n("edit.placeholder"));
  applyTheme(); // 同步深色按钮的多语言 tooltip
  applyFont(); // 刷新字体按钮 tooltip
  buildAppearanceMenu(); // 按新语言重建外观浮层（tooltip、分档文案、色名）
  updateEditUI(); // 刷新编辑 / 保存按钮的多语言 tooltip
  // 切语言会重渲染已打开文档以刷新动态文案，保留原阅读位置（否则会跳回顶部）
  if (currentDoc && !isEditMode) {
    keepReadingPos(() => render(currentDoc!.markdown, currentDoc!.path));
  }
}

async function syncMenuLocale() {
  try {
    await invoke("set_locale_menu", { lang: getLocale() });
  } catch {
    /* 菜单同步失败不影响使用 */
  }
}

// 语言改由原生「视图 → 语言」菜单切换：菜单项触发时广播到所有窗口，各窗口在此响应
listen<string>("menu-set-lang", (e) => {
  const lang = e.payload === "zh" ? "zh" : "en";
  if (getLocale() === lang) return;
  setLocale(lang);
  applyI18n();
  syncMenuLocale();
});
window.addEventListener("storage", (e) => {
  if (e.key === LANG_STORAGE_KEY) {
    refreshLocale();
    applyI18n();
    syncMenuLocale();
  }
});

// HTML 转义
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}

// 语雀（Yuque）等富文本编辑器导出的 Markdown 常把文字包进
// <font style="color:…;background-color:…">…</font> 做样式，甚至把行内代码写成
// `<font …>nums</font>` —— 于是代码里显示成一坨原始标签。这些 <font> 纯是表现层噪音，
// 渲染前统一脱掉（只去标签、留文字）。仅作用于「显示」，不改动原文件；围栏代码块内不动，
// 以免破坏正文里正经讲 HTML 的示例。
function stripFontTags(md: string): string {
  // 按 ``` 围栏代码块切分：奇数段是代码块，原样保留；其余段落里剥掉 <font>/</font>
  return md
    .split(/(^```[\s\S]*?^```[^\n]*$)/m)
    .map((seg, i) => (i % 2 === 1 ? seg : seg.replace(/<\/?font\b[^>]*>/gi, "")))
    .join("");
}

// 抽出文件开头的 YAML frontmatter（--- ... ---），返回元信息、正文，以及正文从第几行开始
function extractFrontmatter(md: string): { fm: string | null; body: string; skipLines: number } {
  const m = md.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/);
  if (!m) return { fm: null, body: md, skipLines: 0 };
  return { fm: m[1], body: md.slice(m[0].length), skipLines: countLines(m[0]) };
}

function countLines(s: string): number {
  return (s.match(/\n/g) ?? []).length;
}

// 把 frontmatter 渲染成紧凑的元信息卡片
function renderMeta(fm: string): string {
  const rows = fm
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((line) => {
      const i = line.indexOf(":");
      const k = i === -1 ? "" : line.slice(0, i).trim();
      const v = i === -1 ? line.trim() : line.slice(i + 1).trim();
      return `<div class="meta-row"><span class="meta-key">${esc(k)}</span><span class="meta-val">${esc(v)}</span></div>`;
    })
    .join("");
  return `<div class="frontmatter">${rows}</div>`;
}

// ===== 正文 ⇄ 源码行：进出编辑模式时落在同一段文字上 =====
// 两层映射，能用精确的就用精确的：
//
// 一、逐块对应。marked 的顶层 token 与预览里的顶层块一一对应，把各 token 的 raw 依次累加
//     成行号，就得到「预览第 i 块 = 源码第几行」。数量对不上就整张作废——错位的映射会把人
//     送到别的段落去，比没有更糟。（正文里夹了 <div> 包住若干块这类写法就会对不上：那些块
//     成了 div 的子节点，不再是顶层。）
// 二、按标题插值。「预览里的第 k 个标题 = 源码里的第 k 个标题」不受 HTML 嵌套影响，标题之间
//     按位置比例折算。落点最差也在同一节里，够用。文档没有标题时退化为整篇按比例折算。
//
// stripFontTags 只删标签不动换行，两层用的行号都与原文对得上。
let blockLines: number[] = []; // 与 previewEl.children 一一对应，值为 0 基行号；空表示不可用
let headingAnchors: { el: HTMLElement; line: number }[] = []; // 预览标题 ⇄ 源码行

// 渲染不出元素的 token，得跳过，否则后面全错位一格
function tokenRendersNothing(tk: { type: string; raw?: string }): boolean {
  if (tk.type === "space" || tk.type === "def") return true; // 空行、链接引用定义
  return tk.type === "html" && /^\s*<!--[\s\S]*-->\s*$/.test(tk.raw ?? ""); // 纯 HTML 注释
}

function buildSourceMap(body: string, skipLines: number, hasMeta: boolean) {
  const blocks: number[] = [];
  const headings: number[] = [];
  if (hasMeta) blocks.push(0); // frontmatter 卡片对应文件开头
  let line = skipLines;
  for (const tk of marked.lexer(body)) {
    if (!tokenRendersNothing(tk)) blocks.push(line);
    if (tk.type === "heading") headings.push(line);
    line += countLines(tk.raw ?? "");
  }
  blockLines = blocks.length === previewEl.children.length ? blocks : [];

  const els = Array.from(previewEl.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6"));
  // 数量对不上说明有标题藏在引用块 / 列表里（不是顶层 token），这层也只好放弃
  headingAnchors =
    els.length === headings.length ? els.map((el, i) => ({ el, line: headings[i] })) : [];
}

// 源码第 line 行落在预览的第几块：取起始行不超过它的最后一块
function blockOfLine(line: number): number {
  let found = -1;
  for (let i = 0; i < blockLines.length; i++) {
    if (blockLines[i] <= line) found = i;
    else break;
  }
  return found;
}

// 分段线性插值：xs 单调不减，返回对应的 y
function lerpAt(x: number, xs: number[], ys: number[]): number {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) {
    if (x > xs[i]) continue;
    const span = xs[i] - xs[i - 1];
    return ys[i - 1] + (span > 0 ? ((x - xs[i - 1]) / span) * (ys[i] - ys[i - 1]) : 0);
  }
  return ys[ys.length - 1];
}

// 插值用的锚点：文档首 + 各标题 + 文档尾，一边是预览里的纵坐标，一边是源码行号
function interpolationAnchors(): { tops: number[]; lines: number[] } {
  const base = previewEl.getBoundingClientRect().top - previewEl.scrollTop;
  const tops = [0];
  const lines = [0];
  for (const a of headingAnchors) {
    tops.push(a.el.getBoundingClientRect().top - base);
    lines.push(a.line);
  }
  tops.push(previewEl.scrollHeight);
  lines.push(countLines(currentDoc?.markdown ?? "") + 1);
  return { tops, lines };
}

// 阅读位置 → 源码行（0 基）
function sourceLineOf(anchor: ReadAnchor): number {
  if (anchor.index >= 0 && anchor.index < blockLines.length) return blockLines[anchor.index];
  const { tops, lines } = interpolationAnchors();
  return Math.round(lerpAt(previewEl.scrollTop, tops, lines));
}

// 源码行（0 基）→ 把对应正文顶到视野上沿
function scrollPreviewToLine(line: number) {
  const block = blockOfLine(line);
  if (block >= 0) {
    keepAnchor({ index: block, offset: 0, top: 0 });
    return;
  }
  const { tops, lines } = interpolationAnchors();
  keepAnchor({ index: -1, offset: 0, top: Math.round(lerpAt(line, lines, tops)) });
}

// 把 markdown 文本渲染到预览区
async function render(markdown: string, path: string) {
  currentDoc = { markdown, path }; // 原文保持不变（编辑/保存/荧光笔都基于原文）
  const { fm, body, skipLines } = extractFrontmatter(stripFontTags(markdown));
  // .txt 里空白就是排版：先把 ASCII 图、对齐的表格、缩进的段落钉住，再交给 Markdown
  const prepared = /\.txt$/i.test(path) ? preserveTextLayout(body) : body;
  const rawHtml = await marked.parse(prepared);
  previewEl.innerHTML = DOMPurify.sanitize((fm ? renderMeta(fm) : "") + rawHtml);
  // 文件名显示在居中标题栏（同时设置原生标题，用于窗口切换器）
  docName = path.split("/").pop() ?? path;
  applyMode();
  updateTitle();
  const dir = path.slice(0, path.lastIndexOf("/"));
  resolveImages(dir);
  enhanceDiagrams(previewEl); // 先把图表代码块换成卡片，剩下的才是真代码块
  enhanceCodeBlocks();
  enhanceTables();
  buildToc();
  updateDocStats(); // 阅读模式的字数按渲染后的可见正文统计
  buildSourceMap(prepared, skipLines, fm !== null); // 各增强步骤只做等量替换，块数已定
  previewEl.scrollTop = 0;
}

// 把正文里指向本地文件的图片，按 md 所在目录解析并读成 data URL 内联进去
function resolveImages(dir: string) {
  previewEl.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src") ?? "";
    if (!src) return;
    // 网络图片 / 已内联的直接用
    if (/^(https?:|data:)/i.test(src)) {
      img.classList.add("zoomable");
      return;
    }
    // 本地路径：相对路径按 md 所在目录拼成绝对路径
    let rel = src;
    try {
      rel = decodeURIComponent(src);
    } catch {
      /* src 含非法转义则原样使用 */
    }
    const abs = rel.startsWith("/") ? rel : `${dir}/${rel.replace(/^\.\//, "")}`;
    invoke<string>("read_image_data_url", { path: abs })
      .then((dataUrl) => {
        img.src = dataUrl;
        img.classList.add("zoomable");
      })
      .catch(() => {
        img.alt = i18n("img.failed", { path: abs });
      });
  });
}

// 复制 / 对勾 图标
const COPY_ICON = `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="5.5" y="5.5" width="8" height="9" rx="1.5"/><path d="M3.5 10.5h-1A1 1 0 0 1 1.5 9.5v-7A1 1 0 0 1 2.5 1.5h7a1 1 0 0 1 1 1v1"/></svg>`;
const CHECK_ICON = `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 8.5l3.2 3.2L13 4.5"/></svg>`;

// 从 <code class="hljs language-xxx"> 里取语言名，用来在代码块右上角标一下
function codeLangOf(pre: HTMLPreElement): string {
  const code = pre.querySelector("code");
  if (!code) return "";
  for (const cls of Array.from(code.classList)) {
    if (cls.startsWith("language-")) return cls.slice("language-".length);
  }
  return "";
}

// 给每个代码块加「语言标 + 复制」。
// 图表卡片里的 pre（源码视图 / 字符画回落）跳过——卡片自己那条工具条上已经有复制了。
function enhanceCodeBlocks() {
  previewEl
    .querySelectorAll<HTMLPreElement>(
      "pre:not(.diagram-source):not(.diagram-textart):not(.txt-block)",
    )
    .forEach((pre) => {
      const lang = codeLangOf(pre);
      if (lang) {
        const tag = document.createElement("span");
        tag.className = "code-lang";
        tag.textContent = lang;
        pre.appendChild(tag);
      }
      const btn = document.createElement("button");
      btn.className = "copy-btn";
      btn.type = "button";
      btn.title = i18n("code.copy");
      btn.innerHTML = COPY_ICON;
      btn.addEventListener("click", async () => {
        const code = pre.querySelector("code")?.textContent ?? pre.textContent ?? "";
        await navigator.clipboard.writeText(code);
        btn.innerHTML = CHECK_ICON;
        btn.classList.add("copied");
        setTimeout(() => {
          btn.innerHTML = COPY_ICON;
          btn.classList.remove("copied");
        }, 1200);
      });
      pre.appendChild(btn);
    });
}

// 折行切换图标
const WRAP_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><path d="M3 12h15a3 3 0 0 1 0 6h-3"/><polyline points="16 15 13 18 16 21"/><line x1="3" y1="18" x2="9" y2="18"/></svg>`;

// 给每个表格套一个可横向滚动的容器，并在表格上方加「折行 / 不折行」切换图标
function enhanceTables() {
  previewEl.querySelectorAll("table").forEach((table) => {
    const block = document.createElement("div");
    block.className = "table-block";
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";

    table.replaceWith(block);
    wrap.appendChild(table);

    const bar = document.createElement("div");
    bar.className = "table-bar";
    const btn = document.createElement("button");
    btn.className = "table-toggle";
    btn.type = "button";
    btn.title = i18n("table.nowrap");
    btn.innerHTML = WRAP_ICON;
    btn.addEventListener("click", () => {
      const nowrap = wrap.classList.toggle("nowrap");
      btn.classList.toggle("active", nowrap);
      btn.title = nowrap ? i18n("table.wrap") : i18n("table.nowrap");
    });
    bar.appendChild(btn);

    block.appendChild(bar);
    block.appendChild(wrap);
  });
}

// ===== 目录（大纲）：可折叠的树形结构 =====
type TocNode = {
  el: HTMLElement;
  level: number;
  link: HTMLButtonElement;
  children: TocNode[];
};

// 用标题文字创建一个跳转按钮
function makeTocLink(h: HTMLElement, text: string): HTMLButtonElement {
  const link = document.createElement("button");
  link.type = "button";
  link.className = "toc-link";
  link.textContent = text;
  link.title = text;
  link.addEventListener("click", () => scrollToHeading(h));
  return link;
}

// 把一个树节点渲染成 DOM：折叠箭头（有子级才可点）+ 标题按钮 + 子级容器
function renderTocNode(node: TocNode): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "toc-node";

  const row = document.createElement("div");
  row.className = "toc-row";

  const caret = document.createElement("button");
  caret.type = "button";
  caret.className = "toc-caret";
  if (node.children.length) {
    caret.innerHTML = CARET_ICON;
    caret.setAttribute("aria-label", "展开/收起");
    caret.addEventListener("click", (e) => {
      e.stopPropagation(); // 只折叠，不跳转
      wrap.classList.toggle("collapsed");
    });
  } else {
    caret.classList.add("leaf"); // 占位对齐，无箭头、不可点
    caret.tabIndex = -1;
  }

  row.append(caret, node.link);
  wrap.appendChild(row);

  if (node.children.length) {
    const kids = document.createElement("div");
    kids.className = "toc-children";
    node.children.forEach((c) => kids.appendChild(renderTocNode(c)));
    wrap.appendChild(kids);
  }
  return wrap;
}

// 渲染后扫描预览里的标题，按层级构建树并重建左侧目录。无标题则整块隐藏。
function buildToc() {
  tocListEl.innerHTML = "";
  tocEntries = [];
  const headings = Array.from(
    previewEl.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"),
  ).filter((h) => (h.textContent ?? "").trim());

  // 按标题级别用栈建树：层级更高（数字更小）的节点作为父级
  const roots: TocNode[] = [];
  const stack: TocNode[] = [];
  for (const h of headings) {
    const text = (h.textContent ?? "").trim();
    const level = Number(h.tagName[1]);
    const node: TocNode = { el: h, level, link: makeTocLink(h, text), children: [] };
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(node);
    else roots.push(node);
    stack.push(node);
    tocEntries.push({ el: h, link: node.link });
  }

  roots.forEach((n) => tocListEl.appendChild(renderTocNode(n)));
  hasToc = tocEntries.length > 0;
  applyMode(); // 依据 hasToc 刷新目录按钮 / 侧栏显隐
  updateTocActive();
}

// 把预览滚动到某个标题（预览区自身是滚动容器，用相对位移计算目标位置）
function scrollToHeading(h: HTMLElement) {
  const base = previewEl.getBoundingClientRect().top;
  const y = previewEl.scrollTop + (h.getBoundingClientRect().top - base) - 12;
  previewEl.scrollTo({ top: y, behavior: "smooth" });
}

// 高亮当前所在章节：取视口顶部往下 80px 处、仍在其上方的最后一个标题
function updateTocActive() {
  if (tocEl.hidden || tocEntries.length === 0) return;
  const base = previewEl.getBoundingClientRect().top;
  let activeIdx = 0;
  for (let i = 0; i < tocEntries.length; i++) {
    if (tocEntries[i].el.getBoundingClientRect().top - base <= 80) activeIdx = i;
    else break;
  }
  tocEntries.forEach((e, i) => {
    const on = i === activeIdx;
    e.link.classList.toggle("active", on);
    // 让高亮项保持在目录可视区（被折叠隐藏时 offsetParent 为 null，跳过）
    if (on && e.link.offsetParent !== null) e.link.scrollIntoView({ block: "nearest" });
  });
}

tocToggleBtn.innerHTML = TOC_ICON;
tocToggleBtn.addEventListener("click", () => {
  tocOpen = !tocOpen;
  localStorage.setItem(TOC_KEY, tocOpen ? "1" : "0");
  keepReadingPos(applyMode); // 侧栏收展会改变正文宽度 → 折行变了，高度也跟着变
  updateTocActive();
});
window.addEventListener("storage", (e) => {
  if (e.key === TOC_KEY) {
    tocOpen = localStorage.getItem(TOC_KEY) !== "0";
    keepReadingPos(applyMode);
    updateTocActive();
  }
});
// 预览滚动时刷新高亮（rAF 节流）
let tocRaf = 0;
previewEl.addEventListener("scroll", () => {
  if (tocRaf) return;
  tocRaf = requestAnimationFrame(() => {
    tocRaf = 0;
    updateTocActive();
  });
});

// 点击图片放大预览（lightbox）
const lightbox = document.createElement("div");
lightbox.className = "lightbox";
lightbox.hidden = true;
const lightboxImg = document.createElement("img");
lightbox.appendChild(lightboxImg);
document.body.appendChild(lightbox);
lightbox.addEventListener("click", () => (lightbox.hidden = true));

previewEl.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (target.tagName === "IMG" && target.classList.contains("zoomable")) {
    lightboxImg.src = (target as HTMLImageElement).src;
    lightbox.hidden = false;
  }
});

// ===== 荧光笔：预览里选中文字 → 浮出调色板 → 把 == / <mark> 写回源码 =====
const HL_COLORS = ["yellow", "green", "pink", "blue"];
const ERASER_ICON = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14l6 6h7M20 20H8.5"/><path d="M14.5 4.5l5 5a2 2 0 0 1 0 2.8l-6.2 6.2H10l-4.5-4.5a2 2 0 0 1 0-2.8l6.2-6.2a2 2 0 0 1 2.8 0z"/></svg>`;

const hlPopover = document.createElement("div");
hlPopover.className = "hl-popover";
hlPopover.hidden = true;
for (const c of HL_COLORS) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `hl-swatch hl-${c}`;
  b.dataset.color = c;
  hlPopover.appendChild(b);
}
const eraserBtn = document.createElement("button");
eraserBtn.type = "button";
eraserBtn.className = "hl-eraser";
eraserBtn.innerHTML = ERASER_ICON;
hlPopover.appendChild(eraserBtn);
document.body.appendChild(hlPopover);

// 轻量 toast（定位失败等提示）
const toastEl = document.createElement("div");
toastEl.className = "toast";
document.body.appendChild(toastEl);
let toastTimer = 0;
function showToast(msg: string) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove("show"), 2600);
}

let hlTargetMark: HTMLElement | null = null; // 橡皮擦的目标高亮

function closestMark(node: Node | null): HTMLElement | null {
  const el = node instanceof HTMLElement ? node : (node?.parentElement ?? null);
  return el ? el.closest("mark") : null;
}

function hideHlPopover() {
  hlPopover.hidden = true;
  hlTargetMark = null;
}

function showHlPopover(rect: DOMRect, mark: HTMLElement | null) {
  hlTargetMark = mark;
  eraserBtn.hidden = !mark;
  eraserBtn.title = i18n("hl.erase");
  hlPopover.hidden = false;
  const pw = hlPopover.offsetWidth;
  const ph = hlPopover.offsetHeight;
  let left = rect.left + rect.width / 2 - pw / 2;
  let top = rect.top - ph - 8;
  left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
  if (top < 8) top = rect.bottom + 8; // 顶部放不下就翻到选区下方
  hlPopover.style.left = `${left}px`;
  hlPopover.style.top = `${top}px`;
}

// 选区结束后决定是否浮出调色板：编辑模式不弹；点在已有高亮上则只给橡皮擦
function maybeShowHlPopover() {
  if (isEditMode || !currentDoc) return hideHlPopover();
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return hideHlPopover();
  const range = sel.getRangeAt(0);
  if (!previewEl.contains(range.commonAncestorContainer)) return hideHlPopover();
  const mark = closestMark(range.commonAncestorContainer) ?? closestMark(range.startContainer);
  if (sel.isCollapsed) {
    if (mark) showHlPopover(mark.getBoundingClientRect(), mark);
    else hideHlPopover();
    return;
  }
  showHlPopover(range.getBoundingClientRect(), mark);
}

previewEl.addEventListener("mouseup", () => window.setTimeout(maybeShowHlPopover, 0));
previewEl.addEventListener("scroll", hideHlPopover);
document.addEventListener("mousedown", (e) => {
  if (!hlPopover.hidden && !hlPopover.contains(e.target as Node)) hideHlPopover();
});

// 选区文字在预览里是第几次出现（0 基），用来映射回源码里的同名片段
function occurrenceIndex(range: Range, s: string): number {
  const pre = document.createRange();
  pre.selectNodeContents(previewEl);
  pre.setEnd(range.startContainer, range.startOffset);
  const before = pre.toString();
  let i = 0;
  let n = 0;
  while ((i = before.indexOf(s, i)) !== -1) {
    n++;
    i += s.length;
  }
  return n;
}

function nthIndexOf(s: string, sub: string, n: number): number {
  let i = -1;
  for (let k = 0; k <= n; k++) {
    i = s.indexOf(sub, i + 1);
    if (i === -1) return -1;
  }
  return i;
}

// 把文档换成新内容（编辑器同步），重渲染后保持原滚动位置（render 末尾会回顶）。
// persist=true 时直接写回文件并标记为已保存（高亮这类一次性动作即点即存）；
// 否则只在内存里改、标「未保存」，等用户 ⌘S（文字编辑走这条）。
async function applyDocEdit(next: string, persist = false) {
  if (!currentDoc) return;
  const anchor = captureAnchor();
  if (isEditMode) mdEditor!.setValue(next);
  await render(next, currentDoc.path);
  keepAnchor(anchor);
  if (persist) {
    try {
      await invoke("write_file", { path: currentDoc.path, content: next });
      savedMarkdown = next; // 已落盘 → 不再标脏
    } catch (err) {
      await message(i18n("edit.saveError", { err: String(err) }), {
        title: i18n("edit.saveErrorTitle"),
        kind: "error",
      });
    }
  }
  updateEditUI();
}

function applyHighlight(color: string) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !currentDoc) return;
  const range = sel.getRangeAt(0);
  const s = sel.toString().trim();
  if (!s || /\n/.test(s)) {
    showToast(i18n("hl.failed")); // 跨段 / 跨格式的选区先不支持
    return;
  }
  const occ = occurrenceIndex(range, s);
  const src = currentDoc.markdown;
  const pos = nthIndexOf(src, s, occ);
  if (pos === -1) {
    showToast(i18n("hl.failed"));
    return;
  }
  const wrapped =
    color === "yellow" ? `==${s}==` : `<mark class="hl-${color}">${s}</mark>`;
  applyDocEdit(src.slice(0, pos) + wrapped + src.slice(pos + s.length), true);
  sel.removeAllRanges();
  hideHlPopover();
}

// 源码里按顺序匹配所有高亮（==..== 或 <mark>..</mark>），与预览里的 <mark> 一一对应
const HL_SOURCE_RE = /==(?=\S)([\s\S]*?\S)==|<mark\b[^>]*>([\s\S]*?)<\/mark>/g;
function removeHighlight(mark: HTMLElement) {
  if (!currentDoc) return;
  const n = Array.from(previewEl.querySelectorAll("mark")).indexOf(mark);
  if (n === -1) return hideHlPopover();
  const src = currentDoc.markdown;
  HL_SOURCE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  let k = -1;
  while ((m = HL_SOURCE_RE.exec(src))) {
    if (++k !== n) continue;
    const inner = m[1] ?? m[2] ?? "";
    applyDocEdit(src.slice(0, m.index) + inner + src.slice(m.index + m[0].length), true);
    break;
  }
  hideHlPopover();
}

hlPopover.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest("button");
  if (!btn) return;
  if (btn === eraserBtn) {
    if (hlTargetMark) removeHighlight(hlTargetMark);
  } else if (btn.dataset.color) {
    applyHighlight(btn.dataset.color);
  }
});

// 读取某个路径的文件并渲染
async function openPath(path: string) {
  if (!(await confirmDiscardIfDirty())) return; // 有未保存修改时先确认
  try {
    const content = await invoke<string>("read_file", { path });
    isEditMode = false;
    editView = null; // 换文档：上一篇改到哪儿不再有意义
    savedMarkdown = content; // 刚读出的磁盘内容即「已保存」基准
    await render(content, path);
    updateEditUI();
  } catch (err) {
    previewEl.innerHTML = `<p style="color:#c00">${esc(i18n("file.readError"))}: ${esc(String(err))}</p>`;
    previewEl.hidden = false;
    emptyEl.hidden = true;
  }
}

// 拦截正文里的链接点击：外链用系统浏览器打开，避免 webview 自己导航走、覆盖掉当前内容
previewEl.addEventListener("click", (e) => {
  const anchor = (e.target as HTMLElement).closest("a");
  if (!anchor) return;
  e.preventDefault();
  const href = anchor.getAttribute("href");
  if (href && /^https?:\/\//i.test(href)) {
    openUrl(href);
  }
});

// 认得的文件后缀。.txt 也走 Markdown 那条渲染管线——纯文本笔记里常常本来就写着
// # 标题和 - 列表，按 Markdown 排出来更好读；目录、荧光笔、图表卡片也一并能用。
const DOC_EXTENSIONS = ["md", "markdown", "mdown", "mkd", "txt"];
const DOC_EXT_RE = new RegExp(`\\.(${DOC_EXTENSIONS.join("|")})$`, "i");

// 弹出文件选择框
async function pickAndOpen() {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: i18n("file.dialogName"), extensions: DOC_EXTENSIONS }],
  });
  if (typeof selected === "string") {
    await openPath(selected);
  }
}

// 菜单 File → 打开（⌘O）触发
listen("menu-open", () => {
  pickAndOpen();
});

// 主窗口热启动时被要求打开文件：直接渲染
listen<string>("open-file", (e) => {
  if (e.payload) openPath(e.payload);
});

// 启动：先刷新界面语言并把原生菜单同步到当前语言
applyI18n();
syncMenuLocale();

// 启动时取本窗口要打开的文件（文档窗口 / 主窗口冷启动都走这里）
invoke<string | null>("get_initial_file").then((path) => {
  if (path) openPath(path);
});

// ===== 自动更新：仅主窗口启动时静默检查一次，发现新版征询后下载安装并重启 =====
async function checkForUpdate() {
  if (getCurrentWindow().label !== "main") return; // 避免每个文档窗口都查一遍
  try {
    const update = await check();
    if (!update) return; // 已是最新
    const yes = await ask(
      `${i18n("update.prompt", { version: update.version })}${update.body ? `\n\n${update.body}` : ""}`,
      {
        title: i18n("update.title"),
        kind: "info",
        okLabel: i18n("update.ok"),
        cancelLabel: i18n("update.cancel"),
      },
    );
    if (!yes) return;
    await update.downloadAndInstall();
    await relaunch();
  } catch (err) {
    // 无网络 / 尚无发布 / 开发环境无更新端点等都会落到这里，静默忽略即可
    console.warn("更新检查失败：", err);
  }
}
checkForUpdate();

// 拖拽文件到窗口
getCurrentWebview().onDragDropEvent((event) => {
  const { type } = event.payload;
  if (type === "over" || type === "enter") {
    overlayEl.hidden = false;
  } else if (type === "drop") {
    overlayEl.hidden = true;
    const file = event.payload.paths[0];
    if (file && DOC_EXT_RE.test(file)) {
      openPath(file);
    }
  } else {
    overlayEl.hidden = true;
  }
});
