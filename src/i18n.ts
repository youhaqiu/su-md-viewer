// 轻量国际化：手写词典 + t()，无第三方依赖，风格与项目其余部分一致。
// 默认跟随系统语言，可手动切换并持久化；目前支持中文 / 英文。

export type Locale = "zh" | "en";

const LANG_KEY = "lang"; // localStorage：未设置时跟随系统

type Dict = Record<string, string>;

const messages: Record<Locale, Dict> = {
  zh: {
    "app.tagline": "素净的 Markdown 阅读器",
    "drop.hint": "松手打开文件",
    "lang.switch": "切换语言",
    // 外观浮层：深浅 / 主题色 / 正文字体三档并到一处
    "appearance.title": "外观",
    "appearance.mode": "深浅",
    "appearance.system": "跟随系统",
    "appearance.light": "浅色",
    "appearance.dark": "深色",
    "appearance.accent": "主题色",
    "appearance.font": "正文字体",
    "font.sans": "黑体",
    "font.serif": "宋体",
    "toc.toggle": "目录",
    "toc.title": "目录",
    "accent.coral": "珊瑚橙",
    "accent.indigo": "靛蓝",
    "accent.teal": "墨绿",
    "accent.violet": "紫罗兰",
    "code.copy": "复制",
    "diagram.style": "绘制风格",
    "diagram.styleSketch": "手绘",
    "diagram.styleClean": "规整",
    "diagram.styleNeon": "霓虹",
    "diagram.styleGlass": "玻璃",
    "diagram.styleCircuit": "电路",
    "diagram.colorful": "彩色",
    "diagram.zoomIn": "放大",
    "diagram.zoomOut": "缩小",
    "diagram.fit": "适应宽度",
    "diagram.source": "查看源码",
    "diagram.showDiagram": "查看图形",
    "diagram.copy": "复制源码",
    "diagram.export": "导出",
    "diagram.exportSvg": "导出 SVG",
    "diagram.exportPng": "导出 PNG",
    "diagram.collapseTools": "收起工具条",
    "diagram.expandTools": "展开工具条",
    "diagram.error": "这张图没能渲染出来，下面是原始内容：",
    "table.wrap": "折行",
    "table.nowrap": "不折行",
    "edit.toEdit": "编辑",
    "edit.toPreview": "完成编辑",
    "edit.save": "保存（⌘S）",
    "edit.saved": "已保存",
    "edit.live": "实时排版",
    "edit.stats": "字数 {chars}",
    "edit.placeholder": "从这里开始写作…",
    "edit.saveErrorTitle": "保存失败",
    "edit.saveError": "保存失败：{err}",
    "edit.discardTitle": "未保存的修改",
    "edit.discardConfirm": "有未保存的修改，确定放弃吗？",
    "edit.discardOk": "放弃",
    "edit.discardCancel": "取消",
    "hl.erase": "取消高亮",
    "hl.failed": "没法定位这段文字——换个选区，或在编辑模式里手动加 ==",
    "img.failed": "图片加载失败：{path}",
    "file.dialogName": "Markdown / 纯文本",
    "file.readError": "无法打开文件",
    "update.title": "73 有更新",
    "update.prompt": "发现新版本 {version}，现在更新吗？",
    "update.ok": "更新并重启",
    "update.cancel": "稍后",
  },
  en: {
    "app.tagline": "A clean Markdown reader",
    "drop.hint": "Drop to open a file",
    "lang.switch": "Switch language",
    "appearance.title": "Appearance",
    "appearance.mode": "Theme",
    "appearance.system": "System",
    "appearance.light": "Light",
    "appearance.dark": "Dark",
    "appearance.accent": "Accent",
    "appearance.font": "Reading font",
    "font.sans": "Sans",
    "font.serif": "Serif",
    "toc.toggle": "Outline",
    "toc.title": "Outline",
    "accent.coral": "Coral",
    "accent.indigo": "Indigo",
    "accent.teal": "Teal",
    "accent.violet": "Violet",
    "code.copy": "Copy",
    "diagram.style": "Diagram style",
    "diagram.styleSketch": "Hand-drawn",
    "diagram.styleClean": "Clean",
    "diagram.styleNeon": "Neon",
    "diagram.styleGlass": "Glass",
    "diagram.styleCircuit": "Circuit",
    "diagram.colorful": "Colorful",
    "diagram.zoomIn": "Zoom in",
    "diagram.zoomOut": "Zoom out",
    "diagram.fit": "Fit to width",
    "diagram.source": "View source",
    "diagram.showDiagram": "View diagram",
    "diagram.copy": "Copy source",
    "diagram.export": "Export",
    "diagram.exportSvg": "Export SVG",
    "diagram.exportPng": "Export PNG",
    "diagram.collapseTools": "Collapse toolbar",
    "diagram.expandTools": "Expand toolbar",
    "diagram.error": "This diagram couldn't be rendered. Original source below:",
    "table.wrap": "Wrap",
    "table.nowrap": "No wrap",
    "edit.toEdit": "Edit",
    "edit.toPreview": "Finish editing",
    "edit.save": "Save (⌘S)",
    "edit.saved": "Saved",
    "edit.live": "Live preview",
    "edit.stats": "{words} words · {chars} characters",
    "edit.placeholder": "Start writing…",
    "edit.saveErrorTitle": "Couldn't save",
    "edit.saveError": "Couldn't save: {err}",
    "edit.discardTitle": "Unsaved changes",
    "edit.discardConfirm": "You have unsaved changes. Discard them?",
    "edit.discardOk": "Discard",
    "edit.discardCancel": "Cancel",
    "hl.erase": "Remove highlight",
    "hl.failed": "Couldn't locate this text — try another selection, or add == in edit mode",
    "img.failed": "Failed to load image: {path}",
    "file.dialogName": "Markdown / Text",
    "file.readError": "Couldn't open file",
    "update.title": "73 — Update available",
    "update.prompt": "Version {version} is available. Update now?",
    "update.ok": "Update & restart",
    "update.cancel": "Later",
  },
};

function detectLocale(): Locale {
  const saved = localStorage.getItem(LANG_KEY);
  if (saved === "zh" || saved === "en") return saved;
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

let current: Locale = detectLocale();

export function getLocale(): Locale {
  return current;
}

// 设置语言并持久化（写 localStorage 会触发其他窗口的 storage 事件以同步）
export function setLocale(loc: Locale) {
  current = loc;
  localStorage.setItem(LANG_KEY, loc);
}

// 重新从存储读取（用于 storage 事件同步）
export function refreshLocale(): Locale {
  current = detectLocale();
  return current;
}

// 翻译；params 用 {key} 占位插值
export function t(key: string, params?: Record<string, string>): string {
  let s = messages[current][key] ?? messages.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, "g"), v);
    }
  }
  return s;
}

export const LANG_STORAGE_KEY = LANG_KEY;
