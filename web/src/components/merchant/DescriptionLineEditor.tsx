import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import {
  htmlLineToMarkers,
  markersLineToHtml,
} from '../../lib/descriptionRichText';

export type DescriptionLineEditorHandle = {
  focusEnd: () => void;
  focusStart: () => void;
  setCaretCharacterOffset: (offset: number) => void;
  /** 当前行可见纯文本长度（与 innerText 一致） */
  getPlainLength: () => number;
  /** 按光标拆成左右两段标记（插入素材前用，不修改 DOM） */
  extractSplitAtCaret: () => { left: string; right: string };
  toggleSmall: () => void;
  toggleLarge: () => void;
};

type Props = {
  value: string;
  onChange: (markers: string) => void;
  placeholder?: string;
  className?: string;
  lineIndex: number;
  /** 按回车拆行：左段、右段标记串 */
  onSplitLine: (leftMarkers: string, rightMarkers: string) => void;
  /** 在行首退格：与上行合并（仅 lineIndex&gt;0 时由父级处理） */
  onMergeWithPrevious: () => void;
  /** 光标在行首按上键 */
  onGoToPreviousLineEnd: () => void;
  /** 光标在行尾按下键 */
  onGoToNextLineStart: () => void;
  canMergeUp: boolean;
  hasLineAbove: boolean;
  hasLineBelow: boolean;
  onFocus?: () => void;
};

function setCaretAtTextOffset(root: HTMLElement, offset: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, offset);
  let node: Node | null = walker.nextNode();
  while (node) {
    const len = node.textContent?.length ?? 0;
    if (remaining <= len) {
      const range = document.createRange();
      range.setStart(node, remaining);
      range.collapse(true);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      return;
    }
    remaining -= len;
    node = walker.nextNode();
  }
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function getCaretPlainOffset(root: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel?.rangeCount || !root.contains(sel.anchorNode)) return 0;
  const range = sel.getRangeAt(0);
  const pre = document.createRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length;
}

export const DescriptionLineEditor = forwardRef<
  DescriptionLineEditorHandle,
  Props
