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
import markedKatex from "marked-katex-extension";
import hljs from "highlight.js";
import DOMPurify from "dompurify";
import {
  t as i18n,
  getLocale,
  setLocale,
  refreshLocale,
  LANG_STORAGE_KEY,
} from "./i18n";

import "highlight.js/styles/github.css";
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

// 渲染 $...$ 行内公式与 $$...$$ 块级公式
marked.use(markedKatex({ throwOnError: false, nonStandard: true }));

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

// ===== 深色模式：默认跟随系统，可手动切换，选择持久化、多窗口同步 =====
const THEME_KEY = "theme"; // "light" | "dark" | 未设置(跟随系统)
const themeBtn = document.querySelector<HTMLButtonElement>("#theme-toggle")!;
const SUN_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`;
const MOON_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>`;
const darkMql = window.matchMedia("(prefers-color-scheme: dark)");

function effectiveTheme(): "light" | "dark" {
  const s = localStorage.getItem(THEME_KEY);
  if (s === "light" || s === "dark") return s;
  return darkMql.matches ? "dark" : "light";
}

function applyTheme() {
  const t = effectiveTheme();
  const root = document.documentElement;
  root.setAttribute("data-theme", t);
  root.setAttribute("data-color-mode", t); // 供 github-markdown.css 切换
  root.setAttribute("data-light-theme", "light");
  root.setAttribute("data-dark-theme", "dark");
  themeBtn.innerHTML = t === "dark" ? SUN_ICON : MOON_ICON; // 显示「点击后会切到」的图标
  themeBtn.title = t === "dark" ? i18n("theme.toLight") : i18n("theme.toDark");
}

themeBtn.addEventListener("click", () => {
  localStorage.setItem(THEME_KEY, effectiveTheme() === "dark" ? "light" : "dark");
  applyTheme();
});
darkMql.addEventListener("change", () => {
  if (!localStorage.getItem(THEME_KEY)) applyTheme(); // 仅在跟随系统时响应
});
window.addEventListener("storage", (e) => {
  if (e.key === THEME_KEY) applyTheme(); // 其他窗口切换时同步
});
applyTheme();

const titleEl = document.querySelector<HTMLSpanElement>("#title")!;
const emptyEl = document.querySelector<HTMLDivElement>("#empty")!;
const previewEl = document.querySelector<HTMLElement>("#preview")!;
const overlayEl = document.querySelector<HTMLDivElement>("#drop-overlay")!;
const langBtn = document.querySelector<HTMLButtonElement>("#lang-toggle")!;
const brandTagEl = document.querySelector<HTMLParagraphElement>("#brand-tag")!;
const dropHintEl = document.querySelector<HTMLSpanElement>("#drop-hint")!;

// 记住当前已打开的文档，切换语言时重渲染以刷新动态文案（复制/折行按钮等）
let currentDoc: { markdown: string; path: string } | null = null;

// ===== 编辑模式：切换式（预览 ⇄ 编辑原始 Markdown），手动保存（⌘S）=====
const editToggleBtn = document.querySelector<HTMLButtonElement>("#edit-toggle")!;
const saveBtn = document.querySelector<HTMLButtonElement>("#save-btn")!;
const editorEl = document.querySelector<HTMLTextAreaElement>("#editor")!;

let isEditMode = false;
let savedMarkdown = ""; // 最近一次落盘的内容，用于判断「是否有未保存修改」
let docName = ""; // 当前文件名（标题栏脏标记会在前面加 •）

const PENCIL_ICON = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>`;
const EYE_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
const SAVE_ICON = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>`;
const SAVED_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4 4 10-10"/></svg>`;

// 当前生效的文本：编辑时以文本框为准，预览时以已渲染文档为准
function currentText(): string {
  return isEditMode ? editorEl.value : currentDoc?.markdown ?? "";
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
  editToggleBtn.hidden = !hasDoc;
  saveBtn.hidden = !hasDoc || (!isEditMode && !isDirty());
}

// 刷新编辑相关按钮的图标 / 文案 / 状态
function updateEditUI() {
  editToggleBtn.innerHTML = isEditMode ? EYE_ICON : PENCIL_ICON;
  editToggleBtn.title = isEditMode ? i18n("edit.toPreview") : i18n("edit.toEdit");
  const dirty = isDirty();
  saveBtn.title = i18n("edit.save");
  saveBtn.disabled = !dirty;
  saveBtn.classList.toggle("dirty", dirty);
  applyMode();
  updateTitle();
}

