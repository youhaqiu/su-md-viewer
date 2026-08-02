// flowchart.js 语法解析：```flow 代码块。
//
//   st=>start: 开始
//   op=>operation: 处理
//   cond=>condition: 成立？
//   io=>inputoutput: 输出
//   sub=>subroutine: 子流程
//   e=>end: 结束
//
//   st->op->cond
//   cond(yes)->io->e
//   cond(no,right)->sub->op
//
// 不依赖 flowchart.js 本体：它只会往 SVG 里画，拿不到结构；我们要的是能继续被
// 排版、导出、将来被拖拽编辑的图模型，所以自己解析成 IR。

import { emptyGraph, type DiagramEdge, type DiagramGraph, type NodeShape } from "./types";

const SHAPES: Record<string, NodeShape> = {
  start: "stadium",
  end: "stadium",
  operation: "rect",
  inputoutput: "parallelogram",
  subroutine: "subroutine",
  condition: "diamond",
  parallel: "rect",
};

const DEF_RE =
  /^\s*([A-Za-z_$][\w$]*)\s*=>\s*(start|end|operation|inputoutput|subroutine|condition|parallel)\s*:\s*([\s\S]*)$/;

// 连接段：id 后可跟 (参数)，参数含分支标签(yes/no/…)与方向(left/right/top/bottom)
const SEG_RE = /^\s*([A-Za-z_$][\w$]*)\s*(?:\(([^)]*)\))?\s*$/;
const DIRECTIONS = new Set(["left", "right", "top", "bottom"]);

export function looksLikeFlow(src: string): boolean {
  return DEF_RE.test(src) || /^\s*[A-Za-z_$][\w$]*\s*=>\s*\w+\s*:/m.test(src);
}

export function parseFlow(src: string): DiagramGraph {
  const g = emptyGraph("flow");
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const defined = new Set<string>();
  let edgeSeq = 0;

  // 先扫一遍定义（连接行可能出现在定义之前）
  for (const raw of lines) {
    const m = DEF_RE.exec(raw);
    if (!m) continue;
    const [, id, type, rest] = m;
    if (defined.has(id)) continue;
    defined.add(id);
    // 去掉 flowchart.js 的链接后缀 `:>http://…[blank]`
    const text = rest
      .replace(/:>[^\s]*$/, "")
      .replace(/\\n/g, "\n")
      .trim();
    g.nodes.push({
      id,
      text: text || id,
      shape: SHAPES[type] ?? "rect",
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    });
  }

  // 再扫连接行
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || DEF_RE.test(raw) || !line.includes("->")) continue;
    const segs = line.split("->");
    let prev: { id: string; label?: string; hint?: DiagramEdge["hint"] } | null = null;
    for (const seg of segs) {
      const m = SEG_RE.exec(seg);
      if (!m) {
        prev = null;
        continue;
      }
      const id = m[1];
      if (!defined.has(id)) {
        // 连接里出现了没定义的节点：补一个矩形，别让整张图垮掉
        defined.add(id);
        g.nodes.push({ id, text: id, shape: "rect", x: 0, y: 0, w: 0, h: 0 });
      }
      let label: string | undefined;
      let hint: DiagramEdge["hint"] | undefined;
      for (const p of (m[2] ?? "").split(",")) {
        const key = p.trim();
        if (!key) continue;
        if (DIRECTIONS.has(key.toLowerCase())) hint = key.toLowerCase() as DiagramEdge["hint"];
        else label = key;
      }
      // 参数写在段上：分支标签属于「从这个节点出去的那条边」
      if (prev) {
        g.edges.push({
          id: `e${edgeSeq++}`,
          from: prev.id,
          to: id,
          label: prev.label,
          arrow: "end",
          hint: prev.hint,
          points: [],
        });
      }
      prev = { id, label, hint };
    }
  }

  return g;
}