>(function DescriptionLineEditor(
  {
    value,
    onChange,
    placeholder,
    className,
    lineIndex,
    onSplitLine,
    onMergeWithPrevious,
    onGoToPreviousLineEnd,
    onGoToNextLineStart,
    canMergeUp,
    hasLineAbove,
    hasLineBelow,
    onFocus,
  },
  ref
) {
  const divRef = useRef<HTMLDivElement>(null);
  const emittedRef = useRef<string | null>(null);

  const emit = () => {
    const el = divRef.current;
    if (!el) return;
    const m = htmlLineToMarkers(el);
    emittedRef.current = m;
    onChange(m);
  };

  useEffect(() => {
    const el = divRef.current;
    if (!el) return;
    if (value === emittedRef.current) return;
    emittedRef.current = value;
    el.innerHTML = markersLineToHtml(value);
  }, [value]);

  const ensureSelectionInside = (): boolean => {
    const s = window.getSelection();
    if (!s?.rangeCount || !divRef.current) return false;
    return divRef.current.contains(s.anchorNode);
  };

  /** 包装后仍选中同一范围（便于连续点稍大/稍小叠加） */
  const selectWrappedSpanContents = (span: HTMLElement) => {
    const root = divRef.current;
    if (!root?.contains(span)) return;
    root.focus();
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(span);
    sel.removeAllRanges();
    sel.addRange(range);
  };

  /** 每层使用 em 相对父级放大/缩小，多次点击可叠加 */
  const wrapSizeLarge = () => {
    if (!ensureSelectionInside()) return;
    const sel = window.getSelection()!;
    const r = sel.getRangeAt(0);
    if (r.collapsed) return;

    let wrapped: HTMLElement;
    try {
      const span = document.createElement('span');
      span.className = 'desc-ed-lg-layer leading-snug text-gray-900';
      span.style.fontSize = '1.125em';
      r.surroundContents(span);
      wrapped = span;
    } catch {
      const contents = r.extractContents();
      const span = document.createElement('span');
      span.className = 'desc-ed-lg-layer leading-snug text-gray-900';
      span.style.fontSize = '1.125em';
      span.appendChild(contents);
      r.insertNode(span);
      wrapped = span;
    }
    emit();
    selectWrappedSpanContents(wrapped);
  };

  const wrapSizeSmall = () => {
    if (!ensureSelectionInside()) return;
    const sel = window.getSelection()!;
    const r = sel.getRangeAt(0);
    if (r.collapsed) return;

    let wrapped: HTMLElement;
    try {
      const span = document.createElement('span');
      span.className = 'desc-ed-sm-layer leading-snug text-gray-800';
      span.style.fontSize = '0.875em';
      r.surroundContents(span);
      wrapped = span;
    } catch {
      const contents = r.extractContents();
      const span = document.createElement('span');
      span.className = 'desc-ed-sm-layer leading-snug text-gray-800';
      span.style.fontSize = '0.875em';
      span.appendChild(contents);
      r.insertNode(span);
      wrapped = span;
    }
    emit();
    selectWrappedSpanContents(wrapped);
  };

  const toggleSmall = () => wrapSizeSmall();

  const toggleLarge = () => wrapSizeLarge();

  const handleEnter = () => {
    const el = divRef.current;
    if (!el) return;
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    const r = sel.getRangeAt(0);
    const tail = document.createRange();
    tail.selectNodeContents(el);
    tail.setStart(r.startContainer, r.startOffset);
    const frag = tail.extractContents();
    const holder = document.createElement('div');
    holder.appendChild(frag);
    const rightMarkers = htmlLineToMarkers(holder);
    const leftMarkers = htmlLineToMarkers(el);
    emittedRef.current = leftMarkers;
    onSplitLine(leftMarkers, rightMarkers);
  };

  const extractSplitAtCaret = (): { left: string; right: string } => {
    const el = divRef.current;
    if (!el) return { left: '', right: '' };
    const sel = window.getSelection();
    if (!sel?.rangeCount || !el.contains(sel.anchorNode)) {
      return { left: htmlLineToMarkers(el), right: '' };
    }
    const r = sel.getRangeAt(0);
    const leftRange = document.createRange();
    leftRange.selectNodeContents(el);
    leftRange.setEnd(r.startContainer, r.startOffset);
    const hl = document.createElement('div');
    hl.appendChild(leftRange.cloneContents());
    const leftMarkers = htmlLineToMarkers(hl);

    const rightRange = document.createRange();
    rightRange.selectNodeContents(el);
    rightRange.setStart(r.startContainer, r.startOffset);
    const hr = document.createElement('div');
    hr.appendChild(rightRange.cloneContents());
    const rightMarkers = htmlLineToMarkers(hr);
    return { left: leftMarkers, right: rightMarkers };
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const el = divRef.current;
    if (!el) return;
    const val = el.innerText.replace(/\r/g, '');
    const pos = getCaretPlainOffset(el);
    const sel = window.getSelection();

    if (e.key === 'Enter') {
      e.preventDefault();
      handleEnter();
      return;
    }

    if (e.key === 'Backspace') {
      if (pos !== 0 || !canMergeUp) return;
      if (sel && !sel.isCollapsed) return;
      e.preventDefault();
      onMergeWithPrevious();
      return;
    }

    if (e.key === 'ArrowUp') {
      if (pos > 0) return;
      if (!hasLineAbove) return;
      e.preventDefault();
      onGoToPreviousLineEnd();
      return;
    }

    if (e.key === 'ArrowDown') {
      if (pos < val.length) return;
      if (!hasLineBelow) return;
      e.preventDefault();
      onGoToNextLineStart();
    }
  };

  useImperativeHandle(ref, () => ({
    focusEnd: () => {
      const el = divRef.current;
      if (!el) return;
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    },
    focusStart: () => {
      const el = divRef.current;
      if (!el) return;
      el.focus();
      setCaretAtTextOffset(el, 0);
    },
    setCaretCharacterOffset: (offset: number) => {
      const el = divRef.current;
      if (!el) return;
      el.focus();
      setCaretAtTextOffset(el, offset);
    },
    getPlainLength: () => divRef.current?.innerText.replace(/\r/g, '').length ?? 0,
    extractSplitAtCaret,
    toggleSmall,
    toggleLarge,
  }));

  const baseClass =
    className ??
    'min-h-[1.5rem] w-full cursor-text rounded-md px-0 py-0 text-[16px] leading-snug text-gray-900 outline-none';

  return (
    <div className="relative min-h-[1.5rem]">
      {!value.trim() ? (
        <span className="pointer-events-none absolute left-0 top-0.5 z-0 text-[15px] text-gray-400">
          {lineIndex === 0 ? placeholder ?? '输入描述说明' : ''}
        </span>
      ) : null}
      <div
        ref={divRef}
        className={`relative z-10 ${baseClass}`}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label={placeholder ?? '描述正文'}
        onInput={emit}
        onFocus={onFocus}
        onKeyDown={handleKeyDown}
        onPaste={(e) => {
          e.preventDefault();
          const t = e.clipboardData.getData('text/plain');
          document.execCommand('insertText', false, t);
          queueMicrotask(() => emit());
        }}
      />
    </div>
  );
});
