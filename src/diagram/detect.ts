// 识别一个代码块该不该当成图，以及是哪种图。
// 显式语言标注优先；没标注（或标成 text/plain）时才走启发式，尽量不误伤正经代码。

import { looksLikeFlow } from "./parse-flow";

export type DiagramKind = "mermaid" | "flow" | "ascii";

const MERMAID_LANGS = new Set(["mermaid", "mmd"]);
const FLOW_LANGS = new Set(["flow", "flowchart", "flowchartjs", "flowchart.js"]);
const ASCII_LANGS = new Set([
  "ascii",
  "asciiart",
  "ascii-art",
  "asciiflow",
  "svgbob",
  "boxart",
  "textart",
  "text-art",
  "diagram",
]);
// 这些等于「没标语言」，可以参与自动识别
const NEUTRAL_LANGS = new Set(["", "text", "plain", "plaintext", "txt", "none"]);

const MERMAID_HEAD =
  /^\s*(?:%%\{[\s\S]*?\}%%\s*)?(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|sankey-beta|xychart-beta|block-beta|packet-beta|architecture-beta|C4Context|C4Container|C4Component|C4Dynamic)\b/;

// 手绘图的判据：有闭合方框（ASCII 的 +--+ 或 Unicode 制表符），
// 且竖线 / 制表符出现在多行上——单行的 |a|b| 表格、命令行输出不算。
export function looksLikeAscii(code: string): boolean {
  const lines = code.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length < 3) return false;

  const unicodeBox = /[┌┐└┘├┤┬┴┼─│╭╮╰╯═║╔╗╚╝╠╣╦╩╬━┃┏┓┗┛]/;
  const asciiCorner = /\+[-=]{2,}\+/;
  const hasBox = lines.some((l) => unicodeBox.test(l) || asciiCorner.test(l));
  if (!hasBox) return false;

  const verticalish = lines.filter((l) => /[|│┃║]/.test(l)).length;
  const boxLines = lines.filter((l) => unicodeBox.test(l) || asciiCorner.test(l)).length;
  if (verticalish + boxLines < 3) return false;

  // 一眼像代码就放过：分号结尾、花括号、常见关键字密集出现
  const codey = lines.filter((l) => /[;{}]\s*$/.test(l) || /\b(function|const|let|var|class|import|def|return|if|for|while)\b/.test(l)).length;
  if (codey > lines.length / 3) return false;

  return true;
}

// 无框流程图：没有闭合方框，但有「文字行 + 箭头 + 连线」的流程结构，比如
//
//   OCR 文本
//     │
//     ▼
//   规则匹配器（优先）
//
// 箭头既认 Unicode（▼ →），也认 ASCII 写法：-> / --> / <- ，以及单独成词的 v ^（竖向箭头）。
// 判据刻意偏严：tree 输出、shell 会话里也有 │ └──，但没有箭头，在这里被挡掉。
const U_ARROW = /[▼▾↓↑←→◀▶▸◂➜➤]/;
const ASCII_ARROW = /-+>|<-+|(?:^|\s)[v^](?=\s|$)/;
export function looksLikeBareFlow(code: string): boolean {
  const lines = code
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((l) => l.trim());
  if (lines.length < 3) return false;

  const arrowLines = lines.filter((l) => U_ARROW.test(l) || ASCII_ARROW.test(l)).length;
  if (arrowLines < 2) return false;
  // 连线：框线字符、竖线 |，或 --> 里那种连着的 -
  const wireLines = lines.filter((l) => /[│┃║|─━└┕├┝┌┍┐┑┘┙]|--/.test(l)).length;
  if (wireLines < 1) return false;
  // 数「文字段」而不是文字行：横向图一行就有好几个节点（读取配置 → 解析参数 → 校验输入）。
  // 单独成词的 v ^ 是箭头，先抹掉，别被当成文字
  const textSegs = lines
    .map((l) => l.replace(/(^|\s)[v^](?=\s|$)/g, "$1 "))
    .flatMap((l) => l.split(/[│┃║|─━═┌┍┐┑└┕┘┙├┝┤┥┬┯┴┷┼╋▼▾↓↑←→◀▶▸◂➜➤]+|-+>|<-+/))
    .filter((s) => /[\p{L}\p{N}]/u.test(s)).length;
  if (textSegs < 3) return false;

  // 一眼像代码就放过：分号结尾、花括号、常见关键字、箭头函数 / 方法调用（x => y、p->f()）、
  // 命令提示符密集出现。ASCII 箭头放进来之后，C 的 p->next、shell 的 > 重定向都得靠这里挡
  const codey = lines.filter(
    (l) =>
      /[;{}]\s*$/.test(l) ||
      /\b(function|const|let|var|class|import|def|return|if|for|while|fn|func)\b/.test(l) ||
      /=>|\w->\w+\(|^\s*[$#>]\s/.test(l),
  ).length;
  if (codey > lines.length / 3) return false;

  return true;
}

// lang 取自 <code class="language-xxx">；code 是原始文本
export function classify(lang: string, code: string): DiagramKind | null {
  const l = lang.trim().toLowerCase();
  if (MERMAID_LANGS.has(l)) return "mermaid";
  if (FLOW_LANGS.has(l)) return "flow";
  if (ASCII_LANGS.has(l)) return "ascii";
  if (!NEUTRAL_LANGS.has(l)) return null; // 标了别的语言就是正经代码，别动
  // 内容本身以围栏开头：这是在「展示一段图的源码」，照原样当代码块显示
  if (/^\s*(?:```|~~~)/.test(code)) return null;

  if (MERMAID_HEAD.test(code)) return "mermaid";
  if (looksLikeFlow(code)) return "flow";
  if (looksLikeAscii(code)) return "ascii";
  if (looksLikeBareFlow(code)) return "ascii";
  return null;
}
