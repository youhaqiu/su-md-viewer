// 把排版好的 IR 画出来。只依赖 Surface 的几个图元，因此屏幕（Canvas）与导出（SVG）
// 走的是同一份绘制逻辑，两边不会画歪。
//
// 五种风格共用这一份代码：
//   sketch  手绘：roughjs 的手抖路径
//   clean   规整：一笔一画的几何图元
//   neon    霓虹：同样的几何，但描边发光——宽而虚的光晕 + 细而亮的芯
//   glass   玻璃：渐变填充 + 柔和投影，连线拐角是圆的
//   circuit 电路：切角方框 + 角标 + 细亮走线
// 形状几何只写一份（nodeShapePath / drawGeomShape），各风格只换画笔参数。

import { labelFont, nodeFont } from "./layout";
import {
  sketchArrow,
  sketchEllipse,
  sketchLine,
  sketchPolygon,
  sketchRect,
  sketchRoundRect,
} from "./sketch";
import type { StrokeOpts, Surface } from "./surface";
import { tintFor, withTint } from "./theme";
import type { DiagramEdge, DiagramGraph, DiagramNode, DiagramTheme, Point } from "./types";

const LINE_H = 18;
const ARROW = 8; // 规整风格的箭头长度
const LABEL_PAD_X = 7; // 边上文字左右各留这么多底衬，别让线贴着字边
const CHAMFER = 7; // 电路风的切角边长
const CORNER_MARK = 7; // 电路风节点四角的 L 形角标长度

