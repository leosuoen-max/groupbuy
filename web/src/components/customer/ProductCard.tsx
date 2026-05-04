import type { MockProduct } from '../../data/mockShopHome';
import { formatMYR } from '../../lib/formatMYR';
import { getEffectivePrice } from '../../lib/productPrice';
import { formatRemainingShort } from '../../lib/countdown';

type ProductCardProps = {
  product: MockProduct;
  quantity: number;
  now: Date;
  themeColor: string;
  onInc: () => void;
  onDec: () => void;
};

export function ProductCard({
  product,
  quantity,
  now,
  themeColor,
  onInc,
  onDec,
}: ProductCardProps) {
  const { unit, isDiscount, discountEndsAt } = getEffectivePrice(product, now);
  const soldOut = product.stock <= 0;
  const canInc = !soldOut && quantity < product.stock;
  const btn =
    'flex h-11 min-w-[2.75rem] items-center justify-center rounded-lg text-lg font-semibold transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40';

  const earlyLeft =
    isDiscount && discountEndsAt
      ? formatRemainingShort(discountEndsAt, now)
      : null;

  const row = (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[17px] font-semibold text-gray-900">
              {product.name}
            </span>
            {isDiscount ? (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900">
                早鸟价
              </span>
            ) : null}
          </div>
          {product.note ? (
            <p className="text-sm text-gray-500">{product.note}</p>
          ) : null}
        </div>
      </div>
      <div className="mt-1 flex flex-wrap items-end gap-2">
        {isDiscount ? (
          <span className="text-sm text-gray-400 line-through">
            {formatMYR(product.price)}
          </span>
        ) : null}
        <span
          className="text-lg font-bold"
          style={{ color: themeColor }}
        >
          {formatMYR(unit)}
        </span>
        <span className="text-sm text-gray-500">余量 {product.stock}</span>
      </div>
      {isDiscount && earlyLeft ? (
        <p className="text-xs text-amber-800">还剩 {earlyLeft}</p>
      ) : null}
    </div>
  );

  const controls = (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        className={`${btn} border border-gray-200 bg-white text-gray-700`}
        onClick={onDec}
        disabled={quantity <= 0}
        aria-label="减少"
      >
        −
      </button>
      <span className="min-w-[1.5rem] text-center text-base font-semibold tabular-nums">
        {quantity}
      </span>
      <button
        type="button"
        className={`${btn} text-white`}
        style={{ backgroundColor: canInc ? themeColor : '#9ca3af' }}
        onClick={onInc}
        disabled={!canInc}
        aria-label="增加"
      >
        +
      </button>
    </div>
  );

  if (product.imageUrl) {
    return (
      <article className="flex gap-3 border-b border-gray-100 py-4 last:border-b-0">
        <img
          src={product.imageUrl}
          alt=""
          className="h-20 w-20 shrink-0 rounded-lg object-cover"
          loading="lazy"
        />
        <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
          {row}
          {controls}
        </div>
      </article>
    );
  }

  return (
    <article className="flex items-start justify-between gap-2 border-b border-gray-100 py-4 last:border-b-0">
      <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
        {row}
        {controls}
      </div>
    </article>
  );
}
