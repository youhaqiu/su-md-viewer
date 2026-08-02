// Mermaid 的流程图（flowchart / graph）与状态图（stateDiagram）解析成我们自己的图模型。
//
// 为什么要自己再解析一遍：官方库只吐 SVG，拿不到结构，于是这两类图既不能拖着改布局，
// 排版也只能听 dagre 的（状态机两条反向边贴在一起就是它的老毛病）。接进自研引擎后，
// 它们和 flow / ASCII 图彻底同源：同一套排版、同一支笔、同样能拖。
//
// 只吃常见语法。碰上子图、组合状态、注解这些暂未支持的写法就返回 null，
// 由调用方回落到官方库——宁可样式不统一，也不能把作者写的东西悄悄画丢。

import { emptyGraph, type DiagramEdge, type DiagramGraph, type NodeShape } from "./types";

// ===== 通用工具 =====

// 去掉行尾注释与前后空白；%% 开头的整行是注释
function cleanLines(src: string): string[] {
  return src
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/%%.*$/, "").trim())
    .filter(Boolean);
}

// 节点文字里的引号、<br> 与转义
function normalizeText(raw: string): string {
  return raw
    .trim()
    .replace(/^["'`]|["'`]$/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/#quot;/g, '"')
    .trim();
}

// ===== 流程图 =====

// 形状由括号种类决定，长的写法要排在前面先匹配
const SHAPE_PATTERNS: Array<{ open: string; close: string; shape: NodeShape }> = [
  { open: "([", close: "])", shape: "stadium" },
  { open: "[[", close: "]]", shape: "subroutine" },
  { open: "[(", close: ")]", shape: "cylinder" },
  { open: "((", close: "))", shape: "ellipse" },
  { open: "{{", close: "}}", shape: "hexagon" },
  { open: "[/", close: "/]", shape: "parallelogram" },
  { open: "[\\", close: "\\]", shape: "parallelogram" },
  { open: "[/", close: "\\]", shape: "trapezoid" },
  { open: "[\\", close: "/]", shape: "trapezoid" },
  { open: "[", close: "]", shape: "rect" },
  { open: "(", close: ")", shape: "round" },
  { open: "{", close: "}", shape: "diamond" },
  { open: ">", close: "]", shape: "rect" }, // 旗帜形，用矩形近似
];

const ID_RE = /^[A-Za-z0-9_一-鿿][A-Za-z0-9_.一-鿿-]*/;
// 连线由这些字符组成；节点名不会以它们开头，所以「读到节点后必然是连线」这个前提成立
const LINK_CHARS = /[-=.~<]/;

type NodeRef = { id: string; text?: string; shape?: NodeShape };

// 从 pos 处读一个节点引用（可能带形状括号）
function readNode(s: string, pos: number): { ref: NodeRef; next: number } | null {
  while (pos < s.length && s[pos] === " ") pos++; // -->|标签| 之后还留着空格
  const rest = s.slice(pos);
  const m = ID_RE.exec(rest);
  if (!m) return null;
  const id = m[0];
  let p = pos + id.length;

  for (const { open, close, shape } of SHAPE_PATTERNS) {
    if (!s.startsWith(open, p)) continue;
    const end = s.indexOf(close, p + open.length);
    if (end === -1) continue;
    return {
      ref: { id, text: normalizeText(s.slice(p + open.length, end)), shape },
      next: end + close.length,
    };
  }
  return { ref: { id }, next: p };
}

type LinkInfo = { label?: string; dashed: boolean; arrow: DiagramEdge["arrow"]; next: number };

// 从 pos 处读一条连线：<--> / --> / --- / -.-> / ==> / -- 文本 --> / -->|文本|
function readLink(s: string, pos: number): LinkInfo | null {
  let p = pos;
  while (p < s.length && s[p] === " ") p++;
  if (p >= s.length || !LINK_CHARS.test(s[p])) return null;

  const backward = s[p] === "<";
  if (backward) p++;

  const runStart = p;
  while (p < s.length && /[-=.~]/.test(s[p])) p++;
  if (p === runStart) return null;
  let body = s.slice(runStart, p);

  // 中缀标签：-- 文本 --> 。标签后面必须还有一段线体，否则那就是目标节点了
  let label: string | undefined;
  const infix = /^\s*([^|>\n][^|\n]*?)\s*([-=.~]+)/.exec(s.slice(p));
  if (infix && !/^[>ox]/.test(s.slice(p).trimStart())) {
    label = normalizeText(infix[1]);
    body += infix[2];
    p += infix[0].length;
  }

  // 箭头
  let forward = false;
  if (p < s.length && /[>ox]/.test(s[p])) {
    forward = true;
    p++;
  }

  // 管道标签：-->|文本|
  while (p < s.length && s[p] === " ") p++;
  if (s[p] === "|") {
    const end = s.indexOf("|", p + 1);
    if (end !== -1) {
      label = normalizeText(s.slice(p + 1, end));
      p = end + 1;
    }
  }

  const arrow: DiagramEdge["arrow"] =
    backward && forward ? "both" : forward || backward ? "end" : "none";
  return { label, dashed: body.includes("."), arrow, next: p };
}

// 这些语句我们不处理，出现即整张图回落官方库（子图会丢分组，不能装作没看见）
const FLOW_BAILOUT = /^(subgraph|end\b)/i;
// 这些是纯样式，忽略即可
const FLOW_IGNORE = /^(classDef|class|style|linkStyle|click|accTitle|accDescr)\b/i;

export function parseMermaidFlowchart(src: string): DiagramGraph | null {
  const lines = cleanLines(src);
  if (!lines.length) return null;

  const head = /^(?:flowchart|graph)\s+(TB|TD|BT|LR|RL)?/i.exec(lines[0]);
  if (!head) return null;

  const g = emptyGraph("flow");
  const dir = (head[1] ?? "TB").toUpperCase();
  g.direction = dir === "LR" || dir === "RL" ? "LR" : "TB";

  const byId = new Map<string, number>(); // id -> g.nodes 下标
  let edgeSeq = 0;

  const upsert = (ref: NodeRef) => {
    const idx = byId.get(ref.id);
    if (idx === undefined) {
      byId.set(ref.id, g.nodes.length);
      g.nodes.push({
        id: ref.id,
        text: ref.text ?? ref.id,
        shape: ref.shape ?? "rect",
        x: 0,
        y: 0,
        w: 0,
        h: 0,
      });
      return;
    }
    // 同一节点可以在后面的语句里补上文字 / 形状
    const n = g.nodes[idx];
    if (ref.text !== undefined) n.text = ref.text;
    if (ref.shape !== undefined) n.shape = ref.shape;
  };

  for (const line of lines.slice(1)) {
    if (FLOW_BAILOUT.test(line)) return null;
    if (FLOW_IGNORE.test(line)) continue;
    if (/^direction\s+/i.test(line)) {
      const d = line.split(/\s+/)[1]?.toUpperCase();
      if (d === "LR" || d === "RL") g.direction = "LR";
      else if (d) g.direction = "TB";
      continue;
    }

    // 沿着一行交替读「节点 - 连线 - 节点 …」，支持链式写法 A --> B --> C
    const first = readNode(line, 0);
    if (!first) continue;
    upsert(first.ref);
    let pos = first.next;
    let current = first.ref.id;
    let guard = 0;
    while (guard++ < 200) {
      const link = readLink(line, pos);
      if (!link) break;
      pos = link.next;
      const target = readNode(line, pos);
      if (!target) break;
      upsert(target.ref);
      g.edges.push({
        id: `e${edgeSeq++}`,
        from: current,
        to: target.ref.id,
        label: link.label,
        dashed: link.dashed,
        arrow: link.arrow,
        points: [],
      });
      current = target.ref.id;
      pos = target.next;
    }
  }

  if (!g.nodes.length) return null;
  return g;
}

// ===== 状态图 =====

// 组合状态 / 分叉 / 并发 / 注解暂不支持，交回官方库
const STATE_BAILOUT = /(\{\s*$)|(<<\s*(fork|join|choice)\s*>>)|^note\b|^\s*--\s*$/i;

export function parseMermaidState(src: string): DiagramGraph | null {
  const lines = cleanLines(src);
  if (!lines.length) return null;
  if (!/^stateDiagram(-v2)?\b/i.test(lines[0])) return null;

  const g = emptyGraph("flow");
  const byId = new Map<string, number>();
  let edgeSeq = 0;
  let terminalSeq = 0;

  // [*] 每出现一次都是独立的起点 / 终点圆点
  const ensure = (rawId: string, text?: string): string => {
    const id = rawId;
    const idx = byId.get(id);
    if (idx === undefined) {
      byId.set(id, g.nodes.length);
      g.nodes.push({
        id,
        text: text ?? id,
        shape: "round",
        x: 0,
        y: 0,
        w: 0,
        h: 0,
      });
    } else if (text !== undefined) {
      g.nodes[idx].text = text;
    }
    return id;
  };

  const terminal = (): string => {
    const id = `__t${terminalSeq++}`;
    byId.set(id, g.nodes.length);
    g.nodes.push({ id, text: "", shape: "ellipse", x: 0, y: 0, w: 26, h: 26 });
    return id;
  };

  // [*] 在箭头左边是起点、右边是终点，但都画成小圆点
  const resolve = (token: string): string => (token === "[*]" ? terminal() : ensure(token));

  for (const line of lines.slice(1)) {
    if (STATE_BAILOUT.test(line)) return null;
    if (/^(accTitle|accDescr|classDef|class|style)\b/i.test(line)) continue;
    if (/^direction\s+/i.test(line)) {
      const d = line.split(/\s+/)[1]?.toUpperCase();
      g.direction = d === "LR" || d === "RL" ? "LR" : "TB";
      continue;
    }

    // state "描述" as id   /   state id
    const decl = /^state\s+(?:"([^"]*)"\s+as\s+(\S+)|(\S+))\s*$/i.exec(line);
    if (decl) {
      if (decl[2]) ensure(decl[2], normalizeText(decl[1] ?? decl[2]));
      else if (decl[3]) ensure(decl[3]);
      continue;
    }

    // 转移：A --> B : 标签。
    // 状态名可以是中文，用正则里的 \w 会漏，所以直接按 --> 切开。
    const arrowAt = line.indexOf("-->");
    if (arrowAt > 0) {
      const left = line.slice(0, arrowAt).trim();
      const rest = line.slice(arrowAt + 3);
      const colon = rest.indexOf(":");
      const right = (colon === -1 ? rest : rest.slice(0, colon)).trim();
      const label = colon === -1 ? undefined : normalizeText(rest.slice(colon + 1));
      if (left && right) {
        g.edges.push({
          id: `e${edgeSeq++}`,
          from: resolve(left),
          to: resolve(right),
          label: label || undefined,
          arrow: "end",
          points: [],
        });
        continue;
      }
    }

    // 描述：id : 文字
    const colon = line.indexOf(":");
    if (colon > 0) {
      const id = line.slice(0, colon).trim();
      if (id && !/\s/.test(id)) {
        ensure(id, normalizeText(line.slice(colon + 1)));
        continue;
      }
    }

    // 单独一行的状态名
    if (!/\s/.test(line)) {
      ensure(line);
      continue;
    }
    // 没见过的写法：别硬撑，回落官方库
    return null;
  }

  if (!g.nodes.length) return null;
  return g;
}

// 能自己画就返回图，不能就返回 null（调用方回落 mermaid 官方库）
export function parseMermaid(src: string): DiagramGraph | null {
  const first = cleanLines(src)[0] ?? "";
  if (/^(flowchart|graph)\b/i.test(first)) return parseMermaidFlowchart(src);
  if (/^stateDiagram(-v2)?\b/i.test(first)) return parseMermaidState(src);
  return null;
}
