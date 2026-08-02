// 自动排版：把只有「节点 + 连线」的图算出坐标。走的是经典分层法（Sugiyama）的精简版：
//   去环 → 分层 → 长边插虚节点 → 层内排序（重心法） → 定 x → 生成正交折线
// ASCII 图自带坐标（laidOut=true），不进这里。

import { measureText } from "./surface";
import type { DiagramEdge, DiagramGraph, DiagramNode, DiagramTheme, Point } from "./types";

const PAD_X = 18; // 节点文字左右留白
const PAD_Y = 11; // 节点文字上下留白
const LINE_H = 18;
const MIN_W = 76;
const MIN_H = 40;
const MAX_TEXT_W = 190; // 超过就折行
const RANK_GAP = 54; // 层间距
const NODE_GAP = 34; // 同层节点间距
const MARGIN = 16; // 画布四周留白
const LABEL_CHIP_PAD = 14; // 边上文字底衬的左右留白合计，与 render.ts 的 LABEL_PAD_X 对应

// 手绘风用手写体（电路风的等宽字已经写在 theme.font 里）；
// 两处字体必须走同一个函数，否则排版量的宽度和真正画的对不上
export function nodeFont(t: DiagramTheme): string {
  // 霓虹的字浮在深底上，细字会被发光糊掉，加一档字重
  const weight = t.style === "neon" ? "600 " : "";
  return `${weight}${t.fontSize}px ${t.style === "sketch" ? t.handFont : t.font}`;
}

export function labelFont(t: DiagramTheme): string {
  return `${t.fontSize - 1}px ${t.style === "sketch" ? t.handFont : t.font}`;
}

// 按像素宽度折行：优先在空格处断，CJK 逐字断
export function wrapText(text: string, font: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    if (!para) {
      out.push("");
      continue;
    }
    if (measureText(para, font) <= maxWidth) {
      out.push(para);
      continue;
    }
    // 切成「词」：西文按空格，CJK 每字一份
    const tokens = para.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[^\s]+|\s+/gu) ?? [para];
    let line = "";
    for (const tk of tokens) {
      const next = line + tk;
      if (line && measureText(next.trim(), font) > maxWidth) {
        out.push(line.trim());
        line = /^\s+$/.test(tk) ? "" : tk;
      } else {
        line = next;
      }
    }
    if (line.trim()) out.push(line.trim());
  }
  return out.length ? out : [""];
}

// 量出节点尺寸：文字盒 + 形状补偿（菱形 / 平行四边形要多留空间）
export function sizeNode(node: DiagramNode, t: DiagramTheme) {
  // 状态图的起止圆点没有文字，得保持小圆点大小，不能按最小节点尺寸撑开
  if (!node.text.trim() && node.shape === "ellipse") {
    node.lines = [];
    node.w = 26;
    node.h = 26;
    return;
  }
  const font = nodeFont(t);
  const lines = wrapText(node.text, font, MAX_TEXT_W);
  node.lines = lines;
  const textW = Math.max(...lines.map((l) => measureText(l, font)), 0);
  let w = Math.max(MIN_W, textW + PAD_X * 2);
  let h = Math.max(MIN_H, lines.length * LINE_H + PAD_Y * 2);
  if (node.shape === "diamond") {
    w = Math.max(w * 1.45, textW + PAD_X * 3);
    h = Math.max(h * 1.5, lines.length * LINE_H + PAD_Y * 3);
  } else if (node.shape === "parallelogram" || node.shape === "trapezoid") {
    w += 22;
  } else if (node.shape === "hexagon") {
    w += 26;
  } else if (node.shape === "subroutine") {
    w += 20;
  } else if (node.shape === "cylinder") {
    h += 12;
  } else if (node.shape === "text") {
    w = textW;
    h = lines.length * LINE_H;
  }
  node.w = Math.round(w);
  node.h = Math.round(h);
}

// 分层时看的方向：回边按反向算，但 IR 里的 from/to 始终保持作者写的语义
// （画布编辑将来直接改这份模型，不能被排版的内部技巧污染）
const src = (e: DiagramEdge) => (e.reversed ? e.to : e.from);
const dst = (e: DiagramEdge) => (e.reversed ? e.from : e.to);

