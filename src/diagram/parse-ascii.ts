// ASCII / Unicode 手绘图解析：把
//
//   +--------+      +--------+
//   |  读取  | ---> |  解析  |
//   +--------+      +--------+
//
// 这类图认成「方框 + 连线 + 箭头」，产出与 flow 图同一份 IR，于是它也能被
// 矢量化绘制、缩放、导出，将来也能直接拖着改。
//
// 做法是把字符网格当位图看：先找出闭合矩形（方框），再把剩下的线段字符连成
// 通路，两端各落在哪个方框上就是一条边；框外剩下的文字当成散落标签。
// 节点坐标直接来自网格，所以不需要跑自动排版——原图什么样，画出来就什么样。

import { measureText } from "./surface";
import { nodeFont } from "./layout";
import { emptyGraph, type DiagramEdge, type DiagramGraph, type DiagramTheme } from "./types";

const H = new Set([..."-─━═╌╍┈┉"]);
const V = new Set([..."|│┃║╎╏┊┋"]);
const TL = new Set([..."+┌╭╔┏"]);
const TR = new Set([..."+┐╮╗┓"]);
const BL = new Set([..."+└╰╚┗"]);
const BR = new Set([..."+┘╯╝┛"]);
const JUNC = new Set([..."+┼├┤┬┴╬╠╣╦╩╪╫"]);
const A_R = new Set([...">→▶▸➜➤"]);
const A_L = new Set([..."<←◀◂"]);
const A_U = new Set([..."^↑▲▴"]);
const A_D = new Set([..."v↓▼▾"]);
const DIAG = new Set([..."/\\"]);

const ANY_ARROW = new Set([...A_R, ...A_L, ...A_U, ...A_D]);
const LINEISH = new Set([...H, ...V, ...JUNC, ...TL, ...TR, ...BL, ...BR, ...ANY_ARROW, ...DIAG]);

// 左右紧挨着的字符是不是文字（字母 / 数字 / 汉字）；左边是宽字符时跳过它的 FILL 占位
const WORDY = /[\p{L}\p{N}]/u;
function wordyLeft(g: Grid, r: number, c: number): boolean {
  const ch = g.at(r, c - 1);
  return WORDY.test(ch === FILL ? g.at(r, c - 2) : ch);
}
const wordyRight = (g: Grid, r: number, c: number) => WORDY.test(g.at(r, c + 1));

// 也能当普通文字用的 ASCII 线条字符：字母 v，和 - / \ < > ^ | 这类标点
const ASCII_AMBIG = new Set([..."v-/\\<>^|"]);

// 有些线条字符有歧义，得看上下文：
// - 「+」可能是交叉/拐角，也可能是加号（如「返回类型 + confidence」）。只有四邻格里也有
//   线条字符时才当线条，被空格夹着的孤立 + 留在文本里。
// - 字母 v 只要贴着别的文字就是单词的一部分（receive、validate）。
// - - / \ < > ^ | 两边都贴着文字时是词内标点（server-side、and/or）；一边贴着文字的
//   仍算线条，这样 A->B 这种不留空格的写法照样能连上。
// - / \ 另外还要求周围 8 格里有别的线条字符，否则是文字里的分隔符。
function isLineCharAt(g: Grid, r: number, c: number): boolean {
  const ch = g.at(r, c);
  if (!LINEISH.has(ch)) return false;
  if (ASCII_AMBIG.has(ch)) {
    const l = wordyLeft(g, r, c);
    const rt = wordyRight(g, r, c);
    if (ch === "v") return !l && !rt;
    if (l && rt) return false;
    // 斜线得真的连着别的线；「input / auth」里孤零零的 / 是分隔符
    if (DIAG.has(ch)) {
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++)
          if ((dr || dc) && LINEISH.has(g.at(r + dr, c + dc))) return true;
      return false;
    }
    return true;
  }
  if (ch !== "+") return true;
  return (
    LINEISH.has(g.at(r - 1, c)) ||
    LINEISH.has(g.at(r + 1, c)) ||
    LINEISH.has(g.at(r, c - 1)) ||
    LINEISH.has(g.at(r, c + 1))
  );
}

