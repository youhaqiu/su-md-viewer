// 手绘草图风的图元：线条带抖动、填色是斜线涂鸦，观感接近纸上随手画的流程图。
//
// 用 roughjs 的 generator（而不是它的 canvas / svg 封装）：generator 只产出路径数据，
// 我们再把同一份 d 分别交给 Canvas 的 Path2D 和 SVG 的 <path>，屏幕和导出的图才会
// 一模一样，不会一个抖成这样、另一个抖成那样。
//
// 抖动是伪随机的，seed 固定就永远画成同一个样子。这里把 seed 绑到节点/边的 id 上，
// 于是缩放、重绘、拖动节点时形状保持稳定，不会每帧「重新抖一次」。

import { RoughGenerator } from "roughjs/bin/generator";
import type { Options } from "roughjs/bin/core";
import type { Surface } from "./surface";
import type { DiagramTheme, Point } from "./types";

const gen = new RoughGenerator();

// 字符串 → 稳定的正整数种子
export function seedOf(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 2147483647;
}

// 描边基调：roughness 越大越潦草；bowing 是直线的「弯度」
function strokeOpts(theme: DiagramTheme, seed: number, extra?: Options): Options {
  return {
    seed,
    roughness: 1.1,
    bowing: 1.4,
    stroke: theme.nodeStroke,
    strokeWidth: 1.5,
    disableMultiStroke: false,
    ...extra,
  };
}

// 把 roughjs 的绘制结果吐到画笔上
function emit(s: Surface, drawable: ReturnType<RoughGenerator["rectangle"]>) {
  for (const info of gen.toPaths(drawable)) {
    s.rawPath(info.d, {
      stroke: info.stroke === "none" ? undefined : info.stroke,
      fill: info.fill === "none" ? undefined : info.fill,
      lineWidth: info.strokeWidth,
    });
  }
}

// 节点底色：斜线涂鸦（hachure）比实心更像手画的，但太密会糊。
// 疏密与笔画粗细直接决定这块颜色看着有多浓——太疏就只剩一层白纱。
function fillOpts(theme: DiagramTheme, seed: number): Options {
  return {
    fill: theme.sketchFill,
    fillStyle: "hachure",
    fillWeight: 1.05,
    hachureAngle: -41,
    hachureGap: 8.5,
    seed,
  };
}

export function sketchRect(
  s: Surface,
  x: number,
  y: number,
  w: number,
  h: number,
  theme: DiagramTheme,
  key: string,
  filled = true,
) {
  const seed = seedOf(key);
  const o = strokeOpts(theme, seed, filled ? fillOpts(theme, seed) : undefined);
  emit(s, gen.rectangle(x, y, w, h, o));
}

export function sketchPolygon(
  s: Surface,
  pts: Point[],
  theme: DiagramTheme,
  key: string,
  filled = true,
) {
  const seed = seedOf(key);
  const o = strokeOpts(theme, seed, filled ? fillOpts(theme, seed) : undefined);
  emit(s, gen.polygon(pts.map((p) => [p.x, p.y] as [number, number]), o));
}

export function sketchEllipse(
  s: Surface,
  cx: number,
  cy: number,
  w: number,
  h: number,
  theme: DiagramTheme,
  key: string,
  filled = true,
) {
  const seed = seedOf(key);
  const o = strokeOpts(theme, seed, filled ? fillOpts(theme, seed) : undefined);
  emit(s, gen.ellipse(cx, cy, w, h, o));
}

// 圆角矩形：roughjs 没有现成的，用 path 拼一个（手绘风下圆角本来就该是随手一勾）
export function sketchRoundRect(
  s: Surface,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  theme: DiagramTheme,
  key: string,
  filled = true,
) {
  const seed = seedOf(key);
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  const d =
    `M${x + rr} ${y} L${x + w - rr} ${y} Q${x + w} ${y} ${x + w} ${y + rr} ` +
    `L${x + w} ${y + h - rr} Q${x + w} ${y + h} ${x + w - rr} ${y + h} ` +
    `L${x + rr} ${y + h} Q${x} ${y + h} ${x} ${y + h - rr} ` +
    `L${x} ${y + rr} Q${x} ${y} ${x + rr} ${y} Z`;
  const o = strokeOpts(theme, seed, filled ? fillOpts(theme, seed) : undefined);
  emit(s, gen.path(d, o));
}

// 连线：折线走 linearPath，保留正交走向但线条带手抖
export function sketchLine(
  s: Surface,
  pts: Point[],
  theme: DiagramTheme,
  key: string,
  dashed = false,
) {
  if (pts.length < 2) return;
  const seed = seedOf(key);
  emit(
    s,
    gen.linearPath(
      pts.map((p) => [p.x, p.y] as [number, number]),
      strokeOpts(theme, seed, {
        stroke: theme.line,
        strokeWidth: 1.6,
        roughness: 0.9,
        bowing: 1.1,
        strokeLineDash: dashed ? [7, 5] : undefined,
      }),
    ),
  );
}

// 箭头：手绘风下不填实心三角，而是随手勾两笔
export function sketchArrow(s: Surface, from: Point, to: Point, theme: DiagramTheme, key: string) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const size = 11;
  const spread = 0.42;
  const wingA: Point = {
    x: to.x - (ux * Math.cos(spread) - uy * Math.sin(spread)) * size,
    y: to.y - (uy * Math.cos(spread) + ux * Math.sin(spread)) * size,
  };
  const wingB: Point = {
    x: to.x - (ux * Math.cos(-spread) - uy * Math.sin(-spread)) * size,
    y: to.y - (uy * Math.cos(-spread) + ux * Math.sin(-spread)) * size,
  };
  const seed = seedOf(key + "@head");
  const o = strokeOpts(theme, seed, {
    stroke: theme.line,
    strokeWidth: 1.6,
    roughness: 0.7,
    bowing: 0.6,
  });
  emit(s, gen.linearPath([[wingA.x, wingA.y], [to.x, to.y], [wingB.x, wingB.y]], o));
}