// ===== 去环：DFS 遇到指向「正在访问中」节点的边，只打上 reversed 标记 =====
function breakCycles(g: DiagramGraph) {
  const state = new Map<string, 0 | 1 | 2>(); // 0 未访问 1 访问中 2 已完成
  const out = new Map<string, DiagramEdge[]>();
  for (const e of g.edges) {
    if (e.from === e.to) continue; // 自环单独画，不参与分层
    (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e);
  }
  const visit = (id: string) => {
    state.set(id, 1);
    for (const e of out.get(id) ?? []) {
      const s = state.get(e.to) ?? 0;
      if (s === 1) e.reversed = true;
      else if (s === 0) visit(e.to);
    }
    state.set(id, 2);
  };
  for (const n of g.nodes) if ((state.get(n.id) ?? 0) === 0) visit(n.id);
}

// ===== 分层：最长路径法，节点排在「所有前驱之后」 =====
function assignRanks(g: DiagramGraph, edges: DiagramEdge[]): number {
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const n of g.nodes) {
    preds.set(n.id, []);
    succs.set(n.id, []);
  }
  for (const e of edges) {
    preds.get(dst(e))?.push(src(e));
    succs.get(src(e))?.push(dst(e));
  }
  const rank = new Map<string, number>();
  const indeg = new Map<string, number>();
  for (const n of g.nodes) indeg.set(n.id, preds.get(n.id)!.length);
  const queue = g.nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  for (const id of queue) rank.set(id, 0);
  let head = 0;
  while (head < queue.length) {
    const id = queue[head++];
    for (const to of succs.get(id) ?? []) {
      rank.set(to, Math.max(rank.get(to) ?? 0, (rank.get(id) ?? 0) + 1));
      indeg.set(to, (indeg.get(to) ?? 1) - 1);
      if (indeg.get(to) === 0) queue.push(to);
    }
  }
  let max = 0;
  for (const n of g.nodes) {
    const r = rank.get(n.id) ?? 0;
    n.rank = r;
    if (r > max) max = r;
  }
  return max;
}

type Chain = { edge: DiagramEdge; ids: string[] }; // 边经过的节点链（含首尾真实节点）

// ===== 长边打断：跨多层的边插虚节点，让每段只跨一层，折线才有落脚点 =====
function addDummies(g: DiagramGraph, edges: DiagramEdge[]): Chain[] {
  const chains: Chain[] = [];
  let seq = 0;
  for (const e of edges) {
    const from = g.nodes.find((n) => n.id === src(e))!;
    const to = g.nodes.find((n) => n.id === dst(e))!;
    const span = (to.rank ?? 0) - (from.rank ?? 0);
    const ids = [src(e)];
    for (let k = 1; k < span; k++) {
      const id = `__d${seq++}`;
      g.nodes.push({
        id,
        text: "",
        shape: "text",
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        rank: (from.rank ?? 0) + k,
        dummy: true,
      });
      ids.push(id);
    }
    ids.push(dst(e));
    chains.push({ edge: e, ids });
  }
  return chains;
}

