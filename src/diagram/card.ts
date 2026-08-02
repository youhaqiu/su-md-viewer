// 图表卡片：所有图——不管是 mermaid、flow 语法还是手画的 ASCII——都装进这一个壳里，
// 于是缩放、平移、看源码、复制、导出、深浅色联动这些能力只写一遍，各类图一起获得。

import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { t as i18n } from "../i18n";
import type { DiagramKind } from "./detect";
import { restyleMermaid } from "./colorize-svg";
import { clampNode, growCanvas, nodeAt, rerouteEdgesOf } from "./drag";
import { layoutGraph, placeLabels } from "./layout";
import { renderMermaid } from "./mermaid";
import { sketchifyMermaid } from "./sketchify-svg";
import { parseAscii } from "./parse-ascii";
import { parseFlow } from "./parse-flow";
import { parseMermaid } from "./parse-mermaid";
import { renderGraph } from "./render";
import { CanvasSurface, SvgSurface } from "./surface";
import {
  COLORFUL_EVENT,
  currentStyle,
  isColorful,
  readTheme,
  setColorful,
  setStyle,
  setToolsCollapsed,
  STYLE_EVENT,
  toolsCollapsed,
  TOOLS_EVENT,
} from "./theme";
import { STYLES } from "./types";
import type { DiagramGraph, DiagramNode, DiagramStyle, Point } from "./types";

const ICON = {
  zoomOut: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><line x1="16" y1="16" x2="21" y2="21"/><line x1="8.5" y1="11" x2="13.5" y2="11"/></svg>`,
  zoomIn: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><line x1="16" y1="16" x2="21" y2="21"/><line x1="8.5" y1="11" x2="13.5" y2="11"/><line x1="11" y1="8.5" x2="11" y2="13.5"/></svg>`,
  code: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 4 12 9 18"/><polyline points="15 6 20 12 15 18"/></svg>`,
  shape: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="3" y="3.5" width="7.5" height="6" rx="1.2"/><rect x="13.5" y="14.5" width="7.5" height="6" rx="1.2"/><path d="M6.75 9.5v5a2 2 0 0 0 2 2h4.75"/></svg>`,
  copy: `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="5.5" y="5.5" width="8" height="9" rx="1.5"/><path d="M3.5 10.5h-1A1 1 0 0 1 1.5 9.5v-7A1 1 0 0 1 2.5 1.5h7a1 1 0 0 1 1 1v1"/></svg>`,
  check: `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 8.5l3.2 3.2L13 4.5"/></svg>`,
  pen: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>`,
  download: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v11"/><polyline points="7.5 10 12 14.5 16.5 10"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>`,
  collapse: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 5 16 12 9 19"/></svg>`,
  ruler: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="2.5" y="7" width="19" height="10" rx="1.5"/><path d="M7 7v3M11 7v4.5M15 7v3M19 7v4.5"/></svg>`,
  bolt: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><polygon points="13 2 4 14 11 14 10 22 20 9 13 9"/></svg>`,
  drop: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M12 3c4 5 6 7.7 6 10.5A6 6 0 0 1 6 13.5C6 10.7 8 8 12 3z"/><path d="M9.5 14a2.5 2.5 0 0 0 2.5 2.5" stroke-width="1.3"/></svg>`,
  chip: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="7" y="7" width="10" height="10" rx="1"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/></svg>`,
  palette: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3.2a8.8 8.8 0 1 0 0 17.6c1.2 0 1.8-.8 1.8-1.6 0-1.5-1.2-1.6-1.2-2.7 0-.8.7-1.4 1.6-1.4h1.6a4.9 4.9 0 0 0 4.9-4.9C20.7 6.2 16.8 3.2 12 3.2z"/><circle cx="7.6" cy="11" r="1.2" fill="currentColor" stroke="none"/><circle cx="10.4" cy="7.3" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="7.8" r="1.2" fill="currentColor" stroke="none"/></svg>`,
  expand: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 5 8 12 15 19"/></svg>`,
};

