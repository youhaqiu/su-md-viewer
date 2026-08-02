// 绘制抽象层：render.ts 只调用这里的几个图元，具体落到 Canvas 还是 SVG 由实现决定。
//
// 这么分是为了一份绘制代码同时支撑两件事：屏幕上用 Canvas（将来做拖拽编辑要靠它
// 逐帧重画、命中检测），导出矢量时用 SVG（无损、可再编辑）。

import type { Point } from "./types";

// 竖向线性渐变填充（玻璃风的节点上浅下深）。只做竖向：图元都是横平竖直的方框，
// 斜向渐变在小方块上看不出差别，却要多带两个坐标。
export type Gradient = { from: string; to: string; y0: number; y1: number };

export type StrokeOpts = {
  stroke?: string;
  fill?: string;
  // 有 gradient 时优先于 fill
  gradient?: Gradient;
  lineWidth?: number;
  dash?: number[];
  // 外发光（霓虹风）：以自身颜色向外晕开，Canvas 用 shadowBlur，SVG 用 feDropShadow
  glow?: number;
  glowColor?: string;
  // 柔和投影（玻璃风）：同一套机制，只是有竖直偏移、颜色是半透明黑
  shadow?: { blur: number; dy: number; color: string };
};

export type TextOpts = {
  font: string;
  color: string;
  align?: "left" | "center" | "right";
  baseline?: "top" | "middle";
  glow?: number;
  glowColor?: string;
};

export interface Surface {
  // 直接画一段 SVG path 数据。手绘风格用它：roughjs 生成的抖动路径，
  // Canvas 端交给 Path2D、SVG 端原样写进 d，两边保证长得一模一样。
  rawPath(d: string, o: StrokeOpts): void;
  polygon(pts: Point[], o: StrokeOpts): void;
  roundRect(x: number, y: number, w: number, h: number, r: number, o: StrokeOpts): void;
  ellipse(cx: number, cy: number, rx: number, ry: number, o: StrokeOpts): void;
  path(pts: Point[], o: StrokeOpts): void; // 折线（不闭合、不填充）
  line(a: Point, b: Point, o: StrokeOpts): void;
  text(s: string, x: number, y: number, o: TextOpts): void;
  measure(s: string, font: string): number;
}

// ===== 文本测量：布局阶段还没有画布，用一个模块级离屏 canvas 统一量 =====
let measureCtx: CanvasRenderingContext2D | null = null;
export function measureText(s: string, font: string): number {
  if (!measureCtx) {
    measureCtx = document.createElement("canvas").getContext("2d");
  }
  if (!measureCtx) return s.length * 7;
  measureCtx.font = font;
  return measureCtx.measureText(s).width;
}

// ===== Canvas 实现 =====
export class CanvasSurface implements Surface {
  constructor(private ctx: CanvasRenderingContext2D) {}

  private apply(o: StrokeOpts) {
    const c = this.ctx;
    c.lineWidth = o.lineWidth ?? 1.4;
    c.setLineDash(o.dash ?? []);
    c.lineJoin = "round";
    c.lineCap = "round";
    // 发光和投影是同一个 canvas 阴影，谁在就用谁；用完必须清掉，
    // 否则后面所有图元都会跟着糊一层
    if (o.glow) {
      c.shadowColor = o.glowColor ?? o.stroke ?? o.fill ?? "transparent";
      c.shadowBlur = o.glow;
      c.shadowOffsetX = 0;
      c.shadowOffsetY = 0;
    } else if (o.shadow) {
      c.shadowColor = o.shadow.color;
      c.shadowBlur = o.shadow.blur;
      c.shadowOffsetX = 0;
      c.shadowOffsetY = o.shadow.dy;
    } else {
      c.shadowColor = "transparent";
      c.shadowBlur = 0;
      c.shadowOffsetY = 0;
    }
  }

  private clearShadow() {
    const c = this.ctx;
    c.shadowColor = "transparent";
    c.shadowBlur = 0;
    c.shadowOffsetX = 0;
    c.shadowOffsetY = 0;
  }