// ===== 层内排序：先按 DFS 顺序铺，再做几轮重心法减少交叉 =====
function orderLayers(g: DiagramGraph, chains: Chain[], maxRank: number): string[][] {
  const layers: string[][] = Array.from({ length: maxRank + 1 }, () => []);
  const segSucc = new Map<string, string[]>();
  const segPred = new Map<string, string[]>();
  for (const c of chains) {
    for (let i = 0; i + 1 < c.ids.length; i++) {
      const a = c.ids[i];
      const b = c.ids[i + 1];
      (segSucc.get(a) ?? segSucc.set(a, []).get(a)!).push(b);
      (segPred.get(b) ?? segPred.set(b, []).get(b)!).push(a);
    }
  }
  // 初始顺序：从入度为 0 的节点 DFS，方向提示 left 的先走、right 的后走
  const hintOf = new Map<string, DiagramEdge["hint"]>();
  for (const c of chains) hintOf.set(`${c.ids[0]}>${c.ids[1]}`, c.edge.hint);
  const seen = new Set<string>();
  const push = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const node = g.nodes.find((n) => n.id === id);
    if (node) layers[node.rank ?? 0].push(id);
    const kids = [...(segSucc.get(id) ?? [])].sort((a, b) => {
      const rankHint = (x: string) => {
        const h = hintOf.get(`${id}>${x}`);
        return h === "left" ? -1 : h === "right" ? 1 : 0;
      };
      return rankHint(a) - rankHint(b);
    });
    for (const k of kids) push(k);
  };
  for (const n of g.nodes) if ((segPred.get(n.id) ?? []).length === 0) push(n.id);
  for (const n of g.nodes) push(n.id); // 兜住环里没有入口的部分

  // 重心法：向下、向上各扫几轮
  const posIn = (layer: string[]) => new Map(layer.map((id, i) => [id, i]));
  for (let iter = 0; iter < 4; iter++) {
    const downward = iter % 2 === 0;
    const range = downward
      ? [...layers.keys()].slice(1)
      : [...layers.keys()].slice(0, -1).reverse();
    for (const r of range) {
      const ref = posIn(layers[downward ? r - 1 : r + 1]);
      const cur = layers[r];
      const bary = new Map<string, number>();
      cur.forEach((id, i) => {
        const nb = (downward ? segPred.get(id) : segSucc.get(id)) ?? [];
        const ps = nb.map((x) => ref.get(x)).filter((x): x is number => x !== undefined);
        bary.set(id, ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : i);
      });
      cur.sort((a, b) => (bary.get(a) ?? 0) - (bary.get(b) ?? 0));
    }
  }
  layers.forEach((l) => l.forEach((id, i) => {
    const n = g.nodes.find((x) => x.id === id);
    if (n) n.order = i;
  }));
  return layers;
}

// ===== 定坐标 =====
// 分层方向（TB 时是纵向、LR 时是横向）叫「主轴」，层内展开的方向叫「次轴」。
// 两种方向共用同一套算法，只是主/次轴映射到 x 还是 y 不同。
type Axis = {
  mainSize: (n: DiagramNode) => number;
  crossSize: (n: DiagramNode) => number;
  setMain: (n: DiagramNode, v: number) => void;
  getMain: (n: DiagramNode) => number;
  setCross: (n: DiagramNode, v: number) => void;
  getCross: (n: DiagramNode) => number;
  point: (main: number, cross: number) => Point;
};

function axisOf(g: DiagramGraph): Axis {
  const lr = g.direction === "LR";
  return lr
    ? {
        mainSize: (n) => n.w,
        crossSize: (n) => n.h,
        setMain: (n, v) => (n.x = v),
        getMain: (n) => n.x,
        setCross: (n, v) => (n.y = v),
        getCross: (n) => n.y,
        point: (main, cross) => ({ x: main, y: cross }),
      }
    : {
        mainSize: (n) => n.h,
        crossSize: (n) => n.w,
        setMain: (n, v) => (n.y = v),
        getMain: (n) => n.y,
        setCross: (n, v) => (n.x = v),
        getCross: (n) => n.x,
        point: (main, cross) => ({ x: cross, y: main }),
      };
}

