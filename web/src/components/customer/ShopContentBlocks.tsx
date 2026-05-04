import type { MockShopHome } from '../../data/mockShopHome';

type ShopContentBlocksProps = {
  data: MockShopHome;
};

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

  if (!hasText && !hasImages) return null;

  return (
    <section className="space-y-4 px-4 py-4">
      {hasText ? (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-gray-900">说明</h2>
          <div className="whitespace-pre-line rounded-xl bg-gray-50 px-3 py-3 text-[15px] leading-relaxed text-gray-800">
            {data.textContent}
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