// 标题栏：未保存时在文件名前加 • 提示
function updateTitle() {
  if (!currentDoc) return;
  const dot = isDirty() ? "• " : "";
  titleEl.textContent = dot + docName;
  getCurrentWindow().setTitle(`${dot}${docName} — 73·素`);
}

// 进入编辑：把原始 Markdown 灌进文本框
function enterEdit() {
  if (!currentDoc) return;
  isEditMode = true;
  editorEl.value = currentDoc.markdown;
  applyMode();
  updateEditUI();
  editorEl.focus();
}

// 回到预览：用文本框里的内容重渲染（仅内存预览，未保存到磁盘）
async function exitToPreview() {
  if (!currentDoc) return;
  isEditMode = false;
  await render(editorEl.value, currentDoc.path);
  updateEditUI();
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
editorEl.addEventListener("input", updateEditUI);

// 快捷键：⌘E 切换编辑 / 预览，⌘S 保存
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

// 关窗口前若有未保存修改则拦截确认。
// 注意：这个 wry 版本挂了 onCloseRequested 监听后窗口不会自动关闭，必须显式 destroy()
// （destroy 不会再触发 close-requested，避免死循环；需 core:window:allow-destroy 权限）。
getCurrentWindow().onCloseRequested(async (event) => {
  event.preventDefault();
  if (await confirmDiscardIfDirty()) {
    await getCurrentWindow().destroy();
  }
});

// ===== 国际化：把静态界面文案按当前语言刷新；语言按钮显示当前语言、点击切换 =====
function applyI18n() {
  const loc = getLocale();
  document.documentElement.setAttribute("lang", loc === "zh" ? "zh" : "en");
  brandTagEl.textContent = i18n("app.tagline");
  dropHintEl.textContent = i18n("drop.hint");
  langBtn.textContent = loc === "zh" ? "中" : "EN";
  langBtn.title = i18n("lang.switch");
  applyTheme(); // 同步深色按钮的多语言 tooltip
  updateEditUI(); // 刷新编辑 / 保存按钮的多语言 tooltip
  // 切语言会重渲染已打开文档以刷新动态文案，保留原滚动位置（否则会跳回顶部）
  if (currentDoc && !isEditMode) {
    const y = previewEl.scrollTop;
    render(currentDoc.markdown, currentDoc.path).then(() => {
      previewEl.scrollTop = y;
    });
  }
}

async function syncMenuLocale() {
  try {
    await invoke("set_locale_menu", { lang: getLocale() });
  } catch {
    /* 菜单同步失败不影响使用 */
  }
}

langBtn.addEventListener("click", () => {
  setLocale(getLocale() === "zh" ? "en" : "zh");
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

// 抽出文件开头的 YAML frontmatter（--- ... ---），返回元信息与正文
function extractFrontmatter(md: string): { fm: string | null; body: string } {
  const m = md.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/);
  if (!m) return { fm: null, body: md };
  return { fm: m[1], body: md.slice(m[0].length) };
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

// 把 markdown 文本渲染到预览区
async function render(markdown: string, path: string) {
  currentDoc = { markdown, path };
  const { fm, body } = extractFrontmatter(markdown);
  const rawHtml = await marked.parse(body);
  previewEl.innerHTML = DOMPurify.sanitize((fm ? renderMeta(fm) : "") + rawHtml);
  // 文件名显示在居中标题栏（同时设置原生标题，用于窗口切换器）
  docName = path.split("/").pop() ?? path;
  applyMode();
  updateTitle();
  const dir = path.slice(0, path.lastIndexOf("/"));
  resolveImages(dir);
  enhanceCodeBlocks();
  enhanceTables();
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

// 给每个代码块加「复制」图标按钮
function enhanceCodeBlocks() {
  previewEl.querySelectorAll("pre").forEach((pre) => {
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
  const y = previewEl.scrollTop;
  if (isEditMode) editorEl.value = next;
  await render(next, currentDoc.path);
  previewEl.scrollTop = y;
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

// 弹出文件选择框
async function pickAndOpen() {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: i18n("file.dialogName"), extensions: ["md", "markdown", "mdown", "mkd"] }],
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
    if (file && /\.(md|markdown|mdown|mkd)$/i.test(file)) {
      openPath(file);
    }
  } else {
    overlayEl.hidden = true;
  }
});
