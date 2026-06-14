// 轻量国际化：手写词典 + t()，无第三方依赖，风格与项目其余部分一致。
// 默认跟随系统语言，可手动切换并持久化；目前支持中文 / 英文。

export type Locale = "zh" | "en";

const LANG_KEY = "lang"; // localStorage：未设置时跟随系统

type Dict = Record<string, string>;

const messages: Record<Locale, Dict> = {
  zh: {
    "app.tagline": "素净的 Markdown 阅读器",
    "drop.hint": "松手打开 Markdown 文件",
    "theme.toLight": "切换浅色",
    "theme.toDark": "切换深色",
    "lang.switch": "切换语言",
    "code.copy": "复制",
    "table.wrap": "折行",
    "table.nowrap": "不折行",
    "img.failed": "图片加载失败：{path}",
    "file.dialogName": "Markdown",
    "file.readError": "无法打开文件",
    "update.title": "73·素 有更新",
    "update.prompt": "发现新版本 {version}，现在更新吗？",
    "update.ok": "更新并重启",
    "update.cancel": "稍后",
  },
  en: {
    "app.tagline": "A clean Markdown reader",
    "drop.hint": "Drop to open a Markdown file",
    "theme.toLight": "Switch to light",
    "theme.toDark": "Switch to dark",
    "lang.switch": "Switch language",
    "code.copy": "Copy",
    "table.wrap": "Wrap",
    "table.nowrap": "No wrap",
    "img.failed": "Failed to load image: {path}",
    "file.dialogName": "Markdown",
    "file.readError": "Couldn't open file",
    "update.title": "73·素 — Update available",
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
