// .txt 的排版保全。
//
// 纯文本里，缩进和对齐本身就是排版——ASCII 方框图、用空格对齐的表格、缩进的段落。
// 直接交给 Markdown 渲染，这些空白会被折叠掉：方框散架、表格错位、缩进消失。
// 于是在送进 marked 之前先把这些整块「钉住」：
//
//   · 像图 / 像对齐排版的块 → 包成 <pre><code>，等宽显示、空白原样保留
//     （包完还会经过图表模块，ASCII 方框图能被认出来，直接渲染成一张图卡片）
//   · 只是缩进的块 → 前导空格换成 &nbsp;，字体不变，缩进留住
//   · 其余照旧走 Markdown（.txt 笔记里的 # 标题、- 列表照样排出来）
//
// 两种改写都严格不增删行：预览块与源码行的对应表（见 main.ts 的 buildSourceMap）
// 靠行号一一对应，多一行少一行都会让进出编辑模式的定位错位。

import { looksLikeAscii } from "./diagram/detect";

// 列表项 / 有序列表项。这类块交给 Markdown，别插手——
// 二级列表靠的就是前导缩进，缩进一旦换成 &nbsp; 就不再是嵌套列表了。
const LIST_RE = /^\s*(?:[-*+]\s|\d+[.)]\s)/;

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}

// 一行里「词与词之间空开 2 格以上」的位置——表格的列缝就长这样
function gapColumns(line: string): number[] {
  const out: number[] = [];
  const re = /\S {2,}(?=\S)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m.index + 1);
  return out;
}

// 多行在同一列上都留着缝 → 这是排版对齐过的，不是普通段落。
// 要求过半的行（且至少两行）在同一列（±1）对齐：英文里句末双空格偶尔也会撞上一次，
// 但要连着好几行撞在同一列，基本不可能。
export function looksAligned(lines: string[]): boolean {
  if (lines.length < 2) return false;
  const cols = lines.map(gapColumns);
  const need = Math.max(2, Math.ceil(lines.length / 2));
  for (const c of new Set(cols.flat())) {
    const hits = cols.filter((s) => s.some((x) => Math.abs(x - c) <= 1)).length;
    if (hits >= need) return true;
  }
  return false;
}

export function preserveTextLayout(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out = lines.slice();

  let i = 0;
  let inFence = false;
  while (i < lines.length) {
    // 文本里自己写了 ``` 围栏：里面的内容 Markdown 本来就会原样保留，别再插手
    if (/^\s*(?:```|~~~)/.test(lines[i])) {
      inFence = !inFence;
      i++;
      continue;
    }
    if (inFence || !lines[i].trim()) {
      i++;
      continue;
    }

    // 取一整段连续的非空行
    let j = i;
    while (j < lines.length && lines[j].trim() && !/^\s*(?:```|~~~)/.test(lines[j])) j++;
    const block = lines.slice(i, j);

    if (!block.some((l) => LIST_RE.test(l))) {
      if (looksLikeAscii(block.join("\n")) || looksAligned(block)) {
        // 整块钉成等宽：首行前面开标签、末行后面收标签，行数不变
        for (let k = 0; k < block.length; k++) out[i + k] = esc(block[k]);
        out[i] = `<pre class="txt-block"><code>${out[i]}`;
        out[j - 1] = `${out[j - 1]}</code></pre>`;
      } else {
        for (let k = 0; k < block.length; k++) {
          out[i + k] = block[k].replace(/^ +/, (s) => "&nbsp;".repeat(s.length));
        }
      }
    }
    i = j;
  }

  return out.join("\n");
}