// 方框侧边可以是竖线，也可以是 ├ ┤ 这类丁字接口（框上挂着连线时会出现）
const canV = (ch: string) => V.has(ch) || JUNC.has(ch) || A_U.has(ch) || A_D.has(ch);

// 走线用的方向判断：拐角只朝它自己的两个开口方向通。
// 比如 ┘ 只接「上」和「左」，若一律当成四向连通，两条擦肩而过的线会被粘成一条。
function canGo(ch: string, dr: number, dc: number): boolean {
  if (JUNC.has(ch)) return true; // + ┼ ├ ┬ … 四向
  if (dc !== 0) {
    if (H.has(ch) || A_R.has(ch) || A_L.has(ch)) return true;
    return dc === 1 ? TL.has(ch) || BL.has(ch) : TR.has(ch) || BR.has(ch);
  }
  if (V.has(ch) || A_U.has(ch) || A_D.has(ch)) return true;
  return dr === 1 ? TL.has(ch) || TR.has(ch) : BL.has(ch) || BR.has(ch);
}

type Cell = { r: number; c: number };
type Box = { r1: number; c1: number; r2: number; c2: number; id: string };

// 中日韩文字在等宽字体里占两格，作者也是按两格对齐画的框。
// 若按码元下标建网格，「|   源文件   |」的右边框就会比上边框的 + 早好几列，
// 整个方框识别不出来。所以网格按显示宽度建：宽字符占两列，第二列放占位符。
const FILL = "\u0000"; // 宽字符第二列的占位：既不是空格也不是线条，扫描时单独跳过

function isWide(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // 谚文字母
    (cp >= 0x2e80 && cp <= 0x303e) || // 部首、CJK 符号
    (cp >= 0x3041 && cp <= 0x33ff) || // 假名、注音、兼容符号
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) || // 汉字
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) || // 谚文音节
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) || // 全角
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f9ff) // emoji
  );
}

// 一个字符格所在网格；越界返回空格，省掉到处判边界
class Grid {
  rows: string[][]; // 按显示列存放：宽字符后面跟一个 FILL 占位
  h: number;
  w: number;
  constructor(text: string) {
    const raw = text
      .replace(/\r\n?/g, "\n")
      .replace(/\t/g, "    ")
      .split("\n");
    // 去掉首尾空行
    while (raw.length && !raw[0].trim()) raw.shift();
    while (raw.length && !raw[raw.length - 1].trim()) raw.pop();
    // 去掉共同缩进
    const indents = raw.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length);
    const cut = indents.length ? Math.min(...indents) : 0;
    this.rows = raw.map((line) => {
      const cells: string[] = [];
      for (const ch of line.slice(cut)) {
        cells.push(ch);
        if (isWide(ch)) cells.push(FILL);
      }
      return cells;
    });
    this.h = this.rows.length;
    this.w = Math.max(0, ...this.rows.map((l) => l.length));
  }
  at(r: number, c: number): string {
    if (r < 0 || r >= this.h || c < 0) return " ";
    return this.rows[r][c] ?? " ";
  }
  // 取一行某段列范围的可读文本（丢掉占位符）
  slice(r: number, c1: number, c2: number): string {
    if (r < 0 || r >= this.h) return "";
    return this.rows[r]
      .slice(c1, c2)
      .filter((ch) => ch !== FILL)
      .join("");
  }
}

