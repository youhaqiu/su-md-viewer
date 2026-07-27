// Typora 风格的 Markdown 编辑画布。
//
// 编辑器仍以 Markdown 纯文本为唯一数据源，但会把非当前行的语法标记收起，
// 并直接用最终排版显示标题、强调、链接、引用与代码。光标移入一行时，该行
// 的标记会立即显现，因此既保留了 Markdown 的可控性，也避免源码/预览来回切换。

import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
  drawSelection,
  keymap,
  placeholder,
} from "@codemirror/view";
import {
  EditorState,
  EditorSelection,
  Compartment,
  type Range,
} from "@codemirror/state";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  markdown,
  markdownKeymap,
  markdownLanguage,
} from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import {
  syntaxHighlighting,
  syntaxTree,
  HighlightStyle,
  indentOnInput,
  bracketMatching,
} from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

const MONO =
  'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

const lightHighlight = HighlightStyle.define([
  { tag: t.heading1, fontWeight: "650", color: "#202124" },
  { tag: t.heading2, fontWeight: "650", color: "#202124" },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], fontWeight: "650", color: "#25272a" },
  { tag: t.strong, fontWeight: "700", color: "#17181a" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "#76787d" },
  { tag: t.link, color: "var(--accent)", textDecoration: "underline" },
  { tag: t.url, color: "#8b8d92" },
  { tag: t.monospace, fontFamily: MONO, color: "#476582" },
  { tag: t.quote, color: "#62656a" },
  { tag: t.contentSeparator, color: "#a9aaad" },
  { tag: [t.processingInstruction, t.meta], color: "#aaa9a6" },
]);

const darkHighlight = HighlightStyle.define([
  { tag: t.heading1, fontWeight: "650", color: "#f1f1f0" },
  { tag: t.heading2, fontWeight: "650", color: "#f1f1f0" },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], fontWeight: "650", color: "#e7e7e5" },
  { tag: t.strong, fontWeight: "700", color: "#fff" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "#8e9095" },
  { tag: t.link, color: "var(--accent)", textDecoration: "underline" },
  { tag: t.url, color: "#777a80" },
  { tag: t.monospace, fontFamily: MONO, color: "#a8c5df" },
  { tag: t.quote, color: "#b0b1b5" },
  { tag: t.contentSeparator, color: "#66686d" },
  { tag: [t.processingInstruction, t.meta], color: "#6f7176" },
]);

const baseTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "16px",
    background: "var(--canvas)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "var(--reading-font)",
    lineHeight: "1.82",
    background: "var(--canvas)",
  },
  ".cm-content": {
    width: "100%",
    maxWidth: "820px",
    minHeight: "100%",
    margin: "0 auto",
    padding: "56px 40px 140px",
    caretColor: "var(--accent)",
  },
  ".cm-line": {
    padding: "2px 8px",
    borderRadius: "4px",
  },
  ".cm-activeLine": {
    background: "var(--editor-active-line)",
  },
  ".cm-selectionBackground, .cm-content ::selection": {
    background: "var(--accent-select) !important",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftWidth: "2px",
    borderLeftColor: "var(--accent)",
  },
  ".cm-md-hidden": {
    display: "none",
  },
  ".cm-md-marker": {
    color: "var(--syntax)",
    fontFamily: MONO,
    fontSize: "0.88em",
  },
  ".cm-md-h1": {
    fontSize: "2em",
    lineHeight: "1.35",
    fontWeight: "650",
    letterSpacing: "-0.025em",
    paddingTop: "16px",
    paddingBottom: "7px",
  },
  ".cm-md-h2": {
    fontSize: "1.5em",
    lineHeight: "1.45",
    fontWeight: "650",
    letterSpacing: "-0.018em",
    paddingTop: "14px",
    paddingBottom: "5px",
  },
  ".cm-md-h3": {
    fontSize: "1.22em",
    lineHeight: "1.55",
    fontWeight: "650",
    paddingTop: "11px",
    paddingBottom: "3px",
  },
  ".cm-md-h4": {
    fontSize: "1.06em",
    lineHeight: "1.65",
    fontWeight: "650",
    paddingTop: "8px",
  },
  ".cm-md-quote": {
    color: "var(--muted-text)",
    borderLeft: "3px solid var(--quote-border)",
    borderRadius: "0",
    paddingLeft: "17px",
  },
  ".cm-md-code-block": {
    background: "var(--code-bg)",
    color: "var(--text)",
    fontFamily: MONO,
    fontSize: "0.86em",
    lineHeight: "1.65",
    borderRadius: "0",
    paddingLeft: "18px",
    paddingRight: "18px",
  },
  ".cm-md-code-first": {
    borderRadius: "8px 8px 0 0",
    paddingTop: "11px",
  },
  ".cm-md-code-last": {
    borderRadius: "0 0 8px 8px",
    paddingBottom: "11px",
  },
  ".cm-md-rule": {
    color: "transparent",
    borderBottom: "1px solid var(--border)",
    height: "18px",
    marginBottom: "16px",
  },
  ".cm-md-frontmatter": {
    color: "var(--muted-text)",
    background: "var(--soft-bg)",
    fontFamily: "var(--ui-font)",
    fontSize: "0.8em",
    lineHeight: "1.65",
    paddingLeft: "16px",
    paddingRight: "16px",
    borderRadius: "0",
  },
  ".cm-md-frontmatter-first": {
    borderRadius: "8px 8px 0 0",
    paddingTop: "10px",
  },
  ".cm-md-frontmatter-last": {
    borderRadius: "0 0 8px 8px",
    paddingBottom: "10px",
    marginBottom: "18px",
  },
  ".cm-placeholder": {
    color: "var(--faint-text)",
    fontStyle: "normal",
  },
});