// 主轴按层厚累加；次轴先顺序铺开，再几轮往邻居中位数靠拢，减少连线折角
function assignCoords(g: DiagramGraph, layers: string[][], chains: Chain[]) {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const ax = axisOf(g);

  let main = MARGIN;
  for (const layer of layers) {
    const thick = Math.max(...layer.map((id) => ax.mainSize(byId.get(id)!)), 0);
    for (const id of layer) {
      const n = byId.get(id)!;
      ax.setMain(n, Math.round(main + (thick - ax.mainSize(n)) / 2));
    }
    main += thick + RANK_GAP;
  }

  for (const layer of layers) {
    let cross = MARGIN;
    for (const id of layer) {
      const n = byId.get(id)!;
      ax.setCross(n, cross);
      cross += ax.crossSize(n) + NODE_GAP;
    }
  }

  const succ = new Map<string, string[]>();
  const pred = new Map<string, string[]>();
  for (const c of chains) {
    for (let i = 0; i + 1 < c.ids.length; i++) {
      (succ.get(c.ids[i]) ?? succ.set(c.ids[i], []).get(c.ids[i])!).push(c.ids[i + 1]);
      (pred.get(c.ids[i + 1]) ?? pred.set(c.ids[i + 1], []).get(c.ids[i + 1])!).push(c.ids[i]);
    }
  }
  const center = (id: string) => {
    const n = byId.get(id)!;
    return ax.getCross(n) + ax.crossSize(n) / 2;
  };

  for (let iter = 0; iter < 6; iter++) {
    const downward = iter % 2 === 0;
    const order = downward ? [...layers.keys()] : [...layers.keys()].reverse();
    for (const r of order) {
      const layer = layers[r];
      if (!layer.length) continue;
      // 期望位置 = 相邻层里邻居的中心均值
      const want = layer.map((id) => {
        const nb = (downward ? pred.get(id) : succ.get(id)) ?? [];
        if (!nb.length) return center(id);
        return nb.reduce((a, b) => a + center(b), 0) / nb.length;
      });
      // 先求「最靠前的可行位置」作为下界
      const lower: number[] = [];
      let cursor = -Infinity;
      layer.forEach((id, i) => {
        const n = byId.get(id)!;
        const v = Math.max(want[i] - ax.crossSize(n) / 2, cursor);
        lower.push(v);
        cursor = v + ax.crossSize(n) + NODE_GAP;
      });
      // 再从后往前，在下界之上尽量贴近期望位置
      let limit = Infinity;
      for (let i = layer.length - 1; i >= 0; i--) {
        const n = byId.get(layer[i])!;
        const v = Math.min(Math.max(want[i] - ax.crossSize(n) / 2, lower[i]), limit - ax.crossSize(n));
        ax.setCross(n, v);
        limit = v - NODE_GAP;
      }
    }
  }

  // 归一化到左上角，算出画布尺寸
  const minCross = Math.min(...g.nodes.map((n) => ax.getCross(n)));
  const shift = MARGIN - minCross;
  for (const n of g.nodes) {
    ax.setCross(n, Math.round(ax.getCross(n) + shift));
    ax.setMain(n, Math.round(ax.getMain(n)));
  }
  g.width = Math.round(Math.max(...g.nodes.map((n) => n.x + n.w), 0) + MARGIN);
  g.height = Math.round(Math.max(...g.nodes.map((n) => n.y + n.h), 0) + MARGIN);
}

// 折线正交化：相邻两点若主轴、次轴都变了，就在主轴中点处打一个折
function orthogonalize(pts: Array<{ main: number; cross: number }>) {
  const out: Array<{ main: number; cross: number }> = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = out[out.length - 1];
    const b = pts[i];
    if (Math.abs(a.cross - b.cross) > 0.5 && Math.abs(a.main - b.main) > 0.5) {
      const mid = (a.main + b.main) / 2;
      out.push({ main: mid, cross: a.cross }, { main: mid, cross: b.cross });
    }
    out.push(b);
  }
  // 去掉共线的中间点
  const simp: typeof out = [];
  for (const p of out) {
    const n = simp.length;
    if (n >= 2) {
      const a = simp[n - 2];
      const b = simp[n - 1];
      const collinear =
        (Math.abs(a.cross - b.cross) < 0.5 && Math.abs(b.cross - p.cross) < 0.5) ||
        (Math.abs(a.main - b.main) < 0.5 && Math.abs(b.main - p.main) < 0.5);
      if (collinear) simp[n - 1] = p;
      else simp.push(p);
    } else if (n === 1) {
      const b = simp[0];
      if (Math.abs(b.main - p.main) < 0.5 && Math.abs(b.cross - p.cross) < 0.5) continue;
      simp.push(p);
    } else {
      simp.push(p);
    }
  }
  return simp;
}


// 折线上按总长度取 f（0~1）处的点
function pointAtFraction(pts: Point[], f: number): Point {
  let total = 0;
  const segs: number[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const d = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    segs.push(d);
    total += d;
  }
  const want = total * f;
  let acc = 0;
  for (let i = 0; i < segs.length; i++) {
    if (acc + segs[i] >= want) {
      const t = segs[i] ? (want - acc) / segs[i] : 0;
      return {
        x: pts[i].x + (pts[i + 1].x - pts[i].x) * t,
        y: pts[i].y + (pts[i + 1].y - pts[i].y) * t,
      };
    }
    acc += segs[i];
  }
  return pts[Math.floor(pts.length / 2)] ?? { x: 0, y: 0 };
}