// ===== 找方框：从左上角字符出发，试出最小的一个闭合矩形 =====
function findBoxes(g: Grid): Box[] {
  const found: Box[] = [];
  for (let r = 0; r < g.h; r++) {
    for (let c = 0; c < g.w; c++) {
      if (!TL.has(g.at(r, c))) continue;
      let box: Box | null = null;
      for (let c2 = c + 2; c2 < g.w && !box; c2++) {
        const top = g.at(r, c2);
        if (!TR.has(top)) {
          if (!H.has(top) && !JUNC.has(top)) break;
          continue;
        }
        // 上边必须连续
        let ok = true;
        for (let x = c + 1; x < c2 && ok; x++) ok = H.has(g.at(r, x)) || JUNC.has(g.at(r, x));
        if (!ok) break;
        for (let r2 = r + 2; r2 < g.h && !box; r2++) {
          if (!BL.has(g.at(r2, c)) || !BR.has(g.at(r2, c2))) {
            if (!canV(g.at(r2, c)) || !canV(g.at(r2, c2))) break;
            continue;
          }
          let sides = true;
          for (let y = r + 1; y < r2 && sides; y++) {
            sides = canV(g.at(y, c)) && canV(g.at(y, c2));
          }
          let bottom = sides;
          for (let x = c + 1; x < c2 && bottom; x++) {
            bottom = H.has(g.at(r2, x)) || JUNC.has(g.at(r2, x));
          }
          if (sides && bottom) box = { r1: r, c1: c, r2, c2, id: `n${found.length}` };
        }
      }
      if (box) found.push(box);
    }
  }
  // 小的优先；内部区域重叠的丢弃（于是嵌套时留内框、并排共用边框时两个都留）
  found.sort((a, b) => (a.r2 - a.r1) * (a.c2 - a.c1) - (b.r2 - b.r1) * (b.c2 - b.c1));
  const kept: Box[] = [];
  for (const b of found) {
    const clash = kept.some(
      (k) =>
        b.c1 + 1 <= k.c2 - 1 && k.c1 + 1 <= b.c2 - 1 && b.r1 + 1 <= k.r2 - 1 && k.r1 + 1 <= b.r2 - 1,
    );
    if (!clash) kept.push(b);
  }
  kept.forEach((b, i) => (b.id = `n${i}`));
  return kept;
}

// ===== 连线：把线段字符连通，两端落到哪个框上就是一条边 =====
// dir 是「从线头指向方框」的方向，用来把折线端点吸附到框的外边界上
type Attach = { box: Box; dir: [number, number]; tip: Cell; incoming: boolean };

// 线头允许跟方框之间隔几个空格（`|  A  | ---> |  B  |` 这种写法很常见）
const GAP_TOLERANCE = 4;

type TextRun = { r: number; c1: number; c2: number; s: string };
type Pending = { from: Attach; to: Attach; arrow: DiagramEdge["arrow"]; cells: Cell[] };

// 每行的连续文字聚成 run：跳过被占用的格子（有框模式：方框与连线格；无框模式：全放行），
// 也跳过线条字符——于是行内的 → 会把左右两段文字切成两个 run，正好成为一条边的两端。
function scanTextRuns(g: Grid, isTaken: (r: number, c: number) => boolean): TextRun[] {
  const texts: TextRun[] = [];
  for (let r = 0; r < g.h; r++) {
    let c = 0;
    while (c < g.w) {
      const ch = g.at(r, c);
      const usable = ch !== " " && ch !== FILL && !isTaken(r, c) && !isLineCharAt(g, r, c);
      if (!usable) {
        c++;
        continue;
      }
      let end = c;
      let buf = "";
      let gap = 0;
      for (let x = c; x < g.w; x++) {
        const cc = g.at(r, x);
        const free = !isTaken(r, x) && !isLineCharAt(g, r, x);
        if (!free) break;
        if (cc === FILL) {
          end = x; // 宽字符的后半格：算进跨度，但本身没有可读内容
          gap = 0;
        } else if (cc === " ") {
          gap++;
          if (gap > 1) break;
          buf += cc;
        } else {
          gap = 0;
          buf += cc;
          end = x;
        }
      }
      texts.push({ r, c1: c, c2: end, s: buf.trimEnd() });
      c = end + 1;
    }
  }
  return texts;
}

