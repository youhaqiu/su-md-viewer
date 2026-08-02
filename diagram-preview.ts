// 临时预览壳：只跑 Markdown 渲染 + 图表增强，不引 Tauri，于是能直接在浏览器里看。
// 不属于应用本体，验收完可以删。
import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";
import hljs from "highlight.js";
import DOMPurify from "dompurify";
import { enhanceDiagrams, refreshDiagrams } from "./src/diagram";
import "highlight.js/styles/github.css";
import "github-markdown-css/github-markdown.css";

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
marked.setOptions({ gfm: true, breaks: true });

const preview = document.querySelector<HTMLElement>("#preview")!;
const root = document.documentElement;
const q = new URLSearchParams(location.search);

// 验收开关（无头截图用）：?dark 深色、?accent=teal 换主题色、?tools 强制显示工具条、
// ?clean 规整风格、?drag 自动模拟一次拖拽
if (q.has("dark")) {
  root.setAttribute("data-theme", "dark");
  root.setAttribute("data-color-mode", "dark");
}
if (q.has("accent")) root.setAttribute("data-accent", q.get("accent")!);
// ?style=neon|glass|circuit|clean|sketch（?clean 是旧写法，留着不碍事）
localStorage.setItem("diagram-colorful", q.has("colorful") ? "1" : "0"); // ?colorful：彩色开关
if (q.has("style")) localStorage.setItem("diagram-style", q.get("style")!);
else if (q.has("clean")) localStorage.setItem("diagram-style", "clean");
else if (q.has("sketch")) localStorage.removeItem("diagram-style");
if (q.has("tools")) {
  const s = document.createElement("style");
  s.textContent = ".diagram-tools{opacity:1 !important}";
  document.head.appendChild(s);
}

async function render(md: string) {
  const body = md.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, "");
  preview.innerHTML = DOMPurify.sanitize(await marked.parse(body));
  enhanceDiagrams(preview);
}

// ?doc=xxx.md 换一份验收文档（默认 sample-diagrams.md）
async function loadSample() {
  const name = q.get("doc") || "sample-diagrams.md";
  await render(await fetch(`/${name}`).then((r) => r.text()));
}

// 深浅色
const themeBtn = document.querySelector<HTMLButtonElement>("#theme")!;
themeBtn.addEventListener("click", () => {
  const dark = root.getAttribute("data-theme") === "dark";
  root.setAttribute("data-theme", dark ? "light" : "dark");
  root.setAttribute("data-color-mode", dark ? "light" : "dark");
  themeBtn.textContent = dark ? "切深色" : "切浅色";
  refreshDiagrams(); // 与应用里 applyTheme() 的行为一致
});

// 主题色
document.querySelectorAll<HTMLButtonElement>(".dot").forEach((b) => {
  b.addEventListener("click", () => {
    root.setAttribute("data-accent", b.dataset.accent!);
    refreshDiagrams();
  });
});

document.querySelector<HTMLButtonElement>("#reload")!.addEventListener("click", loadSample);

// 拖入自己的 md
const drop = document.querySelector<HTMLElement>("#drop")!;
document.addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.classList.add("on");
});
document.addEventListener("dragleave", (e) => {
  if (e.relatedTarget === null) drop.classList.remove("on");
});
document.addEventListener("drop", async (e) => {
  e.preventDefault();
  drop.classList.remove("on");
  const file = e.dataTransfer?.files?.[0];
  if (file) await render(await file.text());
});

// ?drag：自动在第一张自渲染的图上模拟一次拖拽，用于无头验收（正常使用用不到）
async function probeDrag() {
  await new Promise((r) => setTimeout(r, 2500));
  const card = Array.from(document.querySelectorAll<HTMLElement>(".diagram-card")).find((c) =>
    c.querySelector("canvas"),
  );
  const view = card?.querySelector<HTMLElement>(".diagram-view");
  const canvas = card?.querySelector<HTMLCanvasElement>("canvas");
  if (!view || !canvas) {
    console.warn("没找到可拖拽的图");
    return;
  }
  const r = canvas.getBoundingClientRect();
  const fire = (type: string, x: number, y: number) =>
    view.dispatchEvent(
      new PointerEvent(type, {
        pointerId: 1,
        clientX: x,
        clientY: y,
        bubbles: true,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
      }),
    );

  // 在画布上撒点找一个真正命中节点的位置（命中时卡片会加 dragging-node 类）
  let hit: { x: number; y: number } | null = null;
  for (let gy = 0.08; gy < 1 && !hit; gy += 0.06) {
    for (let gx = 0.1; gx < 1 && !hit; gx += 0.06) {
      const x = r.left + r.width * gx;
      const y = r.top + r.height * gy;
      fire("pointerdown", x, y);
      if (view.classList.contains("dragging-node")) hit = { x, y };
      else fire("pointerup", x, y);
    }
  }
  if (!hit) {
    console.warn("拖拽探针：没有命中任何节点");
    document.title = "DRAG-MISS";
    return;
  }
  for (let k = 1; k <= 10; k++) {
    fire("pointermove", hit.x + 16 * k, hit.y + 5 * k);
  }
  fire("pointerup", hit.x + 160, hit.y + 50);
  document.title = "DRAG-OK";
  console.log("拖拽探针：命中并拖动完成");
}

// ?openstyle：把第一张图的风格菜单点开，用于无头验收工具条本身
function openStyleMenu() {
  setTimeout(() => {
    const btn = document.querySelector<HTMLButtonElement>(
      ".diagram-card .diagram-tools > button:nth-child(5)",
    );
    btn?.click();
  }, 2000);
}

// ?svg：走一遍导出用的 SvgSurface（发光滤镜 / 渐变都在 defs 里），把结果直接贴到页面上，
// 无头截图就能看出矢量导出和屏幕上画的是不是一回事
async function showExportedSvg() {
  const { parseMermaid } = await import("./src/diagram/parse-mermaid");
  const { layoutGraph } = await import("./src/diagram/layout");
  const { renderGraph } = await import("./src/diagram/render");
  const { SvgSurface } = await import("./src/diagram/surface");
  const { readTheme } = await import("./src/diagram/theme");
  const code = `flowchart TD\n  A[开始] --> B{文件存在?}\n  B -- 是 --> C[读取内容]\n  B -- 否 --> D[提示错误]\n  C --> E([渲染预览])\n  D --> E\n  E --> F[(数据库)]`;
  const g = parseMermaid(code);
  if (!g) return;
  const t = readTheme();
  layoutGraph(g, t);
  const s = new SvgSurface(g.width, g.height, t.bg);
  renderGraph(s, g, t);
  preview.innerHTML = `<div style="padding:20px">${s.serialize()}</div>`;
}

loadSample().then(() => {
  if (q.has("drag")) void probeDrag();
  if (q.has("openstyle")) openStyleMenu();
  if (q.has("svg")) void showExportedSvg();
});