// 折线中点（按长度），用来放标签
export function midpointOf(pts: Point[]): Point {
  return pointAtFraction(pts, 0.5);
}

// 折线在 f 处所在线段的单位法向量（用来把标签挪到线旁边）
function normalAt(pts: Point[], f: number): Point {
  let total = 0;
  const segs: number[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const d = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    segs.push(d);
    total += d;
  }
  const want = total * f;
  let acc = 0;
  let idx = 0;
  for (let i = 0; i < segs.length; i++) {
    idx = i;
    if (acc + segs[i] >= want) break;
    acc += segs[i];
  }
  const a = pts[idx];
  const b = pts[idx + 1] ?? pts[idx];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
}

type Rect = { x0: number; y0: number; x1: number; y1: number };

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

// 线段与矩形是否相交（Liang–Barsky 裁剪）：折线大多正交，但 left/right 提示会画出斜段
function segmentHitsRect(a: Point, b: Point, r: Rect): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const tests: Array<[number, number]> = [
    [-dx, a.x - r.x0],
    [dx, r.x1 - a.x],
    [-dy, a.y - r.y0],
    [dy, r.y1 - a.y],
  ];
  for (const [p, q] of tests) {
    if (p === 0) {
      if (q < 0) return false; // 平行且在外侧
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return true;
}

// 标签避让。底衬是最后画的（见 render.ts），压在别的边上就会在那条线里开个口子，
// 压在节点上更难看。所以沿自己这条边前后挪几档，能躲开就躲开；实在躲不开就回中点——
// 宁可穿一条线，也不能让文字飘到离自己的边很远的地方去。
export function placeLabels(g: DiagramGraph, t: DiagramTheme) {
  const font = labelFont(t);
  const chipH = t.fontSize + 9;
  const nodeBoxes: Rect[] = g.nodes
    .filter((n) => !n.dummy)
    .map((n) => ({ x0: n.x - 1, y0: n.y - 1, x1: n.x + n.w + 1, y1: n.y + n.h + 1 }));
  const placed: Rect[] = [];

  for (const e of g.edges) {
    if (!e.label || e.points.length < 2 || e.from === e.to) continue; // 自环的标签另有安排
    const halfW = (measureText(e.label, font) + LABEL_CHIP_PAD) / 2 + 2;
    const halfH = chipH / 2 + 2;
    const rectAt = (p: Point): Rect => ({
      x0: p.x - halfW,
      y0: p.y - halfH,
      x1: p.x + halfW,
      y1: p.y + halfH,
    });
    const clear = (r: Rect) => {
      if (nodeBoxes.some((b) => rectsOverlap(r, b))) return false;
      if (placed.some((b) => rectsOverlap(r, b))) return false;
      return !g.edges.some(
        (o) =>
          o !== e &&
          o.points.some((_, i) => i + 1 < o.points.length && segmentHitsRect(o.points[i], o.points[i + 1], r)),
      );
    };

    // 候选位：沿边前后挪几档，每档再试「贴着线的左右两侧」。
    // 侧移那两档等于让文字整个挪到线旁边，比压在线上更容易读——
    // 所以中点原位不行时优先试侧移，再考虑往边的两头走。
    const side = halfH + 1;
    let chosen: Point | null = null;
    search: for (const f of [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82]) {
      const p = pointAtFraction(e.points, f);
      const nrm = normalAt(e.points, f);
      for (const off of [0, side, -side]) {
        const c = { x: p.x + nrm.x * off, y: p.y + nrm.y * off };
        if (clear(rectAt(c))) {
          chosen = c;
          break search;
        }
      }
    }
    // 全躲不开就回中点：宁可穿一条线，也不能让文字飘到离自己的边很远的地方去
    const at = chosen ?? pointAtFraction(e.points, 0.5);
    e.labelAt = at;
    placed.push(rectAt(at));
  }
}

// 同一对节点间的多条边要错开多远：够让各自的标签底衬彼此让开
function labelSpan(group: DiagramEdge[], direction: string, t: DiagramTheme): number {
  if (!group.some((e) => e.label)) return 20;
  if (direction === "LR") return t.fontSize + 16; // 标签上下叠放，一行高度加点缝
  const font = labelFont(t);
  const widest = Math.max(
    ...group.map((e) => (e.label ? measureText(e.label, font) + LABEL_CHIP_PAD : 0)),
  );
  return Math.max(30, widest + 10);
}

// 生成每条边的折线
function routeEdges(g: DiagramGraph, chains: Chain[], t: DiagramTheme) {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const ax = axisOf(g);
  const mainEnd = (n: DiagramNode) => ax.getMain(n) + ax.mainSize(n);
  const crossMid = (n: DiagramNode) => ax.getCross(n) + ax.crossSize(n) / 2;

  for (const { edge, ids } of chains) {
    const first = byId.get(ids[0])!;
    const last = byId.get(ids[ids.length - 1])!;
    const raw: Array<{ main: number; cross: number }> = [];

    // 起点：默认从「主轴的出边」离开（TB 是底边、LR 是右边）。
    // flowchart.js 的 left/right 提示只在纵向布局下有意义。
    const sideHint =
      g.direction === "TB" && !edge.reversed && (edge.hint === "left" || edge.hint === "right");
    if (sideHint) {
      const sign = edge.hint === "right" ? 1 : -1;
      const cross = sign > 0 ? first.x + first.w : first.x;
      const main = first.y + first.h / 2;
      raw.push({ main, cross }, { main, cross: cross + sign * 26 });
    } else {
      raw.push({ main: mainEnd(first), cross: crossMid(first) });
    }

    for (let i = 1; i < ids.length - 1; i++) {
      const d = byId.get(ids[i])!;
      raw.push({ main: ax.getMain(d) + ax.mainSize(d) / 2, cross: crossMid(d) });
    }
    raw.push({ main: ax.getMain(last), cross: crossMid(last) });

    let pts = orthogonalize(raw).map((p) => ax.point(p.main, p.cross));
    if (edge.reversed) pts = pts.slice().reverse(); // 回边：画的方向要按原始 from→to
    edge.points = pts;
    edge.labelAt = midpointOf(pts);
  }

  // 同一对节点之间的多条边（状态机里 A→B 与 B→A 成对出现很常见）会几乎重叠，
  // 沿次轴把它们错开一点，标签也就不会叠在一起了。
  const groups = new Map<string, DiagramEdge[]>();
  for (const { edge } of chains) {
    const key = [edge.from, edge.to].sort().join("\u0000");
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(edge);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // 错开多少要看标签占多大：标签底衬是最后画的，压过所有连线，
    // 错得不够就会在旁边那条线上抠出一个缺口。
    // TB 时线左右排开、标签也左右相邻，按最宽的标签算；LR 时上下相邻，一行高度就够。
    const span = Math.min(labelSpan(group, g.direction, t), 200 / (group.length - 1));
    group.forEach((e, i) => {
      const shift = (i - (group.length - 1) / 2) * span;
      if (!shift) return;
      e.points = e.points.map((p) =>
        g.direction === "LR" ? { x: p.x, y: p.y + shift } : { x: p.x + shift, y: p.y },
      );
      e.labelAt = midpointOf(e.points);
    });
  }

  // 自环：在节点右侧画一个小回勾
  for (const e of g.edges) {
    if (e.from !== e.to || e.points.length) continue;
    const n = byId.get(e.from);
    if (!n) continue;
    const x = n.x + n.w;
    const y = n.y + n.h * 0.35;
    const y2 = n.y + n.h * 0.75;
    e.points = [
      { x, y },
      { x: x + 26, y },
      { x: x + 26, y: y2 },
      { x, y: y2 },
    ];
    e.labelAt = { x: x + 30, y: (y + y2) / 2 };
  }
}


export function layoutGraph(g: DiagramGraph, t: DiagramTheme) {
  if (g.laidOut) return g;
  if (!g.nodes.length) {
    g.width = 0;
    g.height = 0;
    return g;
  }
  for (const n of g.nodes) sizeNode(n, t);
  breakCycles(g);
  const linkEdges = g.edges.filter((e) => e.from !== e.to);
  const maxRank = assignRanks(g, linkEdges);
  const chains = addDummies(g, linkEdges);
  const layers = orderLayers(g, chains, Math.max(maxRank, ...g.nodes.map((n) => n.rank ?? 0)));
  assignCoords(g, layers, chains);
  routeEdges(g, chains, t);
  placeLabels(g, t);
  g.laidOut = true;
  return g;
}