// 连线机制：把线段字符连成连通分量，分量端点探向方框/文本节点即成边。
// owner 是「格子 → 节点包围盒」；有框模式来自 findBoxes，无框模式来自文本 run。
function makeWiring(g: Grid, owner: Map<string, Box>) {
  const key = (r: number, c: number) => `${r},${c}`;

  // 线段格：不属于任何节点、且是线条字符
  const isLine = (r: number, c: number) =>
    !owner.has(key(r, c)) && isLineCharAt(g, r, c) && g.at(r, c) !== " ";

  // 邻接：本格朝那个方向能走，且邻格朝回来的方向也能走；斜杠额外走对角
  const neighbors = (r: number, c: number): Cell[] => {
    const ch = g.at(r, c);
    const out: Cell[] = [];
    const push = (rr: number, cc: number) => {
      if (isLine(rr, cc)) out.push({ r: rr, c: cc });
    };
    const step = (dr: number, dc: number) => {
      if (!canGo(ch, dr, dc) && !DIAG.has(ch)) return;
      if (!canGo(g.at(r + dr, c + dc), -dr, -dc)) return;
      push(r + dr, c + dc);
    };
    step(0, -1);
    step(0, 1);
    step(-1, 0);
    step(1, 0);
    if (ch === "\\") {
      push(r - 1, c - 1);
      push(r + 1, c + 1);
    } else if (ch === "/") {
      push(r - 1, c + 1);
      push(r + 1, c - 1);
    }
    return out;
  };

  // 连通分量
  const seen = new Set<string>();
  const components: Cell[][] = [];
  for (let r = 0; r < g.h; r++) {
    for (let c = 0; c < g.w; c++) {
      if (!isLine(r, c) || seen.has(key(r, c))) continue;
      const comp: Cell[] = [];
      const stack: Cell[] = [{ r, c }];
      seen.add(key(r, c));
      while (stack.length) {
        const cur = stack.pop()!;
        comp.push(cur);
        for (const nb of neighbors(cur.r, cur.c)) {
          if (seen.has(key(nb.r, nb.c))) continue;
          seen.add(key(nb.r, nb.c));
          stack.push(nb);
        }
      }
      components.push(comp);
    }
  }

  // 分量的哪些线头指向节点：从没有后继的一头朝外走，允许跨过几个空格
  const PROBE: Array<{ d: [number, number]; arrow: Set<string> }> = [
    { d: [0, -1], arrow: A_L },
    { d: [0, 1], arrow: A_R },
    { d: [-1, 0], arrow: A_U },
    { d: [1, 0], arrow: A_D },
  ];

  const attachmentsOf = (comp: Cell[]): Attach[] => {
    const inComp = new Set(comp.map((x) => key(x.r, x.c)));
    const list: Attach[] = [];
    const taken = new Set<string>();
    for (const cell of comp) {
      const ch = g.at(cell.r, cell.c);
      for (const { d, arrow } of PROBE) {
        const [dr, dc] = d;
        if (!canGo(ch, dr, dc) && !DIAG.has(ch)) continue;
        if (inComp.has(key(cell.r + dr, cell.c + dc))) continue; // 这头还连着线，不是端点
        for (let k = 1; k <= GAP_TOLERANCE; k++) {
          const rr = cell.r + dr * k;
          const cc = cell.c + dc * k;
          const b = owner.get(key(rr, cc));
          if (b) {
            const tag = `${b.id}@${cell.r},${cell.c},${dr},${dc}`;
            if (!taken.has(tag)) {
              taken.add(tag);
              list.push({ box: b, dir: d, tip: cell, incoming: arrow.has(ch) });
            }
            break;
          }
          const gap = g.at(rr, cc);
          if (gap !== " " && gap !== FILL) break; // 中间挡着别的东西，不算连上
        }
      }
    }
    return list;
  };

  // 分量内两点间的最短通路，用作折线
  const pathBetween = (comp: Cell[], a: Cell, b: Cell): Cell[] => {
    const inComp = new Set(comp.map((x) => key(x.r, x.c)));
    const prev = new Map<string, Cell | null>();
    prev.set(key(a.r, a.c), null);
    const queue: Cell[] = [a];
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++];
      if (cur.r === b.r && cur.c === b.c) break;
      for (const nb of neighbors(cur.r, cur.c)) {
        const k = key(nb.r, nb.c);
        if (!inComp.has(k) || prev.has(k)) continue;
        prev.set(k, cur);
        queue.push(nb);
      }
    }
    if (!prev.has(key(b.r, b.c))) return [a, b];
    const out: Cell[] = [];
    let cur: Cell | null = b;
    while (cur) {
      out.push(cur);
      cur = prev.get(key(cur.r, cur.c)) ?? null;
    }
    return out.reverse();
  };

  return { components, attachmentsOf, pathBetween };
}