function nodeShapePath(n: DiagramNode): Point[] | null {
  const { x, y, w, h } = n;
  switch (n.shape) {
    case "diamond":
      return [
        { x: x + w / 2, y },
        { x: x + w, y: y + h / 2 },
        { x: x + w / 2, y: y + h },
        { x, y: y + h / 2 },
      ];
    case "parallelogram": {
      const s = Math.min(18, w / 4);
      return [
        { x: x + s, y },
        { x: x + w, y },
        { x: x + w - s, y: y + h },
        { x, y: y + h },
      ];
    }
    case "trapezoid": {
      const s = Math.min(20, w / 4);
      return [
        { x: x + s, y },
        { x: x + w - s, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ];
    }
    case "hexagon": {
      const s = Math.min(16, w / 5);
      return [
        { x: x + s, y },
        { x: x + w - s, y },
        { x: x + w, y: y + h / 2 },
        { x: x + w - s, y: y + h },
        { x: x + s, y: y + h },
        { x, y: y + h / 2 },
      ];
    }
    default:
      return null;
  }
}

// 电路风的切角矩形：四角各斜切一刀，像电路板上的元件轮廓
function chamferPath(n: DiagramNode): Point[] {
  const { x, y, w, h } = n;
  const c = Math.min(CHAMFER, w / 4, h / 4);
  return [
    { x: x + c, y },
    { x: x + w - c, y },
    { x: x + w, y: y + c },
    { x: x + w, y: y + h - c },
    { x: x + w - c, y: y + h },
    { x: x + c, y: y + h },
    { x, y: y + h - c },
    { x, y: y + c },
  ];
}

// ===== 手绘风的节点外形 =====
function drawSketchShape(s: Surface, n: DiagramNode, t: DiagramTheme) {
  const poly = nodeShapePath(n);
  if (poly) {
    sketchPolygon(s, poly, t, n.id);
    return;
  }
  switch (n.shape) {
    case "ellipse":
      sketchEllipse(s, n.x + n.w / 2, n.y + n.h / 2, n.w, n.h, t, n.id);
      break;
    case "stadium":
      sketchRoundRect(s, n.x, n.y, n.w, n.h, n.h / 2, t, n.id);
      break;
    case "round":
      sketchRoundRect(s, n.x, n.y, n.w, n.h, 10, t, n.id);
      break;
    case "cylinder": {
      const ry = Math.min(9, n.h / 5);
      sketchRect(s, n.x, n.y + ry, n.w, n.h - ry * 2, t, n.id);
      sketchEllipse(s, n.x + n.w / 2, n.y + ry, n.w, ry * 2, t, n.id + "@top", false);
      break;
    }
    case "subroutine":
      sketchRect(s, n.x, n.y, n.w, n.h, t, n.id);
      for (const dx of [10, n.w - 10]) {
        sketchLine(
          s,
          [
            { x: n.x + dx, y: n.y },
            { x: n.x + dx, y: n.y + n.h },
          ],
          t,
          `${n.id}@bar${dx}`,
        );
      }
      break;
    default:
      // 手画的方框总是带点圆角
      sketchRoundRect(s, n.x, n.y, n.w, n.h, 6, t, n.id);
  }
}

// 圆角半径：玻璃风更圆更「软」，霓虹次之，电路是直角（另走切角）
function cornerRadius(n: DiagramNode, t: DiagramTheme): number {
  if (n.shape === "stadium") return n.h / 2;
  if (t.style === "glass") return n.shape === "round" ? 16 : 12;
  if (t.style === "neon") return n.shape === "round" ? 12 : 9;
  return n.shape === "round" ? 8 : 4;
}

// ===== 规整几何：clean / neon / glass / circuit 共用，只换画笔 =====
function drawGeomShape(s: Surface, n: DiagramNode, t: DiagramTheme, o: StrokeOpts) {
  const poly = nodeShapePath(n);
  if (poly) {
    s.polygon(poly, o);
    return;
  }
  const stroke: StrokeOpts = { stroke: o.stroke, lineWidth: o.lineWidth, glow: o.glow, glowColor: o.glowColor };
  switch (n.shape) {
    case "ellipse":
      s.ellipse(n.x + n.w / 2, n.y + n.h / 2, n.w / 2, n.h / 2, o);
      break;
    case "cylinder": {
      const ry = Math.min(9, n.h / 5);
      s.roundRect(n.x, n.y + ry, n.w, n.h - ry * 2, 2, o);
      s.ellipse(n.x + n.w / 2, n.y + ry, n.w / 2, ry, o);
      s.path(
        [
          { x: n.x, y: n.y + ry },
          { x: n.x, y: n.y + n.h - ry },
        ],
        stroke,
      );
      break;
    }
    case "subroutine":
      s.roundRect(n.x, n.y, n.w, n.h, 4, o);
      for (const dx of [10, n.w - 10]) {
        s.path(
          [
            { x: n.x + dx, y: n.y },
            { x: n.x + dx, y: n.y + n.h },
          ],
          stroke,
        );
      }
      break;
    default:
      // 电路风把方框切角，但胶囊（起止节点）保持圆头——否则一张图上所有节点长得一样
      if (t.style === "circuit" && n.shape !== "stadium") s.polygon(chamferPath(n), o);
      else s.roundRect(n.x, n.y, n.w, n.h, cornerRadius(n, t), o);
  }
}

// 电路风的四角 L 形角标：贴着包围盒画，像元件的定位标记。
// 只给方方正正的形状加——菱形 / 椭圆的包围盒离轮廓很远，角标会飘在空处。
const CORNER_MARK_SHAPES = new Set(["rect", "subroutine", "parallelogram", "trapezoid", "cylinder"]);

function drawCornerMarks(s: Surface, n: DiagramNode, t: DiagramTheme) {
  if (!CORNER_MARK_SHAPES.has(n.shape)) return;
  const m = Math.min(CORNER_MARK, n.w / 4, n.h / 4);
  const o: StrokeOpts = { stroke: t.accent, lineWidth: 1.6, glow: t.glow, glowColor: t.glowColor };
  const { x, y, w, h } = n;
  const pad = 3;
  const corners: Array<[Point, Point, Point]> = [
    [{ x: x - pad + m, y: y - pad }, { x: x - pad, y: y - pad }, { x: x - pad, y: y - pad + m }],
    [{ x: x + w + pad - m, y: y - pad }, { x: x + w + pad, y: y - pad }, { x: x + w + pad, y: y - pad + m }],
    [
      { x: x + w + pad - m, y: y + h + pad },
      { x: x + w + pad, y: y + h + pad },
      { x: x + w + pad, y: y + h + pad - m },
    ],
    [{ x: x - pad + m, y: y + h + pad }, { x: x - pad, y: y + h + pad }, { x: x - pad, y: y + h + pad - m }],
  ];
  for (const c of corners) s.path(c, o);
}

// 节点填充 / 描边的画笔参数：每种风格在这里分岔，几何一律走 drawGeomShape
function paintNode(s: Surface, n: DiagramNode, t: DiagramTheme) {
  switch (t.style) {
    case "neon":
      // 两趟：先宽而虚的光晕，再细而亮的芯——灯管就是这么亮起来的
      drawGeomShape(s, n, t, {
        fill: t.nodeFill,
        stroke: t.nodeStroke,
        lineWidth: 2.6,
        glow: t.glow,
        glowColor: t.glowColor,
      });
      drawGeomShape(s, n, t, { stroke: t.nodeStroke, lineWidth: 1 });
      break;
    case "glass":
      drawGeomShape(s, n, t, {
        gradient: { from: t.nodeFill, to: t.nodeFill2, y0: n.y, y1: n.y + n.h },
        stroke: t.nodeStroke,
        lineWidth: 1,
        shadow: { blur: t.shadow, dy: 3, color: t.shadowColor },
      });
      break;
    case "circuit":
      drawGeomShape(s, n, t, {
        fill: t.nodeFill,
        stroke: t.nodeStroke,
        lineWidth: 1.2,
        glow: t.glow,
        glowColor: t.glowColor,
      });
      drawCornerMarks(s, n, t);
      break;
    default:
      drawGeomShape(s, n, t, { fill: t.nodeFill, stroke: t.nodeStroke, lineWidth: 1.3 });
  }
}

function drawNode(s: Surface, n: DiagramNode, t: DiagramTheme, dimmed = false) {
  if (n.dummy) return;
  if (n.shape !== "text") {
    if (t.style === "sketch") drawSketchShape(s, n, t);
    else paintNode(s, n, t);
  }

  const lines = n.lines ?? n.text.split("\n");
  const font = nodeFont(t);
  const cx = n.x + n.w / 2;
  const startY = n.y + n.h / 2 - ((lines.length - 1) * LINE_H) / 2;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]) continue;
    s.text(lines[i], cx, startY + i * LINE_H, {
      font,
      color: dimmed ? t.labelText : t.nodeText,
      // 霓虹的字也微微发光，才像和方框同一块屏上的东西
      glow: t.style === "neon" ? 6 : 0,
      glowColor: t.glowColor,
    });
  }
}

