// Mermaid：图种太多（时序 / 类图 / 甘特 / 状态机 / 思维导图…），短期内不自研，
// 直接用官方库渲染，但把配色变量接到本应用的主题上，让它和自渲染的图观感一致。
// 库比较大，用动态 import 懒加载：文档里没有 mermaid 图就完全不会加载。
//
// 手绘风格没法让 mermaid 自己画成那样，所以渲染完再对它吐出的 SVG 做后处理：
// 给图形套一层位移噪声滤镜（线条就抖起来了）、文字换成手写体。

import { mermaidThemeVariables, readTheme } from "./theme";
import type { DiagramTheme } from "./types";

type MermaidApi = typeof import("mermaid").default;

let apiPromise: Promise<MermaidApi> | null = null;
let seq = 0;

async function getApi(): Promise<MermaidApi> {
  if (!apiPromise) {
    apiPromise = import("mermaid").then((m) => m.default);
  }
  return apiPromise;
}

// 每次渲染前按当前主题重新初始化，深浅色 / 主题色切换后颜色才会跟着走
async function configure(t: DiagramTheme): Promise<MermaidApi> {
  const api = await getApi();
  const hand = t.style === "sketch";
  api.initialize({
    startOnLoad: false,
    securityLevel: "strict", // 不执行图里的脚本 / 点击回调
    theme: "base",
    themeVariables: mermaidThemeVariables(t),
    fontFamily: hand ? t.handFont : t.font,
    // htmlLabels:false → 标签走 SVG <text> 而不是 foreignObject，
    // 这样导出 PNG（SVG 转位图）时文字不会丢，后处理换字体也才能改到
    htmlLabels: false,
    // mermaid 默认间距对中文偏挤：节点小、反向的两条边几乎叠在一起
    flowchart: {
      htmlLabels: false,
      curve: "basis",
      padding: 16,
      nodeSpacing: 52,
      rankSpacing: 62,
      useMaxWidth: false,
    },
    // 状态图没有 nodeSpacing 这个键，它靠 padding 与 edgeLengthFactor 撑开
    state: {
      useMaxWidth: false,
      padding: 16,
      edgeLengthFactor: "38",
      radius: 8,
    },
    class: { useMaxWidth: false },
    er: { useMaxWidth: false },
    journey: { useMaxWidth: false },
    pie: { useMaxWidth: false },
    mindmap: { useMaxWidth: false },
    sequence: { useMaxWidth: false },
    gantt: { useMaxWidth: false },
  });
  return api;
}

export type MermaidResult = { svg: SVGSVGElement; width: number; height: number };

export async function renderMermaid(code: string): Promise<MermaidResult> {
  const t = readTheme();
  const api = await configure(t);
  const id = `md-viewer-mermaid-${seq++}`;
  const { svg } = await api.render(id, code);
  const holder = document.createElement("div");
  holder.innerHTML = svg;
  const el = holder.querySelector("svg");
  if (!el) throw new Error("mermaid returned no svg");

  // mermaid 默认会塞 max-width:100%，这里由卡片统一控制缩放，先摘掉
  el.style.maxWidth = "none";
  el.removeAttribute("width");
  el.removeAttribute("height");

  const vb = el.viewBox?.baseVal;
  const width = vb?.width || el.getBoundingClientRect().width || 600;
  const height = vb?.height || el.getBoundingClientRect().height || 400;
  el.setAttribute("width", String(width));
  el.setAttribute("height", String(height));
  // 手绘化必须等 SVG 进了文档才能做（要靠 getComputedStyle 读出 mermaid 内嵌样式里的
  // 实际配色），所以交给卡片在 append 之后调 sketchifyMermaid。
  return { svg: el as SVGSVGElement, width, height };
}