// 把连通分量两端的吸附关系配成边（两种模式共用同一套配对规则）
function pairComponents(
  components: Cell[][],
  attachmentsOf: (comp: Cell[]) => Attach[],
  pathBetween: (comp: Cell[], a: Cell, b: Cell) => Cell[],
): Pending[] {
  const pending: Pending[] = [];
  for (const comp of components) {
    const att = attachmentsOf(comp);
    if (att.length < 2) continue;
    const targets = att.filter((a) => a.incoming);
    const sources = att.filter((a) => !a.incoming);
    const pairs: Array<[Attach, Attach, DiagramEdge["arrow"]]> = [];
    if (!targets.length) {
      // 没箭头：按出现顺序串起来，画成无向线
      for (let i = 1; i < att.length; i++) pairs.push([att[0], att[i], "none"]);
    } else if (!sources.length) {
      for (let i = 1; i < att.length; i++) pairs.push([att[0], att[i], "both"]);
    } else {
      for (const tgt of targets) {
        // 就近的那个源
        const src = sources.reduce((best, s) =>
          Math.hypot(s.tip.r - tgt.tip.r, s.tip.c - tgt.tip.c) <
          Math.hypot(best.tip.r - tgt.tip.r, best.tip.c - tgt.tip.c)
            ? s
            : best,
        );
        pairs.push([src, tgt, "end"]);
      }
    }
    for (const [from, to, arrow] of pairs) {
      if (from.box.id === to.box.id) continue;
      pending.push({ from, to, arrow, cells: pathBetween(comp, from.tip, to.tip) });
    }
  }
  return pending;
}

// pending → IR 边：端点吸附到节点外边界，折线抹掉共线的中间点
function edgesFromPending(
  pending: Pending[],
  px: (c: number) => number,
  py: (r: number) => number,
  cellW: number,
  cellH: number,
): DiagramEdge[] {
  // 线头所在格的中心线 × 节点朝向那一侧的边
  const boundary = (a: Attach) => {
    const [dr, dc] = a.dir;
    const cx = px(a.tip.c) + cellW / 2;
    const cy = py(a.tip.r) + cellH / 2;
    if (dr === 1) return { x: cx, y: py(a.box.r1) };
    if (dr === -1) return { x: cx, y: py(a.box.r2 + 1) };
    if (dc === 1) return { x: px(a.box.c1), y: cy };
    return { x: px(a.box.c2 + 1), y: cy };
  };

  return pending.map((p, i) => {
    const pts = [
      boundary(p.from),
      ...p.cells.map((c) => ({ x: px(c.c) + cellW / 2, y: py(c.r) + cellH / 2 })),
      boundary(p.to),
    ];
    const simp: typeof pts = [];
    for (const pt of pts) {
      const n = simp.length;
      if (n >= 2) {
        const a = simp[n - 2];
        const b = simp[n - 1];
        const dx1 = b.x - a.x;
        const dy1 = b.y - a.y;
        const dx2 = pt.x - b.x;
        const dy2 = pt.y - b.y;
        if (Math.abs(dx1 * dy2 - dx2 * dy1) < 0.01) {
          simp[n - 1] = pt;
          continue;
        }
      }
      simp.push(pt);
    }
    return {
      id: `e${i}`,
      from: p.from.box.id,
      to: p.to.box.id,
      arrow: p.arrow,
      points: simp,
    };
  });
}