// 规整风的实心三角箭头（neon / glass / circuit 也用它，只换颜色和发光）
function drawCleanArrow(s: Surface, from: Point, to: Point, t: DiagramTheme, o: StrokeOpts) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const size = t.style === "circuit" ? ARROW + 1 : ARROW;
  const base = { x: to.x - ux * size, y: to.y - uy * size };
  s.polygon(
    [
      to,
      { x: base.x + px * size * 0.42, y: base.y + py * size * 0.42 },
      { x: base.x - px * size * 0.42, y: base.y - py * size * 0.42 },
    ],
    o,
  );
}

// 折线转成圆角路径（玻璃风）：每个拐点用二次贝塞尔抹一下，线就「软」了
function roundedPathD(pts: Point[], r: number): string {
  if (pts.length < 3) return pts.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");
  const d: string[] = [`M${pts[0].x} ${pts[0].y}`];
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const next = pts[i + 1];
    const d1 = Math.hypot(cur.x - prev.x, cur.y - prev.y) || 1;
    const d2 = Math.hypot(next.x - cur.x, next.y - cur.y) || 1;
    const k1 = Math.min(r, d1 / 2) / d1;
    const k2 = Math.min(r, d2 / 2) / d2;
    const a = { x: cur.x + (prev.x - cur.x) * k1, y: cur.y + (prev.y - cur.y) * k1 };
    const b = { x: cur.x + (next.x - cur.x) * k2, y: cur.y + (next.y - cur.y) * k2 };
    d.push(`L${a.x} ${a.y}`, `Q${cur.x} ${cur.y} ${b.x} ${b.y}`);
  }
  const last = pts[pts.length - 1];
  d.push(`L${last.x} ${last.y}`);
  return d.join(" ");
}