const MIN_SCALE = 0.3;
const MAX_SCALE = 4;

// 五种绘制风格在工具条上的图标与文案键
const STYLE_ICON: Record<DiagramStyle, string> = {
  sketch: ICON.pen,
  clean: ICON.ruler,
  neon: ICON.bolt,
  glass: ICON.drop,
  circuit: ICON.chip,
};

const STYLE_LABEL: Record<DiagramStyle, string> = {
  sketch: "diagram.styleSketch",
  clean: "diagram.styleClean",
  neon: "diagram.styleNeon",
  glass: "diagram.styleGlass",
  circuit: "diagram.styleCircuit",
};

type Rendered =
  | { type: "graph"; graph: DiagramGraph; width: number; height: number }
  | { type: "svg"; el: SVGSVGElement; width: number; height: number }
  | { type: "text" }
  | { type: "error"; message: string };

export class DiagramCard {
  readonly el: HTMLElement;
  private view: HTMLDivElement;
  private stage: HTMLDivElement;
  private sourceEl: HTMLPreElement;
  private zoomLabel: HTMLButtonElement;
  private tools: HTMLDivElement;
  private menu: HTMLDivElement;
  private styleMenu: HTMLDivElement;
  private scale = 1;
  private fitted = false; // 首次渲染后按容器宽度自适应一次
  private showSource = false;
  private rendered: Rendered = { type: "text" };

  constructor(
    private kind: DiagramKind,
    private code: string,
  ) {
    this.el = document.createElement("figure");
    this.el.className = "diagram-card";
    this.el.dataset.kind = kind;

    this.view = document.createElement("div");
    this.view.className = "diagram-view";
    this.stage = document.createElement("div");
    this.stage.className = "diagram-stage";
    this.view.appendChild(this.stage);

    this.sourceEl = document.createElement("pre");
    this.sourceEl.className = "diagram-source";
    this.sourceEl.hidden = true;
    const codeEl = document.createElement("code");
    codeEl.textContent = code;
    this.sourceEl.appendChild(codeEl);

    this.tools = document.createElement("div");
    this.tools.className = "diagram-tools";
    this.menu = document.createElement("div");
    this.menu.className = "diagram-menu";
    this.menu.hidden = true;
    this.styleMenu = document.createElement("div");
    this.styleMenu.className = "diagram-menu diagram-style-menu";
    this.styleMenu.hidden = true;
    this.zoomLabel = document.createElement("button");

    this.el.dataset.style = currentStyle(); // CSS 按风格铺卡片底色（霓虹 / 电路是深底）
    this.buildTools();
    this.el.append(this.view, this.sourceEl, this.tools, this.menu, this.styleMenu);
    this.enablePan();
    this.enableWheelZoom();
    // 点别处收起弹出菜单（只挂一次，refresh 重建工具条时不重复挂）
    document.addEventListener("click", () => {
      this.menu.hidden = true;
      this.styleMenu.hidden = true;
    });
    // 别的卡片上收/展工具条时跟着变（全局偏好）
    window.addEventListener(TOOLS_EVENT, () => this.applyToolsCollapsed());
  }