// 行内注释：主流程旁边的「命中 → 返回确定类型」是在给分支加说明，不是另一张图。
// 按边把节点并成连通组，节点最多的那组是主图；其余组若整组的边都落在同一行，
// 就把这些边丢掉，两端文字回落成普通标签。
function dropSideNotes(pending: Pending[]): Pending[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let p = parent.get(x) ?? x;
    if (p !== x) {
      p = find(p);
      parent.set(x, p);
    }
    return p;
  };
  for (const p of pending) parent.set(find(p.from.box.id), find(p.to.box.id));

  const groups = new Map<string, { nodes: Set<string>; edges: Pending[] }>();
  for (const p of pending) {
    const root = find(p.from.box.id);
    const grp = groups.get(root) ?? { nodes: new Set<string>(), edges: [] };
    grp.nodes.add(p.from.box.id).add(p.to.box.id);
    grp.edges.push(p);
    groups.set(root, grp);
  }
  if (groups.size < 2) return pending;

  const all = [...groups.values()];
  const main = all.reduce((a, b) => (b.nodes.size > a.nodes.size ? b : a));
  const drop = new Set<Pending>();
  for (const grp of all) {
    if (grp === main) continue;
    const row = grp.edges[0].from.box.r1;
    if (grp.edges.every((p) => p.from.box.r1 === row && p.to.box.r1 === row)) {
      for (const p of grp.edges) drop.add(p);
    }
  }
  return pending.filter((p) => !drop.has(p));
}

// ===== 无框流程图：纯文字节点 + │ ▼ └── → 连线 =====
// 文本 run 直接当节点（角色相当于有框模式里的方框），连线机制完全复用。
// 被边连到的节点画成方框（矢量化后就是正经流程图），没连到的散落文字保持原样。
function parseBareFlow(g: Grid, theme: DiagramTheme): DiagramGraph | null {
  if (g.h < 3) return null;
  const runs = scanTextRuns(g, () => false);
  if (runs.length < 3) return null;

  const key = (r: number, c: number) => `${r},${c}`;
  const boxes: Box[] = runs.map((t, i) => ({ r1: t.r, c1: t.c1, r2: t.r, c2: t.c2, id: `n${i}` }));
  const owner = new Map<string, Box>();
  for (const b of boxes) {
    for (let c = b.c1; c <= b.c2; c++) owner.set(key(b.r1, c), b);
  }

  const { components, attachmentsOf, pathBetween } = makeWiring(g, owner);
  const pending = dropSideNotes(pairComponents(components, attachmentsOf, pathBetween));

  // 误伤门槛：节点 ≥3、边 ≥2、带箭头的边 ≥1（tree 输出之类没有箭头，在这里被挡下）
  const attached = new Set<string>();
  let arrowed = 0;
  for (const p of pending) {
    attached.add(p.from.box.id);
    attached.add(p.to.box.id);
    if (p.arrow !== "none") arrowed++;
  }
  if (attached.size < 3 || pending.length < 2 || arrowed < 1) return null;

  // 没连上边的文字按原文回落成标签：同一行相邻的两段之间若只隔着没被任何边用到的
  // 线条字符（比如注释「命中 → 返回确定类型」里的 →），就并成一段，箭头跟着原文保留
  const used = new Set(pending.flatMap((p) => p.cells.map((c) => key(c.r, c.c))));
  type Item = TextRun & { id: string; isNode: boolean };
  const items: Item[] = [];
  runs.forEach((t, i) => {
    const isNode = attached.has(boxes[i].id);
    const prev = items[items.length - 1];
    if (!isNode && prev && !prev.isNode && prev.r === t.r) {
      let free = true;
      for (let c = prev.c2 + 1; c < t.c1; c++) if (used.has(key(t.r, c))) free = false;
      if (free) {
        prev.c2 = t.c2;
        prev.s = g.slice(t.r, prev.c1, t.c2 + 1).trimEnd();
        return;
      }
    }
    items.push({ ...t, id: boxes[i].id, isNode });
  });

  // 网格 → 像素：字宽按最挤的文本节点反推（逻辑同有框模式）
  let cellW = 8.6;
  const cellH = 22;
  const font = nodeFont(theme);
  for (const t of items) {
    const need = measureText(t.s, font) + 20;
    const have = (t.c2 - t.c1 + 1) * cellW;
    if (need > have) cellW = Math.min(cellW * (need / have), 18);
  }

  const PAD = 14;
  const px = (c: number) => c * cellW + PAD;
  const py = (r: number) => r * cellH + PAD;

  const graph = emptyGraph("ascii");
  for (const t of items) {
    graph.nodes.push({
      id: t.id,
      text: t.s,
      lines: [t.s],
      shape: t.isNode ? "rect" : "text",
      x: px(t.c1),
      y: t.isNode ? py(t.r) : py(t.r) + 2,
      w: (t.c2 - t.c1 + 1) * cellW,
      h: t.isNode ? cellH : cellH - 4,
    });
  }
  graph.edges.push(...edgesFromPending(pending, px, py, cellW, cellH));

  graph.laidOut = true;
  graph.width = g.w * cellW + PAD * 2;
  graph.height = g.h * cellH + PAD * 2;
  return graph;
}