function drawEdge(s: Surface, e: DiagramEdge, t: DiagramTheme) {
  const pts = e.points;
  if (pts.length < 2) return;
  const sketch = t.style === "sketch";

  // 线画到箭头根部为止，避免线头戳出箭头
  const draw = pts.slice();
  if (e.arrow === "end" || e.arrow === "both") {
    const a = draw[draw.length - 2];
    const b = draw[draw.length - 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const k = Math.max(0, (len - (sketch ? 7 : ARROW - 1)) / len);
    draw[draw.length - 1] = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  }

  const dash = e.dashed ? [5, 4] : undefined;
  let arrowOpts: StrokeOpts = { fill: t.line, stroke: t.line, lineWidth: 1 };

  switch (t.style) {
    case "sketch":
      sketchLine(s, draw, t, e.id, e.dashed);
      break;
    case "neon":
      // 和节点一样：一趟光晕一趟芯
      s.path(draw, { stroke: t.line, lineWidth: 3, dash, glow: t.glow - 2, glowColor: t.glowColor });
      s.path(draw, { stroke: t.line, lineWidth: 1.1, dash });
      arrowOpts = { fill: t.line, stroke: t.line, lineWidth: 1, glow: t.glow - 2, glowColor: t.glowColor };
      break;
    case "glass":
      s.rawPath(roundedPathD(draw, 12), { stroke: t.line, lineWidth: 1.8, dash });
      arrowOpts = { fill: t.line, stroke: t.line, lineWidth: 1 };
      break;
    case "circuit": {
      s.path(draw, { stroke: t.line, lineWidth: 1.2, dash: e.dashed ? [6, 4] : undefined });
      // 出发点打一个小方块，像焊盘
      const p0 = pts[0];
      s.polygon(
        [
          { x: p0.x - 2.5, y: p0.y - 2.5 },
          { x: p0.x + 2.5, y: p0.y - 2.5 },
          { x: p0.x + 2.5, y: p0.y + 2.5 },
          { x: p0.x - 2.5, y: p0.y + 2.5 },
        ],
        { fill: t.line, stroke: t.line, lineWidth: 0.8 },
      );
      arrowOpts = { fill: t.line, stroke: t.line, lineWidth: 1, glow: t.glow, glowColor: t.glowColor };
      break;
    }
    default:
      s.path(draw, { stroke: t.line, lineWidth: 1.4, dash });
  }

  if (e.arrow === "end" || e.arrow === "both") {
    if (sketch) sketchArrow(s, pts[pts.length - 2], pts[pts.length - 1], t, e.id);
    else drawCleanArrow(s, pts[pts.length - 2], pts[pts.length - 1], t, arrowOpts);
  }
  if (e.arrow === "both") {
    if (sketch) sketchArrow(s, pts[1], pts[0], t, e.id + "@back");
    else drawCleanArrow(s, pts[1], pts[0], t, arrowOpts);
  }
}

// 边上的文字。单独一趟画（见 renderGraph）：只要还有别的线在后面画，
// 底衬就会被压掉，文字混进线里根本认不出来。
function drawEdgeLabel(s: Surface, e: DiagramEdge, t: DiagramTheme) {
  if (!e.label || !e.labelAt) return;
  const font = labelFont(t);
  const w = s.measure(e.label, font) + LABEL_PAD_X * 2;
  const h = t.fontSize + 9;
  const x = e.labelAt.x - w / 2;
  const y = e.labelAt.y - h / 2;

  // 底衬用正文底色，看上去就是「线让开一段给文字」；手抖的底衬会显得脏，所以一律规整
  switch (t.style) {
    case "neon":
      s.roundRect(x, y, w, h, 5, {
        fill: t.labelBg,
        stroke: t.accentSoft,
        lineWidth: 1,
      });
      break;
    case "glass":
      s.roundRect(x, y, w, h, h / 2, {
        fill: t.labelBg,
        stroke: t.nodeStroke,
        lineWidth: 1,
        shadow: { blur: t.shadow * 0.6, dy: 2, color: t.shadowColor },
      });
      break;
    case "circuit":
      // 直角小牌子，和切角方框是一路的
      s.roundRect(x, y, w, h, 0, { fill: t.labelBg, stroke: t.line, lineWidth: 0.9 });
      break;
    default:
      s.roundRect(x, y, w, h, 5, { fill: t.labelBg });
  }

  s.text(e.label, e.labelAt.x, e.labelAt.y, {
    font,
    color: t.labelText,
    glow: t.style === "neon" ? 5 : 0,
    glowColor: t.glowColor,
  });
}

// 彩色模式：按节点在图里的先后顺序发色相，连线跟着它的起点走。
// 拿到的是「换了色位的主题」，所以上面五种风格的绘制代码一行都不用改。
function tintTable(g: DiagramGraph, t: DiagramTheme): Map<string, DiagramTheme> {
  const out = new Map<string, DiagramTheme>();
  if (!t.colorful) return out;
  let i = 0;
  for (const n of g.nodes) {
    if (n.dummy || n.shape === "text") continue; // 虚节点和散落文字不占色位，否则颜色会跳号
    out.set(n.id, withTint(t, tintFor(t, i++)));
  }
  return out;
}

// 分三趟：先所有连线，再所有节点，最后所有边上文字。
// 顺序不能合并——同一对节点间的往返边、以及穿过标签的过路线，
// 都会把先画好的标签底衬盖掉，文字就跟线糊在一起了。
export function renderGraph(s: Surface, g: DiagramGraph, t: DiagramTheme) {
  const tints = tintTable(g, t);
  for (const e of g.edges) drawEdge(s, e, tints.get(e.from) ?? t);
  for (const n of g.nodes) drawNode(s, n, tints.get(n.id) ?? t, n.shape === "text");
  // 标签一律用原主题：底衬是正文底色、文字是次要色，跟着线变色反而看不清
  for (const e of g.edges) drawEdgeLabel(s, e, t);
}
