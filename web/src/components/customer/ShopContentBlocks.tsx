import type { MockShopHome } from '../../data/mockShopHome';

type ShopContentBlocksProps = {
  data: MockShopHome;
};

type MixedLine =
  | { type: 'heading'; text: string }
  | { type: 'text'; text: string }
  | { type: 'image-large'; url: string }
  | { type: 'image-small'; urls: string[] }
  | { type: 'video'; url: string }
  | { type: 'audio'; url: string }
  | { type: 'file'; name: string; url: string }
  | { type: 'location'; url: string };

function parseMixedText(raw: string): MixedLine[] {
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

function ImageGrid({ blocks }: { blocks: MockShopHome['imageBlocks'] }) {
  const n = blocks.length;
  if (n === 0) return null;

  if (n === 1) {
    const b = blocks[0];
    return (
      <figure className="overflow-hidden rounded-xl bg-gray-50">
        <img
          src={b.url}
          alt={b.caption ?? ''}
          className="max-h-80 w-full object-cover"
          loading="lazy"
        />
        {b.caption ? (
          <figcaption className="px-3 py-2 text-sm text-gray-600">
            {b.caption}
          </figcaption>
        ) : null}
      </figure>
    );
  }

  if (n === 2) {
    return (
      <div className="grid grid-cols-2 gap-2">
        {blocks.map((b, i) => (
          <figure
            key={i}
            className="overflow-hidden rounded-xl bg-gray-50"
          >
            <img
              src={b.url}
              alt={b.caption ?? ''}
              className="aspect-square w-full object-cover"
              loading="lazy"
            />
            {b.caption ? (
              <figcaption className="px-2 py-1.5 text-xs text-gray-600">
                {b.caption}
              </figcaption>
            ) : null}
          </figure>
        ))}
      </div>
    );
  }

  if (n === 3) {
    const [a, b, c] = blocks;
    return (
      <div className="grid grid-cols-2 grid-rows-2 gap-2">
        <figure className="row-span-2 overflow-hidden rounded-xl bg-gray-50">
          <img
            src={a.url}
            alt={a.caption ?? ''}
            className="h-full min-h-[11rem] w-full object-cover"
            loading="lazy"
          />
          {a.caption ? (
            <figcaption className="px-2 py-1.5 text-xs text-gray-600">
              {a.caption}
            </figcaption>
          ) : null}
        </figure>
        {[b, c].map((item, i) => (
          <figure
            key={i}
            className="overflow-hidden rounded-xl bg-gray-50"
          >
            <img
              src={item.url}
              alt={item.caption ?? ''}
              className="aspect-[4/3] w-full object-cover"
              loading="lazy"
            />
            {item.caption ? (
              <figcaption className="px-2 py-1 text-[11px] leading-snug text-gray-600">
                {item.caption}
              </figcaption>
            ) : null}
          </figure>
        ))}
      </div>
    );
  }

  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto pb-1">
      {blocks.map((b, i) => (
        <figure
          key={i}
          className="w-[72%] max-w-xs shrink-0 overflow-hidden rounded-xl bg-gray-50 snap-start"
        >
          <img
            src={b.url}
            alt={b.caption ?? ''}
            className="aspect-[4/3] w-full object-cover"
            loading="lazy"
          />
          {b.caption ? (
            <figcaption className="px-2 py-1.5 text-xs text-gray-600">
              {b.caption}
            </figcaption>
          ) : null}
        </figure>
      ))}
    </div>
  );
}

export function ShopContentBlocks({ data }: ShopContentBlocksProps) {
  const hasText = Boolean(data.textContent?.trim());
  const hasImages = data.imageBlocks.length > 0;
  const mixedLines = hasText ? parseMixedText(data.textContent ?? '') : [];

  if (!hasText && !hasImages) return null;

  return (
    <section className="space-y-5 px-4 py-4">
      {hasText ? (
        <div>
          <h2 className="mb-2 text-sm font-semibold tracking-wide text-gray-900">说明</h2>
          <div className="rounded-xl bg-gray-50 px-3 py-3.5 text-[16px] leading-7 text-gray-800">
            <div className="space-y-2.5">
              {mixedLines.map((line, idx) => {
                if (line.type === 'heading') {
                  return (
                    <h3
                      key={idx}
                      className="mb-1 border-l-4 border-amber-400 pl-3 text-[22px] font-semibold leading-tight tracking-wide text-gray-900"
                    >
                      {line.text}
                    </h3>
                  );
                }
                if (line.type === 'text') {
                  return (
                    <p key={idx} className="whitespace-pre-wrap break-words text-[16px] leading-7">
                      {line.text || '\u00A0'}
                    </p>
                  );
                }
                if (line.type === 'image-large') {
                  return (
                    <div key={idx} className="overflow-hidden rounded-lg bg-white">
                      <img
                        src={line.url}
                        alt=""
                        className="w-full object-contain"
                        loading="lazy"
                      />
                    </div>
                  );
                }
                if (line.type === 'image-small') {
                  return (
                    <div key={idx} className="grid grid-cols-3 gap-2">
                      {line.urls.map((u) => (
                        <img
                          key={u}
                          src={u}
                          alt=""
                          className="aspect-square w-full rounded-lg object-cover"
                          loading="lazy"
                        />
                      ))}
                    </div>
                  );
                }
                if (line.type === 'video') {
                  return <video key={idx} src={line.url} controls className="w-full rounded-lg" />;
                }
                if (line.type === 'audio') {
                  return <audio key={idx} src={line.url} controls className="w-full" />;
                }
                if (line.type === 'file') {
                  return (
                    <a key={idx} href={line.url} target="_blank" rel="noreferrer" className="text-indigo-600 underline">
                      {line.name}
                    </a>
                  );
                }
                return (
                  <a key={idx} href={line.url} target="_blank" rel="noreferrer" className="text-indigo-600 underline">
                    打开定位
                  </a>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {hasImages ? (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-gray-900">图册</h2>
          <ImageGrid blocks={data.imageBlocks} />
        </div>
      ) : null}
    </section>
  );
}