  private button(html: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "diagram-btn";
    b.innerHTML = html;
    b.title = title;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  private buildTools() {
    this.tools.innerHTML = "";
    const zoomOut = this.button(ICON.zoomOut, i18n("diagram.zoomOut"), () => this.zoomBy(1 / 1.2));
    zoomOut.classList.add("needs-canvas");
    this.zoomLabel = document.createElement("button");
    this.zoomLabel.type = "button";
    this.zoomLabel.className = "diagram-btn diagram-zoom needs-canvas";
    this.zoomLabel.title = i18n("diagram.fit");
    this.zoomLabel.addEventListener("click", (e) => {
      e.stopPropagation();
      this.fit(true);
    });
    const zoomIn = this.button(ICON.zoomIn, i18n("diagram.zoomIn"), () => this.zoomBy(1.2));
    zoomIn.classList.add("needs-canvas");

    const srcBtn = this.button(ICON.code, i18n("diagram.source"), () => {
      this.showSource = !this.showSource;
      srcBtn.innerHTML = this.showSource ? ICON.shape : ICON.code;
      srcBtn.title = this.showSource ? i18n("diagram.showDiagram") : i18n("diagram.source");
      srcBtn.classList.toggle("active", this.showSource);
      this.applyVisibility();
    });

    const copyBtn = this.button(ICON.copy, i18n("diagram.copy"), async () => {
      await navigator.clipboard.writeText(this.code);
      copyBtn.innerHTML = ICON.check;
      copyBtn.classList.add("copied");
      setTimeout(() => {
        copyBtn.innerHTML = ICON.copy;
        copyBtn.classList.remove("copied");
      }, 1200);
    });

    const exportBtn = this.button(ICON.download, i18n("diagram.export"), () => {
      this.styleMenu.hidden = true;
      this.menu.hidden = !this.menu.hidden;
    });
    exportBtn.classList.add("needs-canvas");
    // 没画成图的卡片（字符画回落 / 渲染出错）只留复制，缩放和导出无从谈起
    srcBtn.classList.add("needs-canvas");

    this.menu.innerHTML = "";
    for (const [label, fn] of [
      [i18n("diagram.exportSvg"), () => this.exportSvg()],
      [i18n("diagram.exportPng"), () => this.exportPng()],
    ] as Array<[string, () => void]>) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "diagram-menu-item";
      item.textContent = label;
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        this.menu.hidden = true;
        fn();
      });
      this.menu.appendChild(item);
    }

    // 绘制风格：五种，用弹出小菜单选（循环切换要点四下才能回到原处）。
    // 改的是全局偏好，选完所有图一起重画。
    const style = currentStyle();
    const styleBtn = this.button(STYLE_ICON[style], i18n(STYLE_LABEL[style]), () => {
      this.menu.hidden = true;
      this.styleMenu.hidden = !this.styleMenu.hidden;
    });
    styleBtn.classList.add("needs-canvas");

    this.styleMenu.innerHTML = "";
    for (const s of STYLES) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "diagram-menu-item diagram-style-item";
      item.innerHTML = `<span class="diagram-style-icon">${STYLE_ICON[s]}</span><span>${i18n(STYLE_LABEL[s])}</span>`;
      item.classList.toggle("is-current", s === style);
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        this.styleMenu.hidden = true;
        if (s === currentStyle()) return;
        setStyle(s);
        window.dispatchEvent(new Event(STYLE_EVENT));
      });
      this.styleMenu.appendChild(item);
    }

    // 彩色开关跟在风格后面：它和风格正交，五种风格都能开
    const colorful = document.createElement("button");
    colorful.type = "button";
    colorful.className = "diagram-menu-item diagram-style-item diagram-colorful";
    colorful.innerHTML = `<span class="diagram-style-icon">${ICON.palette}</span><span>${i18n("diagram.colorful")}</span><span class="diagram-check">${isColorful() ? "✓" : ""}</span>`;
    colorful.classList.toggle("is-current", isColorful());
    colorful.addEventListener("click", (e) => {
      e.stopPropagation();
      this.styleMenu.hidden = true;
      setColorful(!isColorful());
      window.dispatchEvent(new Event(COLORFUL_EVENT));
    });
    this.styleMenu.appendChild(colorful);

    // 收起把手放最左边：收起后整条工具条缩成它一个，图的右上角就腾出来了
    const collapseBtn = this.button(ICON.collapse, "", () => {
      setToolsCollapsed(!toolsCollapsed());
      window.dispatchEvent(new Event(TOOLS_EVENT));
    });
    collapseBtn.classList.add("diagram-collapse");

    this.tools.append(
      collapseBtn,
      zoomOut,
      this.zoomLabel,
      zoomIn,
      styleBtn,
      srcBtn,
      copyBtn,
      exportBtn,
    );
    this.applyToolsCollapsed();
  }

  private applyToolsCollapsed() {
    const collapsed = toolsCollapsed();
    this.tools.classList.toggle("is-collapsed", collapsed);
    if (collapsed) {
      // 收起时把弹出菜单一并合上
      this.menu.hidden = true;
      this.styleMenu.hidden = true;
    }
    const handle = this.tools.querySelector<HTMLButtonElement>(".diagram-collapse");
    if (!handle) return;
    handle.innerHTML = collapsed ? ICON.expand : ICON.collapse;
    handle.title = i18n(collapsed ? "diagram.expandTools" : "diagram.collapseTools");
  }

  // 指针位置 → 图坐标（画布左上角为原点，除掉缩放）
  private toGraphPoint(e: PointerEvent): Point | null {
    const canvas = this.stage.querySelector("canvas");
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / this.scale, y: (e.clientY - r.top) / this.scale };
  }

  // 按住节点＝拖节点改布局；按住空白＝拖动整张图平移
  private enablePan() {
    let mode: "none" | "pan" | "node" = "none";
    let sx = 0;
    let sy = 0;
    let l = 0;
    let tp = 0;
    let target: DiagramNode | null = null;
    let grabX = 0; // 抓取点相对节点左上角的偏移，拖动时不会「跳一下」
    let grabY = 0;

    // 悬停在节点上时给个可抓的手势
    this.view.addEventListener("pointermove", (e) => {
      if (mode !== "none" || this.showSource) return;
      if (this.rendered.type !== "graph") return;
      const p = this.toGraphPoint(e);
      this.view.classList.toggle("over-node", !!p && !!nodeAt(this.rendered.graph, p));
    });

    this.view.addEventListener("pointerdown", (e) => {
      if (this.showSource || e.button !== 0) return;
      if (this.rendered.type === "graph") {
        const p = this.toGraphPoint(e);
        const hit = p ? nodeAt(this.rendered.graph, p) : null;
        if (hit && p) {
          mode = "node";
          target = hit;
          grabX = p.x - hit.x;
          grabY = p.y - hit.y;
          try {
            this.view.setPointerCapture(e.pointerId);
          } catch {
            /* 捕获失败不影响拖动本身 */
          }
          this.view.classList.add("dragging-node");
          e.preventDefault();
          return;
        }
      }
      const canPan =
        this.view.scrollWidth > this.view.clientWidth + 1 ||
        this.view.scrollHeight > this.view.clientHeight + 1;
      if (!canPan) return;
      mode = "pan";
      sx = e.clientX;
      sy = e.clientY;
      l = this.view.scrollLeft;
      tp = this.view.scrollTop;
      try {
        this.view.setPointerCapture(e.pointerId);
      } catch {
        /* 捕获失败不影响拖动本身 */
      }
      this.view.classList.add("panning");
    });

    this.view.addEventListener("pointermove", (e) => {
      if (mode === "pan") {
        this.view.scrollLeft = l - (e.clientX - sx);
        this.view.scrollTop = tp - (e.clientY - sy);
        return;
      }
      if (mode !== "node" || !target || this.rendered.type !== "graph") return;
      const p = this.toGraphPoint(e);
      if (!p) return;
      target.x = p.x - grabX;
      target.y = p.y - grabY;
      clampNode(target);
      const theme = readTheme();
      rerouteEdgesOf(this.rendered.graph, target, theme);
      placeLabels(this.rendered.graph, theme); // 走线变了，边上的文字重新找不挡线的位置
      growCanvas(this.rendered.graph);
      this.rendered.width = this.rendered.graph.width;
      this.rendered.height = this.rendered.graph.height;
      this.paintCanvas();
    });

    const end = (e: PointerEvent) => {
      if (mode === "none") return;
      mode = "none";
      target = null;
      try {
        this.view.releasePointerCapture(e.pointerId);
      } catch {
        /* 已经释放过就算了 */
      }
      this.view.classList.remove("panning", "dragging-node");
    };
    this.view.addEventListener("pointerup", end);
    this.view.addEventListener("pointercancel", end);
  }

  // ⌘/Ctrl + 滚轮缩放
  private enableWheelZoom() {
    this.view.addEventListener(
      "wheel",
      (e) => {
        if (!(e.metaKey || e.ctrlKey) || this.showSource) return;
        e.preventDefault();
        this.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
      },
      { passive: false },
    );
  }

  private zoomBy(k: number) {
    this.setScale(this.scale * k);
  }

  private setScale(s: number) {
    this.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
    this.applyScale();
  }

  // 按容器宽度自适应（图比容器窄就 100%，不放大）
  private fit(force = false) {
    const size = this.baseSize();
    if (!size) return;
    const avail = this.view.clientWidth - 4;
    if (avail <= 0) return;
    const next = Math.min(1, avail / size.width);
    if (force || !this.fitted) {
      this.scale = Math.max(MIN_SCALE, next);
      this.fitted = true;
      this.applyScale();
    }
  }

  private baseSize(): { width: number; height: number } | null {
    if (this.rendered.type === "graph" || this.rendered.type === "svg") {
      return { width: this.rendered.width, height: this.rendered.height };
    }
    return null;
  }

  private applyScale() {
    const size = this.baseSize();
    this.zoomLabel.textContent = size ? `${Math.round(this.scale * 100)}%` : "—";
    if (!size) return;
    if (this.rendered.type === "svg") {
      this.rendered.el.setAttribute("width", String(size.width * this.scale));
      this.rendered.el.setAttribute("height", String(size.height * this.scale));
    } else if (this.rendered.type === "graph") {
      this.paintCanvas();
    }
  }

  // 自渲染的图每次缩放都重画，而不是拉伸位图——放大后线条依旧是实心的
  private paintCanvas() {
    if (this.rendered.type !== "graph") return;
    const { graph, width, height } = this.rendered;
    const canvas = this.stage.querySelector("canvas") as HTMLCanvasElement | null;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, Math.round(width * this.scale));
    const ch = Math.max(1, Math.round(height * this.scale));
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr * this.scale, 0, 0, dpr * this.scale, 0, 0);
    ctx.clearRect(0, 0, width, height);
    renderGraph(new CanvasSurface(ctx), graph, readTheme());
  }

  private applyVisibility() {
    this.view.hidden = this.showSource;
    this.sourceEl.hidden = !this.showSource;
  }

  // 渲染（首次进入文档、切主题、切语言都会走）
  async render() {
    const theme = readTheme();
    this.el.dataset.style = theme.style;
    this.stage.innerHTML = "";
    this.el.classList.remove("is-error", "is-text");
    try {
      // mermaid 的流程图 / 状态图走自研引擎（能拖、排版更松）；其余图种回落官方库
      const ownGraph =
        this.kind === "mermaid" ? parseMermaid(this.code) : null;

      if (this.kind === "mermaid" && !ownGraph) {
        const { svg, width, height } = await renderMermaid(this.code);
        this.stage.appendChild(svg);
        // 两步都得等进了 DOM 才能做：要靠 getComputedStyle 读出 mermaid 内嵌样式里的实际配色。
        // 先上色再手绘化——手绘那步会照着元素当前的颜色重画
        restyleMermaid(svg, theme);
        sketchifyMermaid(svg, theme);
        this.rendered = { type: "svg", el: svg, width, height };
      } else {
        const graph = ownGraph
          ? layoutGraph(ownGraph, theme)
          : this.kind === "flow"
            ? layoutGraph(parseFlow(this.code), theme)
            : parseAscii(this.code, theme);
        if (!graph || !graph.nodes.length) {
          this.renderTextArt();
        } else {
          const canvas = document.createElement("canvas");
          canvas.className = "diagram-canvas";
          this.stage.appendChild(canvas);
          this.rendered = { type: "graph", graph, width: graph.width, height: graph.height };
        }
      }
    } catch (err) {
      this.renderError(String(err));
    }
    this.applyVisibility();
    this.applyScale();
    // 容器宽度要等一帧才准
    requestAnimationFrame(() => this.fit());
  }

  // 结构没识别出来（纯字符画、示意图）：保留等宽原样排版，仍套同一张卡片
  private renderTextArt() {
    const pre = document.createElement("pre");
    pre.className = "diagram-textart";
    pre.textContent = this.code.replace(/\s+$/, "");
    this.stage.appendChild(pre);
    this.rendered = { type: "text" };
    this.el.classList.add("is-text");
  }

  private renderError(message: string) {
    const box = document.createElement("div");
    box.className = "diagram-error";
    box.textContent = i18n("diagram.error");
    const detail = document.createElement("pre");
    detail.className = "diagram-textart";
    detail.textContent = this.code.replace(/\s+$/, "");
    this.stage.append(box, detail);
    this.rendered = { type: "error", message };
    this.el.classList.add("is-error");
  }

  // 主题 / 语言变化后刷新：重建工具条文案并重画。
  // 自渲染的图不重新解析——否则用户拖过的节点位置会被打回原形；
  // 只按新配色重画。mermaid 是官方库生成的 SVG，颜色写死在里面，只能整张重出。
  refresh(full = false) {
    this.buildTools();
    if (!full && this.rendered.type === "graph") {
      this.applyScale();
      return;
    }
    this.render();
  }

  // ===== 导出 =====
  private toSvgText(): string | null {
    if (this.rendered.type === "svg") return new XMLSerializer().serializeToString(this.rendered.el);
    if (this.rendered.type === "graph") {
      const { graph, width, height } = this.rendered;
      const theme = readTheme();
      // 霓虹 / 电路是「深底上的发光」，导出成透明底就只剩一团看不清的亮线，得把底一起带上
      const surface = new SvgSurface(width, height, theme.bg);
      renderGraph(surface, graph, theme);
      return surface.serialize();
    }
    return null;
  }

  private async exportSvg() {
    const svg = this.toSvgText();
    if (!svg) return;
    const path = await save({
      defaultPath: `diagram.svg`,
      filters: [{ name: "SVG", extensions: ["svg"] }],
    });
    if (!path) return;
    await invoke("write_file", { path, content: svg });
  }

  private async exportPng() {
    const size = this.baseSize();
    if (!size) return;
    const path = await save({
      defaultPath: `diagram.png`,
      filters: [{ name: "PNG", extensions: ["png"] }],
    });
    if (!path) return;
    const dataUrl = await this.rasterize(size.width, size.height);
    if (!dataUrl) return;
    await invoke("write_file_base64", { path, data: dataUrl.split(",")[1] ?? "" });
  }

  // 位图导出统一按 2 倍分辨率，并铺上正文底色（否则深色模式导出是透明的）
  private async rasterize(width: number, height: number): Promise<string | null> {
    const k = 2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * k);
    canvas.height = Math.round(height * k);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const theme = readTheme();
    ctx.fillStyle = theme.bg !== "transparent" ? theme.bg : theme.labelBg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(k, 0, 0, k, 0, 0);

    if (this.rendered.type === "graph") {
      renderGraph(new CanvasSurface(ctx), this.rendered.graph, theme);
      return canvas.toDataURL("image/png");
    }
    const svgText = this.toSvgText();
    if (!svgText) return null;
    const bytes = new TextEncoder().encode(svgText);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); // 分块，避免超长图撑爆调用栈
    }
    const url = `data:image/svg+xml;base64,${btoa(bin)}`;
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("svg rasterize failed"));
      img.src = url;
    });
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL("image/png");
  }
}
