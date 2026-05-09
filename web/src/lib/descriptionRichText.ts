/**
 * 在 s[start] 处若以 open 开头，则找到与其配对的 close（支持嵌套相同 open）。
 */
export function findBalancedWrapperEnd(
  s: string,
  start: number,
  open: string,
  close: string
): { inner: string; endExclusive: number } | null {
  if (!s.startsWith(open, start)) return null;
  let depth = 1;
  let i = start + open.length;
  while (i < s.length && depth > 0) {
    if (s.startsWith(open, i)) {
      depth += 1;
      i += open.length;
    } else if (s.startsWith(close, i)) {
      depth -= 1;
      if (depth === 0) {
        return {
          inner: s.slice(start + open.length, i),
          endExclusive: i + close.length,
        };
      }
      i += close.length;
    } else {
      i += 1;
    }
  }
  return null;
}

export function escapeHtml(t: string): string {
  return t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function boldMarkersToHtml(chunk: string): string {
  const parts = chunk.split(/(\*\*[\s\S]*?\*\*)/g);
  return parts
    .map((p) => {
      if (p.startsWith('**') && p.endsWith('**') && p.length >= 4) {
        return `<strong class="desc-ed-bold font-bold text-gray-900" style="font-weight:700">${escapeHtml(p.slice(2, -2))}</strong>`;
      }
      return escapeHtml(p);
    })
    .join('');
}

/** 单行标记串 → 编辑器内可渲染的 HTML（顾客端仍存标记串） */
export function markersLineToHtml(line: string): string {
  if (!line) return '';
  let i = 0;
  let out = '';
  while (i < line.length) {
    if (line.startsWith('〔小〕', i)) {
      const m = findBalancedWrapperEnd(line, i, '〔小〕', '〔/小〕');
      if (m) {
        out += `<span class="desc-ed-sm-layer leading-snug text-gray-800" style="font-size:0.875em">${markersLineToHtml(m.inner)}</span>`;
        i = m.endExclusive;
        continue;
      }
      out += escapeHtml(line.slice(i, i + 3));
      i += 3;
      continue;
    }
    if (line.startsWith('〔大〕', i)) {
      const m = findBalancedWrapperEnd(line, i, '〔大〕', '〔/大〕');
      if (m) {
        out += `<span class="desc-ed-lg-layer leading-snug text-gray-900" style="font-size:1.125em">${markersLineToHtml(m.inner)}</span>`;
        i = m.endExclusive;
        continue;
      }
      out += escapeHtml(line.slice(i, i + 3));
      i += 3;
      continue;
    }
    let next = line.length;
    const a = line.indexOf('〔小〕', i);
    const b = line.indexOf('〔大〕', i);
    if (a >= 0) next = Math.min(next, a);
    if (b >= 0) next = Math.min(next, b);
    const chunk = line.slice(i, next);
    out += boldMarkersToHtml(chunk);
    i = next;
  }
  return out;
}

/** contenteditable 根节点 → 单行标记串（与 Firestore 存储格式一致） */
export function htmlLineToMarkers(root: HTMLElement): string {
  let out = '';
  for (const child of root.childNodes) {
    out += nodeToMarkers(child);
  }
  return out;
}

function nodeToMarkers(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as HTMLElement;
  const tag = el.tagName;
  if (tag === 'BR') return '';
  if (tag === 'STRONG' || tag === 'B') {
    const inner = walkChildren(el);
    return inner ? `**${inner}**` : '';
  }
  if (tag === 'SPAN') {
    if (
      el.classList.contains('desc-ed-sm-layer') ||
      el.classList.contains('desc-ed-sm')
    ) {
      return `〔小〕${walkChildren(el)}〔/小〕`;
    }
    if (
      el.classList.contains('desc-ed-lg-layer') ||
      el.classList.contains('desc-ed-lg')
    ) {
      return `〔大〕${walkChildren(el)}〔/大〕`;
    }
    return walkChildren(el);
  }
  return walkChildren(el);
}

function walkChildren(el: HTMLElement): string {
  let out = '';
  for (const c of el.childNodes) {
    out += nodeToMarkers(c);
  }
  return out;
}