  private fillStyleOf(o: StrokeOpts): string | CanvasGradient | null {
    if (o.gradient) {
      const g = this.ctx.createLinearGradient(0, o.gradient.y0, 0, o.gradient.y1);
      g.addColorStop(0, o.gradient.from);
      g.addColorStop(1, o.gradient.to);
      return g;
    }
    return o.fill ?? null;
  }

  private paint(o: StrokeOpts) {
    const c = this.ctx;
    const f = this.fillStyleOf(o);
    if (f) {
      c.fillStyle = f;
      c.fill();
    }
    if (o.stroke) {
      c.strokeStyle = o.stroke;
      c.stroke();
    }
    this.clearShadow();
  }

  rawPath(d: string, o: StrokeOpts) {
    const c = this.ctx;
    this.apply(o);
    const p = new Path2D(d);
    const f = this.fillStyleOf(o);
    if (f) {
      c.fillStyle = f;
      c.fill(p);
    }
    if (o.stroke) {
      c.strokeStyle = o.stroke;
      c.stroke(p);
    }
    this.clearShadow();
  }

  polygon(pts: Point[], o: StrokeOpts) {
    if (pts.length < 2) return;
    const c = this.ctx;
    this.apply(o);
    c.beginPath();
    c.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
    c.closePath();
    this.paint(o);
  }

  roundRect(x: number, y: number, w: number, h: number, r: number, o: StrokeOpts) {
    const c = this.ctx;
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    this.apply(o);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
    this.paint(o);
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, o: StrokeOpts) {
    const c = this.ctx;
    this.apply(o);
    c.beginPath();
    c.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
    this.paint(o);
  }

  path(pts: Point[], o: StrokeOpts) {
    if (pts.length < 2) return;
    const c = this.ctx;
    this.apply(o);
    c.beginPath();
    c.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
    const f = this.fillStyleOf(o);
    if (f) {
      c.fillStyle = f;
      c.fill();
    }
    if (o.stroke) {
      c.strokeStyle = o.stroke;
      c.stroke();
    }
    this.clearShadow();
  }

  line(a: Point, b: Point, o: StrokeOpts) {
    this.path([a, b], o);
  }

  text(s: string, x: number, y: number, o: TextOpts) {
    const c = this.ctx;
    c.font = o.font;
    c.fillStyle = o.color;
    c.textAlign = o.align ?? "center";
    c.textBaseline = o.baseline ?? "middle";
    if (o.glow) {
      c.shadowColor = o.glowColor ?? o.color;
      c.shadowBlur = o.glow;
      c.shadowOffsetX = 0;
      c.shadowOffsetY = 0;
    }
    c.fillText(s, x, y);
    this.clearShadow();
  }

  measure(s: string, font: string): number {
    this.ctx.font = font;
    return this.ctx.measureText(s).width;
  }
}

// ===== SVG 实现：把图元攒成字符串，最后 serialize() 出完整文档 =====
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}

const n = (v: number) => Math.round(v * 100) / 100;

export class SvgSurface implements Surface {
  private parts: string[] = [];
  // 发光 / 投影 / 渐变都得进 <defs>，同参数的复用一个 id，导出的文件不至于塞几十份一样的滤镜
  private defs: string[] = [];
  private defIds = new Map<string, string>();

  constructor(
    private width: number,
    private height: number,
    private background = "transparent",
  ) {}

  private def(key: string, make: (id: string) => string): string {
    const hit = this.defIds.get(key);
    if (hit) return hit;
    const id = `d${this.defIds.size}`;
    this.defIds.set(key, id);
    this.defs.push(make(id));
    return id;
  }

  // Canvas 的 shadowBlur ≈ 2×标准差，除以 2 两边观感才对得上
  private blurFilter(o: { blur: number; dy: number; color: string }): string {
    const key = `f:${o.blur}:${o.dy}:${o.color}`;
    return this.def(
      key,
      (id) =>
        `<filter id="${id}" x="-60%" y="-60%" width="220%" height="220%">` +
        `<feDropShadow dx="0" dy="${n(o.dy)}" stdDeviation="${n(o.blur / 2)}" ` +
        `flood-color="${esc(o.color)}" flood-opacity="1"/></filter>`,
    );
  }