export function parseAscii(src: string, theme: DiagramTheme): DiagramGraph | null {
  const g = new Grid(src);
  if (g.h < 2) return null;
  const boxes = findBoxes(g);
  if (!boxes.length) return parseBareFlow(g, theme); // 没框：试试纯文字流程图

  const owner = new Map<string, Box>(); // 单元格 -> 所属方框（含边框与内部）
  const key = (r: number, c: number) => `${r},${c}`;
  for (const b of boxes) {
    for (let r = b.r1; r <= b.r2; r++) {
      for (let c = b.c1; c <= b.c2; c++) owner.set(key(r, c), b);
    }
  }

  const { components, attachmentsOf, pathBetween } = makeWiring(g, owner);
  const pending = pairComponents(components, attachmentsOf, pathBetween);

  // ===== 框外散落文字：当作无边框文本节点，保住原图里的注释 / 分支标签 =====
  const consumedText = new Set<string>();
  for (const comp of components) for (const cell of comp) consumedText.add(key(cell.r, cell.c));
  const texts = scanTextRuns(g, (r, c) => owner.has(key(r, c)) || consumedText.has(key(r, c)));

  // ===== 网格 → 像素：字宽按最挤的那个方框反推，保证文字放得下又不破坏原有对齐 =====
  let cellW = 8.6;
  const cellH = 22;
  const font = nodeFont(theme);
  const boxTexts = new Map<string, string>();
  for (const b of boxes) {
    const lines: string[] = [];
    for (let r = b.r1 + 1; r < b.r2; r++) {
      const line = g.slice(r, b.c1 + 1, b.c2).trim();
      if (line) lines.push(line);
    }
    const text = lines.join("\n");
    boxTexts.set(b.id, text);
    const need = Math.max(0, ...lines.map((l) => measureText(l, font))) + 20;
    const have = (b.c2 - b.c1 + 1) * cellW;
    if (need > have) cellW = Math.min(cellW * (need / have), 18);
  }
  for (const t of texts) {
    const need = measureText(t.s, font);
    const have = (t.c2 - t.c1 + 1) * cellW;
    if (need > have) cellW = Math.min(cellW * (need / have), 18);
  }

  const PAD = 14;
  const px = (c: number) => c * cellW + PAD;
  const py = (r: number) => r * cellH + PAD;

  const graph = emptyGraph("ascii");
  for (const b of boxes) {
    const text = boxTexts.get(b.id) ?? "";
    graph.nodes.push({
      id: b.id,
      text,
      lines: text ? text.split("\n") : [],
      shape: "rect",
      x: px(b.c1),
      y: py(b.r1),
      w: (b.c2 - b.c1 + 1) * cellW,
      h: (b.r2 - b.r1 + 1) * cellH,
    });
  }
  texts.forEach((t, i) => {
    graph.nodes.push({
      id: `t${i}`,
      text: t.s,
      lines: [t.s],
      shape: "text",
      x: px(t.c1),
      y: py(t.r) + 2,
      w: (t.c2 - t.c1 + 1) * cellW,
      h: cellH - 4,
    });
  });

  graph.edges.push(...edgesFromPending(pending, px, py, cellW, cellH));

  graph.laidOut = true;
  graph.width = g.w * cellW + PAD * 2;
  graph.height = g.h * cellH + PAD * 2;
  // 只有孤零零一个框、也没有连线，多半不是流程图，交回文本渲染
  if (graph.nodes.filter((n) => n.shape === "rect").length < 2 && !graph.edges.length) return null;
  return graph;
}
