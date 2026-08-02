// 统一图模型（IR）：所有「自渲染」的图（ASCII 手绘图、flowchart.js 的 flow 语法）
// 都先解析成这份结构，再由 layout 排版、render 画出来。
//
// 之所以中间隔一层而不是各画各的：一是几种来源能共用同一套排版 / 配色 / 导出；
// 二是这份结构本身就是「可编辑画布」的文档模型——节点带坐标尺寸、连线带折点，
// 后续拖拽编辑只需改这里的数值再重画，不必回头动解析器。

export type Point = { x: number; y: number };

// 节点形状。名字沿用流程图惯例：矩形=处理，菱形=判断，圆角/胶囊=起止，
// 平行四边形=输入输出，双竖线矩形=子程序，圆柱=存储，text=无边框的散落文字。
export type NodeShape =
  | "rect"
  | "round"
  | "stadium"
  | "diamond"
  | "ellipse"
  | "parallelogram"
  | "hexagon"
  | "trapezoid"
  | "subroutine"
  | "cylinder"
  | "text";

export type DiagramNode = {
  id: string;
  text: string;
  shape: NodeShape;
  // 折行后的文本行（排版时算好，绘制直接用）
  lines?: string[];
  // 排版后的包围盒（IR 单位即 CSS px，左上角原点）
  x: number;
  y: number;
  w: number;
  h: number;
  // 排版中间量：所在层与层内次序（ASCII 图直接带坐标，不参与分层）
  rank?: number;
  order?: number;
  // 虚节点：长边跨层时插入的占位点，不绘制，只用来生成折线
  dummy?: boolean;
};

export type EdgeArrow = "none" | "end" | "both";

export type DiagramEdge = {
  id: string;
  from: string;
  to: string;
  label?: string;
  dashed?: boolean;
  arrow: EdgeArrow;
  // flowchart.js 的方向提示：cond(yes,right)->io
  hint?: "right" | "left" | "top" | "bottom";
  // 排版后的折线（含起止点）
  points: Point[];
  // 标签锚点
  labelAt?: Point;
  // 分层时被反向过（回边），画箭头时要按原方向
  reversed?: boolean;
};

export type DiagramGraph = {
  kind: "flow" | "ascii";
  // 主方向：flow 默认自上而下；ASCII 图按原图坐标，不用这个
  direction: "TB" | "LR";
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  // 排版后的画布尺寸
  width: number;
  height: number;
  // 是否已带坐标（ASCII 图解析完就带；flow 图要跑 layout）
  laidOut: boolean;
};

// 绘制风格：
//   sketch  手绘草图（默认）
//   clean   规整线条
//   neon    霓虹发光：深底 + 主题色描边发光
//   glass   渐变玻璃：渐变填充 + 柔和投影 + 圆角走线
//   circuit 赛博电路：切角方框 + 等宽字 + 角标 + 网格底
export type DiagramStyle = "sketch" | "clean" | "neon" | "glass" | "circuit";

// 配色令牌：从 CSS 变量取，随深浅色 / 主题色实时变化
export type DiagramTheme = {
  style: DiagramStyle;
  // 绘制层眼里的深浅：霓虹 / 电路自带深底，跟应用主题无关
  dark: boolean;
  // 彩色开关：开了之后每个节点按顺序取一个色相（见 theme.tintFor），与风格正交
  colorful: boolean;
  bg: string;
  nodeFill: string;
  // 手绘风的斜线涂鸦色（比实心底色更跳一点，才看得出笔触）
  sketchFill: string;
  // 渐变填充的第二色（玻璃风的节点上浅下深；其余风格与 nodeFill 相同）
  nodeFill2: string;
  nodeStroke: string;
  nodeText: string;
  accent: string;
  accentSoft: string;
  line: string;
  labelText: string;
  labelBg: string;
  // 外发光色与半径（霓虹风；其余风格 glow=0）
  glowColor: string;
  glow: number;
  // 柔和投影（玻璃风；其余风格 shadow=0）
  shadow: number;
  shadowColor: string;
  font: string;
  // 手写体：正文标签在手绘风下用它
  handFont: string;
  monoFont: string;
  fontSize: number;
};

// 卡片底色由 CSS 按 data-style 铺，绘制层只需要知道「导出时该垫什么底」
export const STYLES: DiagramStyle[] = ["sketch", "clean", "neon", "glass", "circuit"];

export function emptyGraph(kind: DiagramGraph["kind"]): DiagramGraph {
  return {
    kind,
    direction: "TB",
    nodes: [],
    edges: [],
    width: 0,
    height: 0,
    laidOut: false,
  };
}

export function nodeById(g: DiagramGraph, id: string): DiagramNode | undefined {
  return g.nodes.find((n) => n.id === id);
}