const lightTheme = EditorView.theme(
  {
    "&": { color: "#383a3e" },
  },
  { dark: false },
);

const darkTheme = EditorView.theme(
  {
    "&": { color: "#d1d1cf" },
  },
  { dark: true },
);

function themeFor(dark: boolean) {
  return [
    dark ? darkTheme : lightTheme,
    syntaxHighlighting(dark ? darkHighlight : lightHighlight),
  ];
}

const hidden = Decoration.replace({});
const marker = Decoration.mark({ class: "cm-md-marker" });

function activeLineBounds(view: EditorView): Array<{ from: number; to: number }> {
  return view.state.selection.ranges.map((range) => {
    const fromLine = view.state.doc.lineAt(range.from);
    const toLine = view.state.doc.lineAt(range.to);
    return { from: fromLine.from, to: toLine.to };
  });
}

function touchesActiveLine(
  from: number,
  to: number,
  active: Array<{ from: number; to: number }>,
): boolean {
  return active.some((line) => to >= line.from && from <= line.to);
}

function addLineClass(
  ranges: Range<Decoration>[],
  seen: Set<string>,
  view: EditorView,
  pos: number,
  className: string,
) {
  const line = view.state.doc.lineAt(pos);
  const key = `${line.from}:${className}`;
  if (seen.has(key)) return;
  seen.add(key);
  ranges.push(Decoration.line({ class: className }).range(line.from));
}

function frontmatterLines(view: EditorView): { first: number; last: number } | null {
  if (!view.state.doc.length || view.state.doc.line(1).text.trim() !== "---") return null;
  for (let n = 2; n <= Math.min(view.state.doc.lines, 80); n++) {
    if (view.state.doc.line(n).text.trim() === "---") return { first: 1, last: n };
  }
  return null;
}

