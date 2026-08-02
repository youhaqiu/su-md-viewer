// 图表增强入口：渲染完 Markdown 后扫一遍代码块，把「是图」的那些换成图表卡片。
//
// 统一适配的落点在这里——不管作者写的是 ```mermaid、```flow 还是随手画的 ASCII 框图，
// 甚至没标语言，出来的都是同一种卡片、同一套配色和操作。

import { DiagramCard } from "./card";
import { classify } from "./detect";
import { COLORFUL_EVENT, STYLE_EVENT } from "./theme";

let cards: DiagramCard[] = [];

// 从 <code class="hljs language-xxx"> 里取出语言标注
function langOf(code: HTMLElement): string {
  for (const cls of Array.from(code.classList)) {
    if (cls.startsWith("language-")) return cls.slice("language-".length);
  }
  return "";
}

export function enhanceDiagrams(root: HTMLElement) {
  cards = [];
  const blocks = Array.from(root.querySelectorAll<HTMLPreElement>("pre"));
  for (const pre of blocks) {
    const codeEl = pre.querySelector("code");
    if (!codeEl) continue;
    const source = (codeEl.textContent ?? "").replace(/\n$/, "");
    if (!source.trim()) continue;
    const kind = classify(langOf(codeEl), source);
    if (!kind) continue;
    const card = new DiagramCard(kind, source);
    pre.replaceWith(card.el);
    cards.push(card);
    // 异步渲染：mermaid 要懒加载，别卡住整篇文档的首屏
    void card.render();
  }
}

// 深浅色 / 主题色切换后重画所有图（mermaid 也要按新主题重新生成）
// full=true 时连解析排版一起重来（换绘制风格会改字体字号，尺寸得重算）；
// 否则只按新配色重画，用户拖过的节点位置得以保留。
export function refreshDiagrams(full = false) {
  for (const card of cards) void card.refresh(full);
}

// 卡片上换绘制风格时广播到这里，所有图一起换
window.addEventListener(STYLE_EVENT, () => refreshDiagrams(true));

// 彩色开关只改颜色，不动字体字号，于是不必重新解析排版——
// 用 full=false 重画，用户拖过的节点位置留得住
window.addEventListener(COLORFUL_EVENT, () => refreshDiagrams(false));

export function hasDiagrams(): boolean {
  return cards.length > 0;
}
