import type { MockShopHome } from '../data/mockShopHome';

export type MixedLine =
  | { type: 'heading'; text: string }
  | { type: 'text'; text: string }
  | { type: 'image-large'; url: string }
  | { type: 'image-small'; urls: string[] }
  | { type: 'video'; url: string }
  | { type: 'audio'; url: string }
  | { type: 'file'; name: string; url: string }
  | { type: 'location'; url: string };

export function parseMixedText(raw: string): MixedLine[] {
  const out: MixedLine[] = [];
  for (const lineRaw of raw.split('\n')) {
    const line = lineRaw.trim();
    if (!line) {
      out.push({ type: 'text', text: '' });
      continue;
    }
    if (line.startsWith('【大图】')) {
      const url = line.replace('【大图】', '').trim();
      if (url) out.push({ type: 'image-large', url });
      continue;
    }
    if (line.startsWith('【小图】')) {
      const urls = line
        .replace('【小图】', '')
        .split('|')
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 3);
      if (urls.length) out.push({ type: 'image-small', urls });
      continue;
    }
    if (line.startsWith('【视频】')) {
      const url = line.replace('【视频】', '').trim();
      if (url) out.push({ type: 'video', url });
      continue;
    }
    if (line.startsWith('【录音】')) {
      const url = line.replace('【录音】', '').trim();
      if (url) out.push({ type: 'audio', url });
      continue;
    }
    if (line.startsWith('【定位】')) {
      const url = line.replace('【定位】', '').trim();
      if (url) out.push({ type: 'location', url });
      continue;
    }
    if (line.startsWith('【文件】')) {
      const rest = line.replace('【文件】', '').trim();
      const parts = rest.split(' ');
      const url = parts.pop() ?? '';
      const name = parts.join(' ').trim() || '文件';
      if (url) out.push({ type: 'file', name, url });
      continue;
    }
    if (line.startsWith('# ')) {
      const text = line.slice(2).trim();
      if (text) {
        out.push({ type: 'heading', text });
        continue;
      }
    }
    if (line.startsWith('【标题】')) {
      const text = line.replace('【标题】', '').trim();
      if (text) {
        out.push({ type: 'heading', text });
        continue;
      }
    }
    out.push({ type: 'text', text: lineRaw });
  }
  return out;
}

export function stripLeadingDuplicateProjectTitle(
  lines: MixedLine[],
  projectTitle: string
): MixedLine[] {
  const target = projectTitle.trim();
  if (!target) return lines;

  let start = 0;
  while (start < lines.length) {
    const line = lines[start];
    if (line.type === 'heading' && line.text.trim() === target) {
      start += 1;
      continue;
    }
    if (
      line.type === 'text' &&
      line.text.trim() === target &&
      !line.text.includes('\n')
    ) {
      start += 1;
      continue;
    }
    if (line.type === 'text' && line.text.trim() === '') {
      start += 1;
      continue;
    }
    break;
  }
  return lines.slice(start);
}

export function mixedLinesHaveRenderableContent(lines: MixedLine[]): boolean {
  return lines.some((line) => {
    if (line.type === 'text') return Boolean(line.text.trim());
    if (line.type === 'heading') return Boolean(line.text.trim());
    return true;
  });
}

/** 店铺首页公告区是否应展示（与嵌入卡片去重规则一致） */
export function shopHomeAnnouncementHasVisibleBody(data: MockShopHome): boolean {
  if (data.imageBlocks.length > 0) return true;
  const raw = data.textContent?.trim();
  if (!raw) return false;
  const lines = stripLeadingDuplicateProjectTitle(parseMixedText(raw), data.projectTitle);
  return mixedLinesHaveRenderableContent(lines);
}