function buildLivePreview(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const seenLines = new Set<string>();
  const active = activeLineBounds(view);
  const fm = frontmatterLines(view);

  if (fm) {
    for (let n = fm.first; n <= fm.last; n++) {
      const line = view.state.doc.line(n);
      addLineClass(ranges, seenLines, view, line.from, "cm-md-frontmatter");
      if (n === fm.first) addLineClass(ranges, seenLines, view, line.from, "cm-md-frontmatter-first");
      if (n === fm.last) addLineClass(ranges, seenLines, view, line.from, "cm-md-frontmatter-last");
      if ((n === fm.first || n === fm.last) && !touchesActiveLine(line.from, line.to, active)) {
        ranges.push(hidden.range(line.from, line.to));
      }
    }
  }

  for (const visible of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from: visible.from,
      to: visible.to,
      enter(node) {
        const name = node.name;
        const nodeLine = view.state.doc.lineAt(node.from).number;
        if (
          fm &&
          name !== "Document" &&
          nodeLine >= fm.first &&
          nodeLine <= fm.last
        ) {
          return false;
        }
        const activeNode = touchesActiveLine(node.from, node.to, active);

        if (/^ATXHeading[1-6]$/.test(name)) {
          const level = Number(name.slice(-1));
          addLineClass(ranges, seenLines, view, node.from, `cm-md-h${Math.min(level, 4)}`);
        } else if (name === "Blockquote") {
          const first = view.state.doc.lineAt(node.from).number;
          const last = view.state.doc.lineAt(node.to).number;
          for (let n = first; n <= last; n++) {
            addLineClass(ranges, seenLines, view, view.state.doc.line(n).from, "cm-md-quote");
          }
        } else if (name === "FencedCode") {
          const first = view.state.doc.lineAt(node.from).number;
          const last = view.state.doc.lineAt(node.to).number;
          for (let n = first; n <= last; n++) {
            const line = view.state.doc.line(n);
            addLineClass(ranges, seenLines, view, line.from, "cm-md-code-block");
            if (n === first) addLineClass(ranges, seenLines, view, line.from, "cm-md-code-first");
            if (n === last) addLineClass(ranges, seenLines, view, line.from, "cm-md-code-last");
          }
        } else if (name === "HorizontalRule") {
          if (activeNode) ranges.push(marker.range(node.from, node.to));
          else addLineClass(ranges, seenLines, view, node.from, "cm-md-rule");
        }

        const isMarkup = [
          "HeaderMark",
          "EmphasisMark",
          "CodeMark",
          "QuoteMark",
          "LinkMark",
        ].includes(name);
        const isLinkDestination =
          (name === "URL" || name === "LinkMark") &&
          ["Link", "Image"].includes(node.node.parent?.name ?? "");

        if (isMarkup || isLinkDestination) {
          ranges.push((activeNode ? marker : hidden).range(node.from, node.to));
        } else if (name === "ListMark") {
          // 列表符号保留，当前行用源码色提示，离开后弱化为排版符号。
          ranges.push(marker.range(node.from, node.to));
        }
      },
    });
  }

  return Decoration.set(ranges, true);
}

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildLivePreview(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.geometryChanged
      ) {
        this.decorations = buildLivePreview(update.view);
      }
    }
  },
  { decorations: (value) => value.decorations },
);

export interface MdEditor {
  getValue(): string;
  setValue(value: string): void;
  focus(): void;
  setDark(dark: boolean): void;
  setPlaceholder(text: string): void;
  refresh(): void;
}

function wrapSelection(view: EditorView, before: string, after = before): boolean {
  const transaction = view.state.changeByRange((range) => {
    const selected = view.state.sliceDoc(range.from, range.to);
    const insert = `${before}${selected}${after}`;
    const anchor = range.from + before.length;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: selected
        ? EditorSelection.range(anchor, anchor + selected.length)
        : EditorSelection.cursor(anchor),
    };
  });
  view.dispatch(transaction);
  return true;
}

export function createMdEditor(opts: {
  parent: HTMLElement;
  dark: boolean;
  onChange: (value: string) => void;
  placeholder: string;
}): MdEditor {
  const themeComp = new Compartment();
  const placeholderComp = new Compartment();
  let programmatic = false;

  const view = new EditorView({
    parent: opts.parent,
    state: EditorState.create({
      doc: "",
      extensions: [
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          spellcheck: "true",
          autocapitalize: "sentences",
        }),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        baseTheme,
        themeComp.of(themeFor(opts.dark)),
        livePreviewPlugin,
        placeholderComp.of(placeholder(opts.placeholder)),
        keymap.of([
          { key: "Mod-b", run: (view) => wrapSelection(view, "**") },
          { key: "Mod-i", run: (view) => wrapSelection(view, "*") },
          { key: "Mod-k", run: (view) => wrapSelection(view, "[", "](url)") },
          indentWithTab,
          ...markdownKeymap,
          ...historyKeymap,
          ...defaultKeymap,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !programmatic) {
            opts.onChange(update.state.doc.toString());
          }
        }),
      ],
    }),
  });

  return {
    getValue: () => view.state.doc.toString(),
    setValue(value) {
      programmatic = true;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
      programmatic = false;
    },
    focus: () => view.focus(),
    setDark(dark) {
      view.dispatch({ effects: themeComp.reconfigure(themeFor(dark)) });
    },
    setPlaceholder(text) {
      view.dispatch({ effects: placeholderComp.reconfigure(placeholder(text)) });
    },
    refresh: () => view.requestMeasure(),
  };
}
