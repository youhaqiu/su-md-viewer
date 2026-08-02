// 图表配色：直接从 <html> 上的 CSS 变量读，于是深浅色切换、四套主题色切换
// 都不用在这里重复一遍色值——改 styles.css 即可，图跟着变。

import { STYLES } from "./types";
import type { DiagramStyle, DiagramTheme } from "./types";

// 把 rgb()/rgba() 或 #hex 解析成 [r,g,b]，解析不了返回 null
function toRgb(color: string): [number, number, number] | null {
  const c = color.trim();
  const m = /^rgba?\(([^)]+)\)$/i.exec(c);
  if (m) {
    const [r, g, b] = m[1].split(/[,\s/]+/).map((s) => parseFloat(s));
    if ([r, g, b].every((v) => Number.isFinite(v))) return [r, g, b];
    return null;
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split("").map((x) => x + x).join("");
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  return null;
}

// 把 rgb()/rgba() 或 #hex 转成带指定透明度的 rgba 字符串
function withAlpha(color: string, alpha: number): string {
  const rgb = toRgb(color);
  if (!rgb) return color;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

// 往白/黑方向拉：霓虹要更亮的主题色，玻璃要更淡的底
function mix(color: string, target: string, k: number): string {
  const a = toRgb(color);
  const b = toRgb(target);
  if (!a || !b) return color;
  const v = a.map((x, i) => Math.round(x + (b[i] - x) * k));
  return `rgb(${v[0]}, ${v[1]}, ${v[2]})`;
}

export function isDark(): boolean {
  return document.documentElement.getAttribute("data-theme") === "dark";
}

// 手写体：优先系统自带的手写字体，中文交给「翩翩体」(HanziPen SC)。
// 字体族是逐字回退的，所以拉丁字母走前面几个，汉字自然落到 HanziPen。
// 系统没有时退回普通无衬线，不会变成方框。
const HAND_FONT =
  '"Chalkboard SE", "Bradley Hand", "Comic Sans MS", "Segoe Print", ' +
  '"HanziPen SC", "Hanzipen SC", "翩翩体-简", "Yuanti SC", cursive, sans-serif';

export const STYLE_EVENT = "md-viewer-diagram-style"; // 切风格后广播，让所有图重画
export const STYLE_KEY = "diagram-style"; // localStorage：存风格名，认不出就回默认的手绘

export function currentStyle(): DiagramStyle {
  const v = localStorage.getItem(STYLE_KEY) as DiagramStyle | null;
  return v && STYLES.includes(v) ? v : "sketch";
}

export function setStyle(s: DiagramStyle) {
  localStorage.setItem(STYLE_KEY, s);
}

// 霓虹 / 电路自带深色底（见 styles.css 里按 data-style 铺的卡片底），
// 于是这两种风格的配色不跟随应用的深浅色，始终按深底来配。
export function isDarkStyle(s: DiagramStyle): boolean {
  return s === "neon" || s === "circuit";
}

const NEON_BG = "#0b0d14"; // 霓虹的底：接近黑的蓝，比纯黑更「屏幕感」
const CIRCUIT_BG = "#0a0f0d"; // 电路的底：偏绿的黑

// 彩色开关：和绘制风格正交，五种风格都能开。
// 单独一个事件（不复用 STYLE_EVENT）是因为换色不影响字体字号，
// 不必重新解析排版，用户拖过的节点位置能留住。
export const COLORFUL_EVENT = "md-viewer-diagram-colorful";
export const COLORFUL_KEY = "diagram-colorful";

export function isColorful(): boolean {
  return localStorage.getItem(COLORFUL_KEY) === "1";
}

export function setColorful(v: boolean) {
  localStorage.setItem(COLORFUL_KEY, v ? "1" : "0");
}

// 工具条收起状态：它浮在图的右上角，图大一点就会挡住内容，于是能收成一个小把手。
// 跟绘制风格一样是全局偏好——一篇文档里的图统一收统一展，不用一张张点。
export const TOOLS_EVENT = "md-viewer-diagram-tools";
export const TOOLS_KEY = "diagram-tools-collapsed";

export function toolsCollapsed(): boolean {
  return localStorage.getItem(TOOLS_KEY) === "1";
}

export function setToolsCollapsed(v: boolean) {
  localStorage.setItem(TOOLS_KEY, v ? "1" : "0");
}

// ===== 彩色调色板 =====
//
// 色相从当前主题色起步，按固定步长绕色轮走——于是「彩色」仍然是这套主题的彩色：
// 珊瑚橙的文档从橙起，靛蓝的文档从蓝起，第一个节点永远是主题色本身。
// 步长取 52°：相邻节点的色相拉得开（40° 在绿区两档看着还是像），转七个才绕回起点附近。
const HUE_STEP = 52;

// 一律算成 rgb() 输出：hsl 在浏览器里没问题，但导出的 SVG 可能被别的工具打开，
// 那边对 hsla 的支持没保证。h=0-360，s/l/a=0-1
function hsl(h: number, s: number, l: number, a = 1): string {
  const k = (n: number) => (n + h / 30) % 12;
  const f = (n: number) => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  const ch = (n: number) => Math.round(f(n) * 255);
  return a >= 1 ? `rgb(${ch(0)}, ${ch(8)}, ${ch(4)})` : `rgba(${ch(0)}, ${ch(8)}, ${ch(4)}, ${a})`;
}

function hueOf(color: string): number {
  const rgb = toRgb(color);
  if (!rgb) return 14;
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (!d) return 0;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

// 一个节点（及其出边）的整套颜色
export type NodeTint = {
  fill: string;
  fill2: string; // 玻璃风渐变的下端；其余风格与 fill 相同
  stroke: string;
  hachure: string; // 手绘风的斜线涂鸦色
  line: string;
  glow: string;
};

export function tintFor(t: DiagramTheme, i: number): NodeTint {
  const h = (hueOf(t.accent) + i * HUE_STEP) % 360;
  const dark = t.dark;
  switch (t.style) {
    case "neon":
      return {
        fill: hsl(h, 0.9, 0.6, 0.13),
        fill2: hsl(h, 0.9, 0.6, 0.13),
        stroke: hsl(h, 0.95, 0.66),
        hachure: hsl(h, 0.9, 0.6, 0.4),
        line: hsl(h, 0.95, 0.68, 0.9),
        glow: hsl(h, 1, 0.55),
      };
    case "glass":
      return {
        fill: dark ? hsl(h, 0.6, 0.58, 0.44) : hsl(h, 0.72, 0.97),
        fill2: dark ? hsl(h, 0.6, 0.5, 0.18) : hsl(h, 0.6, 0.87),
        stroke: dark ? hsl(h, 0.4, 0.7, 0.28) : hsl(h, 0.4, 0.55, 0.24),
        hachure: hsl(h, 0.6, 0.6, 0.35),
        line: hsl(h, 0.6, dark ? 0.68 : 0.5),
        glow: hsl(h, 0.6, 0.6),
      };
    case "circuit":
      return {
        fill: hsl(h, 0.8, 0.5, 0.08),
        fill2: hsl(h, 0.8, 0.5, 0.08),
        stroke: hsl(h, 0.85, 0.64),
        hachure: hsl(h, 0.8, 0.5, 0.35),
        line: hsl(h, 0.8, 0.62, 0.78),
        glow: hsl(h, 0.9, 0.55),
      };
    case "sketch":
      // 手绘的「彩笔」：线条实、涂鸦淡，和单色手绘是同一支笔的不同颜色
      return {
        fill: t.nodeFill,
        fill2: t.nodeFill,
        stroke: hsl(h, 0.55, dark ? 0.64 : 0.44),
        hachure: hsl(h, 0.7, dark ? 0.6 : 0.5, dark ? 0.55 : 0.42), // 与单色那档的浓度对齐
        line: hsl(h, 0.5, dark ? 0.62 : 0.46),
        glow: hsl(h, 0.7, 0.55),
      };
    default:
      return {
        fill: hsl(h, 0.6, dark ? 0.5 : 0.62, dark ? 0.18 : 0.14),
        fill2: hsl(h, 0.6, dark ? 0.5 : 0.62, dark ? 0.18 : 0.14),
        stroke: hsl(h, 0.5, dark ? 0.62 : 0.44),
        hachure: hsl(h, 0.6, 0.55, 0.35),
        line: hsl(h, 0.5, dark ? 0.6 : 0.46),
        glow: hsl(h, 0.7, 0.55),
      };
  }
}

// 把某个节点的颜色套进主题：绘制函数照旧只认 theme 上的那几个色位，
// 于是五种风格一行不用改就都支持了彩色
export function withTint(t: DiagramTheme, tint: NodeTint): DiagramTheme {
  return {
    ...t,
    nodeFill: tint.fill,
    nodeFill2: tint.fill2,
    nodeStroke: tint.stroke,
    sketchFill: tint.hachure,
    line: tint.line,
    accent: tint.stroke,
    glowColor: tint.glow,
  };
}

export function readTheme(): DiagramTheme {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) =>
    (cs.getPropertyValue(name) || "").trim() || fallback;

  const dark = isDark();
  const accent = v("--accent", "#ff5a36");
  const text = v("--text", dark ? "#d3d3d1" : "#36383b");
  const canvas = v("--canvas", dark ? "#1f2022" : "#fdfdfc");
  const soft = v("--soft-bg", dark ? "#292a2d" : "#f6f6f4");

  const style = currentStyle();
  const font = v("--ui-font", "-apple-system, system-ui, sans-serif").replace(/\s+/g, " ");
  const mono = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

  // 深色下主题色得先往亮里提一档：四套主题色都是照着白底挑的，明度本来就低，
  // 直接铺到近黑的卡片上跟底色只差一点点（靛紫的斜线只有 2.1:1），线和斜线全糊成
  // 一团深色。提亮到这一档后斜线约 4:1、线条约 8:1，四套主题色都站得住。
  const tone = dark ? mix(accent, "#ffffff", 0.46) : accent;

  // 手绘的笔迹里掺一点主题色：纯灰的铅笔线会把主题色只剩在斜线涂鸦上，整张图看着发白。
  // 掺三四成——还是「铅笔」，但一眼看得出是哪套主题色。
  const ink = style === "sketch" ? mix(text, tone, dark ? 0.42 : 0.36) : text;

  const base: DiagramTheme = {
    style,
    dark: dark || isDarkStyle(style),
    colorful: isColorful(),
    bg: "transparent",
    nodeFill: soft,
    nodeFill2: soft,
    // 手绘的斜线用主题色，一眼就有「彩笔涂过」的感觉；规整风格下用不到。
    // 斜线是疏的（见 sketch.ts 的 hachureGap），同样的 alpha 铺到面上比实心淡得多，
    // 所以这一档给得比其它色位重。
    sketchFill: withAlpha(tone, dark ? 0.68 : 0.46),
    // 手绘线条要更实一些才有笔触感
    nodeStroke: withAlpha(ink, style === "sketch" ? (dark ? 0.9 : 0.74) : dark ? 0.34 : 0.26),
    // 深色下节点上的字要比正文再亮一档：它压在斜线涂鸦上，用正文那档灰会被涂鸦吃掉
    nodeText: dark ? mix(text, "#ffffff", 0.3) : text,
    accent,
    accentSoft: withAlpha(tone, dark ? 0.24 : 0.16),
    line: withAlpha(
      style === "sketch" ? mix(text, tone, dark ? 0.26 : 0.22) : text,
      style === "sketch" ? (dark ? 0.8 : 0.66) : dark ? 0.5 : 0.45,
    ),
    labelText: v("--muted-text", dark ? "#a3a4a8" : "#74767b"),
    labelBg: canvas,
    glowColor: accent,
    glow: 0,
    shadow: 0,
    shadowColor: "transparent",
    font,
    handFont: HAND_FONT,
    monoFont: mono,
    fontSize: style === "sketch" ? 14 : 13,
  };
  // 卡片外框用的 --border 由 CSS 直接消费，不进绘制层

  // 霓虹：深底 + 主题色描边发光。亮色调提到接近纯色，暗处压到接近黑，
  // 对比度拉满才有「灯管」的感觉。
  if (style === "neon") {
    const hot = mix(accent, "#ffffff", 0.22); // 灯管本体比主题色更亮一档
    return {
      ...base,
      bg: NEON_BG,
      nodeFill: withAlpha(accent, 0.12),
      nodeFill2: withAlpha(accent, 0.12),
      nodeStroke: hot,
      nodeText: "#eef3ff",
      line: withAlpha(hot, 0.85),
      labelText: mix(accent, "#ffffff", 0.55),
      labelBg: NEON_BG,
      accentSoft: withAlpha(accent, 0.22),
      glowColor: accent,
      glow: 13,
      fontSize: 13,
    };
  }

  // 玻璃：渐变填充 + 柔和投影，不描硬边。深浅色都成立，所以跟着应用主题走。
  if (style === "glass") {
    return {
      ...base,
      nodeFill: dark ? mix(soft, "#ffffff", 0.1) : "#ffffff",
      nodeFill2: dark ? withAlpha(accent, 0.2) : mix(accent, "#ffffff", 0.86),
      nodeStroke: withAlpha(text, dark ? 0.18 : 0.1),
      nodeText: text,
      line: withAlpha(accent, dark ? 0.78 : 0.62),
      labelText: text,
      labelBg: dark ? mix(soft, "#ffffff", 0.08) : "#ffffff",
      shadow: dark ? 14 : 12,
      shadowColor: dark ? "rgba(0, 0, 0, 0.55)" : withAlpha(text, 0.18),
      fontSize: 13,
    };
  }

  // 电路：切角方框 + 等宽字，线是细亮的，底是偏绿的黑
  if (style === "circuit") {
    const wire = mix(accent, "#ffffff", 0.3);
    return {
      ...base,
      bg: CIRCUIT_BG,
      nodeFill: "rgba(255, 255, 255, 0.035)",
      nodeFill2: "rgba(255, 255, 255, 0.035)",
      nodeStroke: withAlpha(wire, 0.85),
      nodeText: "#dce7e2",
      line: withAlpha(wire, 0.7),
      labelText: wire,
      labelBg: CIRCUIT_BG,
      accentSoft: withAlpha(accent, 0.2),
      glowColor: accent,
      glow: 5, // 只留一点点辉光，主要靠线本身够细够亮
      font: mono,
      fontSize: 12.5,
    };
  }

  return base;
}

// mermaid 的 themeVariables：把上面的令牌翻译成 mermaid 的命名，
// 让官方渲染的图与自渲染的图观感一致。
export function mermaidThemeVariables(t: DiagramTheme) {
  // 霓虹 / 电路自带深底，mermaid 也得按深色模式配，否则它的默认文字色是黑的
  const dark = isDark() || isDarkStyle(t.style);
  // 手绘风下节点底色用主题色淡染，贴近自渲染那边斜线涂鸦的观感；
  // 玻璃风取渐变的深端，单色也不至于太素
  const fill =
    t.style === "sketch" ? t.accentSoft : t.style === "glass" ? t.nodeFill2 : t.nodeFill;
  const stroke = t.nodeStroke;
  return {
    darkMode: dark,
    background: "transparent",
    fontFamily: t.style === "sketch" ? t.handFont : t.font,
    fontSize: `${t.fontSize}px`,
    primaryColor: fill,
    primaryTextColor: t.nodeText,
    primaryBorderColor: stroke,
    secondaryColor: t.accentSoft,
    secondaryTextColor: t.nodeText,
    secondaryBorderColor: stroke,
    tertiaryColor: t.labelBg,
    tertiaryTextColor: t.nodeText,
    tertiaryBorderColor: stroke,
    lineColor: t.line,
    textColor: t.nodeText,
    mainBkg: fill,
    nodeBorder: stroke,
    clusterBkg: t.accentSoft,
    clusterBorder: stroke,
    edgeLabelBackground: t.labelBg,
    titleColor: t.nodeText,
    noteBkgColor: t.accentSoft,
    noteTextColor: t.nodeText,
    noteBorderColor: stroke,
    actorBkg: fill,
    actorBorder: stroke,
    actorTextColor: t.nodeText,
    signalColor: t.line,
    signalTextColor: t.nodeText,
    labelBoxBkgColor: fill,
    labelBoxBorderColor: stroke,
    labelTextColor: t.nodeText,
    loopTextColor: t.nodeText,
    activationBkgColor: t.accentSoft,
    sequenceNumberColor: t.labelBg,
    altBackground: t.labelBg,
    // 甘特 / 饼图等用到的成组色：以主题色为基调错开明度
    pie1: t.accent,
    pie2: withAlpha(t.accent, 0.7),
    pie3: withAlpha(t.accent, 0.5),
    pie4: withAlpha(t.accent, 0.35),
    pieTitleTextColor: t.nodeText,
    // 扇区上的百分比：深底时扇区本身也是深的（成组色是从底色往主题色调的），得用浅字
    pieSectionTextColor: dark ? "#f2f5fa" : "#26272a",
    pieStrokeColor: stroke,
    pieOuterStrokeColor: stroke,
    // 成组色（思维导图的分支、旅程的分段、饼图的扇区…）。
    // 这些色 mermaid 默认是从 background 推的，而我们给的 background 是 transparent，
    // 它算出来的是 hsl(..., 0%) ——纯黑：连线成了黑棒子、节点成了黑块。
    // 所以不管彩不彩色都得把这一串显式给出来。
    ...scaleColors(t),
  };
}

// pie1..12 / cScale0..11 / cScaleLabel0..11。
// 彩色时和自渲染那边同一套色相，一篇文档里「我们画的图」和「mermaid 画的图」接得上；
// 单色时按「越深的层次越淡」铺一遍主题色，观感和其余图种一致。
function scaleColors(t: DiagramTheme): Record<string, string> {
  const out: Record<string, string> = {};
  const label = t.colorful ? (t.dark ? "#eef3ff" : "#26272a") : t.nodeText;
  for (let i = 0; i < 12; i++) {
    // 饼图 / 旅程的色块是整块实心的，得用不透明的色，半透明的在深底上会发灰
    const solid = t.colorful ? tintFor(t, i).stroke : mix(t.accent, t.labelBg, 0.12 + (i % 5) * 0.16);
    const soft = t.colorful ? tintFor(t, i).line : withAlpha(solid, 0.85);
    out[`pie${i + 1}`] = solid;
    out[`cScale${i}`] = solid;
    out[`cScaleInv${i}`] = label;
    out[`cScaleLabel${i}`] = label;
    out[`cScalePeer${i}`] = soft;
  }
  return out;
}