  private gradientDef(g: Gradient): string {
    const key = `g:${g.from}:${g.to}:${n(g.y0)}:${n(g.y1)}`;
    return this.def(
      key,
      (id) =>
        `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" ` +
        `x1="0" y1="${n(g.y0)}" x2="0" y2="${n(g.y1)}">` +
        `<stop offset="0" stop-color="${esc(g.from)}"/>` +
        `<stop offset="1" stop-color="${esc(g.to)}"/></linearGradient>`,
    );
  }

  private attrs(o: StrokeOpts): string {
    const fill = o.gradient
      ? `url(#${this.gradientDef(o.gradient)})`
      : (o.fill ?? "none");
    const parts = [
      `fill="${fill}"`,
      `stroke="${o.stroke ?? "none"}"`,
      `stroke-width="${o.lineWidth ?? 1.4}"`,
      `stroke-linejoin="round"`,
      `stroke-linecap="round"`,
    ];
    if (o.dash?.length) parts.push(`stroke-dasharray="${o.dash.join(" ")}"`);
    if (o.glow) {
      const color = o.glowColor ?? o.stroke ?? o.fill ?? "";
      if (color) parts.push(`filter="url(#${this.blurFilter({ blur: o.glow, dy: 0, color })})"`);
    } else if (o.shadow) {
      parts.push(`filter="url(#${this.blurFilter(o.shadow)})"`);
    }
    return parts.join(" ");
  }

  rawPath(d: string, o: StrokeOpts) {
    this.parts.push(`<path d="${d}" ${this.attrs(o)}/>`);
  }

  polygon(pts: Point[], o: StrokeOpts) {
    if (pts.length < 2) return;
    const d = pts.map((p) => `${n(p.x)},${n(p.y)}`).join(" ");
    this.parts.push(`<polygon points="${d}" ${this.attrs(o)}/>`);
  }

  roundRect(x: number, y: number, w: number, h: number, r: number, o: StrokeOpts) {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    this.parts.push(
      `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(rr)}" ry="${n(rr)}" ${this.attrs(o)}/>`,
    );
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, o: StrokeOpts) {
    this.parts.push(
      `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(Math.abs(rx))}" ry="${n(Math.abs(ry))}" ${this.attrs(o)}/>`,
    );
  }

  path(pts: Point[], o: StrokeOpts) {
    if (pts.length < 2) return;
    const d = pts.map((p, i) => `${i ? "L" : "M"}${n(p.x)} ${n(p.y)}`).join(" ");
    this.parts.push(`<path d="${d}" ${this.attrs(o)}/>`);
  }

  line(a: Point, b: Point, o: StrokeOpts) {
    this.path([a, b], o);
  }

  text(s: string, x: number, y: number, o: TextOpts) {
    const anchor =
      o.align === "left" ? "start" : o.align === "right" ? "end" : "middle";
    const baseline = (o.baseline ?? "middle") === "top" ? "hanging" : "central";
    // font 形如 "600 13px XXX"，拆成 SVG 需要的属性
    const m = /^\s*(?:(\d{3}|bold|normal)\s+)?([\d.]+)px\s+(.+)$/.exec(o.font);
    const weight = m?.[1] ? ` font-weight="${m[1]}"` : "";
    const size = m ? ` font-size="${m[2]}"` : "";
    const family = m ? ` font-family="${esc(m[3])}"` : ` font-family="${esc(o.font)}"`;
    const glow = o.glow
      ? ` filter="url(#${this.blurFilter({ blur: o.glow, dy: 0, color: o.glowColor ?? o.color })})"`
      : "";
    this.parts.push(
      `<text x="${n(x)}" y="${n(y)}" text-anchor="${anchor}" dominant-baseline="${baseline}"${weight}${size}${family} fill="${o.color}"${glow} xml:space="preserve">${esc(s)}</text>`,
    );
  }

  measure(s: string, font: string): number {
    return measureText(s, font);
  }

  serialize(): string {
    const bg =
      this.background && this.background !== "transparent"
        ? `<rect width="100%" height="100%" fill="${this.background}"/>`
        : "";
    const defs = this.defs.length ? `<defs>${this.defs.join("")}</defs>` : "";
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${n(this.width)}" height="${n(this.height)}" ` +
      `viewBox="0 0 ${n(this.width)} ${n(this.height)}">${defs}${bg}${this.parts.join("")}</svg>`
    );
  }
}
