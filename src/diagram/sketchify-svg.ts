// 把 mermaid 吐出来的规整 SVG「重画」成手绘风。
//
// 一开始试的是给元素套位移噪声滤镜，但 SVG 滤镜区域按元素自己的局部坐标系算，
// 而 mermaid 的每个节点都套着 transform，滤镜区域于是跑偏，菱形被裁掉半个。
// 所以改成直接换几何：把 rect / polygon / circle / path 交给 roughjs 重新生成，
// 和自渲染的图共用同一套笔触参数——两种图放在一篇文档里才像出自同一支笔。

import { RoughGenerator } from "roughjs/bin/generator";
import type { Options } from "roughjs/bin/core";
import { seedOf } from "./sketch";
import type { DiagramTheme } from "./types";

const SVG_NS = "http://www.w3.org/2000/svg";
const gen = new RoughGenerator();

const NONE = new Set(["none", "transparent", "rgba(0, 0, 0, 0)", ""]);
const isNone = (c: string | null | undefined) => !c || NONE.has(c.trim().toLowerCase());

// 元素的实际颜色要等它进了文档才算得出来（mermaid 把配色写在 SVG 内嵌的 <style> 里，
// 不是行内属性），所以这个函数必须在 SVG 已插入 DOM 之后调用。
// 一律以计算样式为准：presentation attribute 本来就是计算样式的最低优先级来源，
// 反过来优先读属性会踩坑——mermaid 的消息线写着 stroke="none"、真正颜色在 CSS 里，
// 信了属性就会把整条线画没。
function effective(el: SVGElement) {
  const cs = getComputedStyle(el);
  const stroke = cs.stroke || el.getAttribute("stroke") || "";
  const fill = cs.fill || el.getAttribute("fill") || "";
  const width = parseFloat(cs.strokeWidth || el.getAttribute("stroke-width") || "1") || 1;
  const dashed = !isNone(cs.strokeDasharray || el.getAttribute("stroke-dasharray"));
  return { stroke, fill, width, dashed };
}

// 小块的矩形基本都是边标签的底衬（"是"/"否"/"⌘E" 那种）。给它们打斜线的话，
// 一两根线正好横穿文字，看着像被划掉了——所以小块一律用原来的实心底色。
const HACHURE_MIN_AREA = 2200;

function baseOpts(seed: number, t: DiagramTheme, el: SVGElement, area: number): Options {
  const { stroke, fill, width, dashed } = effective(el);
  const o: Options = {
    seed,
    roughness: 0.9,
    bowing: 1,
    stroke: isNone(stroke) ? "none" : stroke,
    strokeWidth: Math.max(1.2, width),
    disableMultiStroke: true, // 只描一遍，重描会显脏
  };
  if (dashed) o.strokeLineDash = [7, 5];
  if (!isNone(fill)) {
    if (area >= HACHURE_MIN_AREA) {
      // 彩色模式下这个元素已经被 colorize-svg 染过了，斜线就照它自己的颜色画，
      // 不然一张图的方框各是各的色、涂鸦却是同一种主题色
      o.fill = t.colorful ? fill : t.sketchFill;
      o.fillStyle = "hachure";
      o.fillWeight = 0.9;
      o.hachureAngle = -41;
      o.hachureGap = 9;
    } else {
      o.fill = fill;
      o.fillStyle = "solid";
    }
  }
  return o;
}

