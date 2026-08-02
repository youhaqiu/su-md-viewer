// 给 mermaid 官方渲染的 SVG 上彩色。
//
// 自渲染的图（流程图 / 状态图 / flow / ASCII）在 render.ts 里按节点顺序发色相就行；
// mermaid 那几种回落图种（时序、甘特、类图、ER、饼图、旅程、思维导图）颜色是库自己生成的，
// 只能等它画完再改。分两条路：
//   * 饼图 / 旅程 / 思维导图 —— mermaid 有 pie1..12、cScale0..11 这类「成组色」变量，
//     直接在 themeVariables 里给一串色（见 theme.mermaidThemeVariables），不用碰 DOM；
//   * 时序 / 甘特 / 类图 / ER —— 没有按序号分色的变量，只能在这里按元素改。
//
// 颜色一律写成行内 style 且带 !important：mermaid 把配色写在 SVG 内嵌的 <style> 里，
// CSS 压得过 presentation attribute，光改 fill/stroke 属性是改不动的。

import { tintFor } from "./theme";
import type { NodeTint } from "./theme";
import type { DiagramTheme } from "./types";

const NONE = new Set(["none", "transparent", "rgba(0, 0, 0, 0)", ""]);
const isNone = (c: string | null | undefined) => !c || NONE.has(c.trim().toLowerCase());

const num = (el: Element, name: string, fallback = 0) => {
  const v = parseFloat(el.getAttribute(name) ?? "");
  return Number.isFinite(v) ? v : fallback;
};

function style(el: SVGElement, decls: string[]) {
  if (!decls.length) return;
  const prev = el.getAttribute("style") ?? "";
  el.setAttribute("style", `${prev};${decls.join(";")}`);
}

// 手绘风下这张 SVG 接着会被 sketchify-svg 重画，它拿元素当前的填充色当斜线的颜色，
// 所以这里要给它斜线该有的那个色（tint.fill 在手绘风里是灰底，涂上去等于没上色）
function fillOf(tint: NodeTint, t: DiagramTheme): string {
  return t.style === "sketch" ? tint.hachure : tint.fill;
}

// 只改元素本来就有的那一面：本来没填充的别给它填上（会糊掉文字和箭头）
function paintShape(el: SVGElement, tint: NodeTint, t: DiagramTheme) {
  const cs = getComputedStyle(el);
  const decls: string[] = [];
  if (!isNone(cs.fill)) decls.push(`fill:${fillOf(tint, t)} !important`);
  if (!isNone(cs.stroke)) decls.push(`stroke:${tint.stroke} !important`);
  style(el, decls);
}

function paintStroke(el: SVGElement, tint: NodeTint) {
  style(el, [`stroke:${tint.stroke} !important`]);
}

// ===== 时序图：每个参与者一个色（上下两个头 + 中间那条生命线是同一个人）=====
function colorSequence(svg: SVGSVGElement, t: DiagramTheme): boolean {
  const boxes = Array.from(svg.querySelectorAll<SVGElement>("rect.actor"));
  if (!boxes.length) return false;

  const centerOf = (el: SVGElement) => num(el, "x") + num(el, "width") / 2;
  // 参与者的列位置：上下两排方框 x 相同，去重后从左到右就是出场顺序
  const cols: number[] = [];
  for (const b of boxes) {
    const c = centerOf(b);
    if (!cols.some((x) => Math.abs(x - c) < 2)) cols.push(c);
  }
  cols.sort((a, b) => a - b);
  const slot = (c: number) => {
    let best = 0;
    for (let i = 1; i < cols.length; i++) {
      if (Math.abs(cols[i] - c) < Math.abs(cols[best] - c)) best = i;
    }
    return best;
  };

  for (const b of boxes) paintShape(b, tintFor(t, slot(centerOf(b))), t);
  for (const l of svg.querySelectorAll<SVGElement>("line.actor-line")) {
    paintStroke(l, tintFor(t, slot(num(l, "x1"))));
  }
  return true;
}

// ===== 甘特图：每个任务条一个色 =====
function colorGantt(svg: SVGSVGElement, t: DiagramTheme): boolean {
  const tasks = Array.from(svg.querySelectorAll<SVGElement>("rect.task"));
  if (!tasks.length) return false;
  tasks.forEach((r, i) => paintShape(r, tintFor(t, i), t));
  return true;
}

// ===== 类图 / ER：节点在 g.node 里，形状可能是 rect，也可能是一叠 path =====
// 直接子元素才是外框；g.label 底下那些 rect 是文字底衬，染了会盖住字。
const SHAPE_SEL = [
  ":scope > rect",
  ":scope > path",
  ":scope > polygon",
  ":scope > circle",
  ":scope > ellipse",
  ":scope > g.label-container > rect",
  ":scope > g.label-container > path",
  ":scope > g.label-container > polygon",
].join(",");

function colorNodes(svg: SVGSVGElement, t: DiagramTheme): boolean {
  const nodes = Array.from(svg.querySelectorAll<SVGGElement>("g.node"));
  if (!nodes.length) return false;
  nodes.forEach((g, i) => {
    const tint = tintFor(t, i);
    g.querySelectorAll<SVGElement>(SHAPE_SEL).forEach((el) => paintShape(el, tint, t));
    // 类图里分隔属性和方法的那两条横线
    g.querySelectorAll<SVGElement>("line.divider").forEach((el) => paintStroke(el, tint));
  });
  return true;
}

// ===== 思维导图的根节点 =====
// 分支的颜色走 cScale（已在 theme.scaleColors 里给全），但根节点不走：
// mermaid 把它的底色算成「background 提亮 42%」、文字直接写死 black。
// 我们给的 background 是透明色，于是根节点成了一个灰盘子 + 黑字，深底上尤其难看。
function colorMindmapRoot(svg: SVGSVGElement, t: DiagramTheme) {
  const root = svg.querySelector<SVGGElement>("g.mindmap-node.section-root");
  if (!root) return;
  const tint = tintFor(t, 0);
  const fill = t.colorful ? fillOf(tint, t) : t.accentSoft;
  const stroke = t.colorful ? tint.stroke : t.nodeStroke;
  root
    .querySelectorAll<SVGElement>("rect, circle, ellipse, polygon, path, .node-bkg")
    .forEach((el) => style(el, [`fill:${fill} !important`, `stroke:${stroke} !important`]));
  root
    .querySelectorAll<SVGElement>("text, tspan")
    .forEach((el) => style(el, [`fill:${t.nodeText} !important`]));
}

// 渲染完的 mermaid SVG 再过一遍：修它按我们的主题算歪的颜色，彩色模式下再按序号上色
export function restyleMermaid(svg: SVGSVGElement, t: DiagramTheme) {
  colorMindmapRoot(svg, t); // 这条不分彩色与否，是修 mermaid 的推色
  if (!t.colorful) return;
  // 剩下的按图种分：一张图只可能是一种，命中一个就不用再试别的
  colorSequence(svg, t) || colorGantt(svg, t) || colorNodes(svg, t);
}