// 用生成好的路径替换原元素，保留 transform / marker（箭头）。
//
// 特意不复制 class：mermaid 把配色写在 SVG 内嵌 <style> 里（.label-container 之类），
// 类名一旦跟过来，那些规则就会作用到新路径上——CSS 压过 presentation attribute，
// 手绘的主题色斜线会被重新染成深灰。同理颜色一律用行内 style 写死。
function replaceWith(el: SVGElement, drawable: ReturnType<RoughGenerator["rectangle"]>) {
  const g = document.createElementNS(SVG_NS, "g");
  for (const attr of ["transform", "opacity"]) {
    const v = el.getAttribute(attr);
    if (v) g.setAttribute(attr, v);
  }
  const infos = gen.toPaths(drawable);
  infos.forEach((info, i) => {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", info.d);
    p.setAttribute(
      "style",
      `fill:${info.fill ?? "none"};stroke:${info.stroke ?? "none"};` +
        `stroke-width:${info.strokeWidth}px;stroke-linecap:round;stroke-linejoin:round`,
    );
    // 箭头 marker 只挂到最后一段，免得画出好几个箭头
    if (i === infos.length - 1) {
      for (const m of ["marker-end", "marker-start"]) {
        const v = el.getAttribute(m);
        if (v) p.setAttribute(m, v);
      }
    }
    g.appendChild(p);
  });
  el.replaceWith(g);
}

const num = (el: SVGElement, name: string, fallback = 0) => {
  const v = parseFloat(el.getAttribute(name) ?? "");
  return Number.isFinite(v) ? v : fallback;
};

export function sketchifyMermaid(svg: SVGSVGElement, t: DiagramTheme) {
  if (t.style !== "sketch") return;

  // defs / marker 里的东西是模板，重画会连累所有引用它的地方
  const inDefs = (el: Element) => !!el.closest("defs, marker, clipPath, mask, pattern");

  const shapes = Array.from(
    svg.querySelectorAll<SVGElement>("rect, polygon, circle, ellipse, line, path, polyline"),
  ).filter((el) => !inDefs(el));

  shapes.forEach((el, i) => {
    const seed = seedOf(`${el.tagName}#${i}`);
    // 面积用来区分「节点方框」和「标签底衬」
    let box = { width: 0, height: 0 };
    try {
      // getBBox 只在 SVGGraphicsElement 上有；这些标签都是，但 TS 的类型没那么细
      box = (el as SVGGraphicsElement).getBBox();
    } catch {
      /* 不在渲染树里的元素量不到，按 0 处理 */
    }
    const o = baseOpts(seed, t, el, box.width * box.height);
    try {
      switch (el.tagName.toLowerCase()) {
        case "rect": {
          const w = num(el, "width");
          const h = num(el, "height");
          if (w < 1 || h < 1) return;
          replaceWith(el, gen.rectangle(num(el, "x"), num(el, "y"), w, h, o));
          break;
        }
        case "circle": {
          const r = num(el, "r");
          if (r < 1) return;
          replaceWith(el, gen.ellipse(num(el, "cx"), num(el, "cy"), r * 2, r * 2, o));
          break;
        }
        case "ellipse": {
          const rx = num(el, "rx");
          const ry = num(el, "ry");
          if (rx < 1 || ry < 1) return;
          replaceWith(el, gen.ellipse(num(el, "cx"), num(el, "cy"), rx * 2, ry * 2, o));
          break;
        }
        case "line": {
          replaceWith(
            el,
            gen.line(num(el, "x1"), num(el, "y1"), num(el, "x2"), num(el, "y2"), o),
          );
          break;
        }
        case "polygon":
        case "polyline": {
          const pts = (el.getAttribute("points") ?? "")
            .trim()
            .split(/[\s,]+/)
            .map(Number);
          const list: Array<[number, number]> = [];
          for (let k = 0; k + 1 < pts.length; k += 2) list.push([pts[k], pts[k + 1]]);
          if (list.length < 3) return;
          replaceWith(
            el,
            el.tagName.toLowerCase() === "polygon"
              ? gen.polygon(list, o)
              : gen.linearPath(list, o),
          );
          break;
        }
        case "path": {
          const d = el.getAttribute("d");
          if (!d || d.length > 4000) return; // 超长路径（甘特图底纹等）不折腾
          replaceWith(el, gen.path(d, { ...o, fill: undefined }));
          break;
        }
      }
    } catch {
      // 个别形状 roughjs 解析不了就留着原样，别让整张图挂掉
    }
  });

  svg.querySelectorAll<SVGElement>("text, tspan").forEach((el) => {
    el.setAttribute("font-family", t.handFont);
  });
}
