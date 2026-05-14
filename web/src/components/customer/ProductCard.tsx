import { useState } from 'react';
import type { MockProduct } from '../../data/mockShopHome';
import { DESIGN_PRICE_TEAL } from '../../lib/shopTheme';
import { formatMYR } from '../../lib/formatMYR';
import { getEffectivePrice } from '../../lib/productPrice';
import { formatRemainingShort } from '../../lib/countdown';

type ProductCardProps = {
  product: MockProduct;
  quantity: number;
  now: Date;
  themeColor: string;
  accentColor?: string;
  onInc: () => void;
  onDec: () => void;
};

export function ProductCard({
  product,
  quantity,
  now,
  themeColor,
  accentColor,
  onInc,
  onDec,
}: ProductCardProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const { unit, isDiscount, discountType, discountEndsAt } = getEffectivePrice(product, now);
  const emphasisColor = accentColor ?? DESIGN_PRICE_TEAL;
  const soldOut = product.stock <= 0;
  const lowStock = !soldOut && product.stock <= 5;
  const canInc = !soldOut && quantity < product.stock;

  const earlyLeft =
    discountType === 'earlybird' && discountEndsAt
      ? formatRemainingShort(discountEndsAt, now)
      : null;
  const discountEndText =
    discountEndsAt != null
      ? new Date(discountEndsAt).toLocaleString('zh-CN', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })
      : null;

  const promoTag = isDiscount ? (
    <span
      className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold leading-none ${
        discountType === 'earlybird'
          ? 'bg-amber-100 text-amber-800'
          : 'bg-rose-100 text-rose-700'
      }`}
    >
      {discountType === 'earlybird' ? '早鸟价' : '特惠'}
    </span>
  ) : null;

  const stockChip = soldOut ? (
    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium leading-none text-slate-500">
      已售罄
    </span>
  ) : (
    <span
      className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold leading-none ${
        lowStock ? 'bg-orange-50 text-orange-700' : 'bg-teal-50'
      }`}
      style={lowStock ? undefined : { color: emphasisColor }}
    >
      余 {product.stock}
    </span>
  );

  const offIso = product.scheduledOffAt;
  const scheduleRemaining =
    offIso && new Date(offIso).getTime() > now.getTime()
      ? formatRemainingShort(offIso, now)
      : null;
  const scheduleEndShort =
    scheduleRemaining && offIso
      ? new Date(offIso).toLocaleString('zh-CN', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })
      : null;
  /** 与早鸟行同款：月/日 时:分 · 还剩 …，琥珀色 */
  const scheduleLine =
    scheduleRemaining && scheduleEndShort ? (
      <p className="text-[11px] leading-none text-amber-700">
        下架截止 {scheduleEndShort} · 还剩 {scheduleRemaining}
      </p>
    ) : null;

  const promoLine = isDiscount ? (
    <p
      className={`text-[11px] leading-none ${
        discountType === 'earlybird' ? 'text-amber-700' : 'text-rose-600'
      }`}
    >
      {discountType === 'earlybird'
        ? earlyLeft
          ? `早鸟截止 ${discountEndText ?? ''} · 还剩 ${earlyLeft}`
          : `早鸟截止 ${discountEndText ?? ''}`
        : discountEndText
          ? `特惠截止 ${discountEndText}`
          : '特惠进行中'}
    </p>
  ) : null;

  const promoFooter =
    promoLine || scheduleLine ? (
      <div className="flex flex-col gap-0.5">
        {promoLine}
        {scheduleLine}
      </div>
    ) : null;

  const priceBlock = (
    <div className="flex items-baseline gap-1.5">
      <span
        className="text-[17px] font-extrabold leading-none tracking-tight"
        style={{ color: soldOut ? '#94a3b8' : emphasisColor }}
      >
        {formatMYR(unit)}
      </span>
      {isDiscount ? (
        <span className="text-[12px] leading-none text-slate-400 line-through decoration-1">
          {formatMYR(product.price)}
        </span>
      ) : null}
    </div>
  );

  const stepper = (
    <div className="flex items-center gap-2">
      {quantity > 0 ? (
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-[18px] font-semibold leading-none text-slate-500 transition active:scale-95"
          onClick={onDec}
          aria-label="减少"
        >
          −
        </button>
      ) : null}
      {quantity > 0 ? (
        <span className="min-w-[1.4rem] text-center text-[15px] font-semibold tabular-nums text-slate-900">
          {quantity}
        </span>
      ) : null}
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center rounded-full text-[22px] font-light leading-none text-white shadow-[0_2px_8px_rgba(8,194,121,0.28)] transition active:scale-95 disabled:opacity-40"
        style={{ backgroundColor: canInc ? themeColor : '#cbd5e1' }}
        onClick={onInc}
        disabled={!canInc}
        aria-label={quantity > 0 ? '增加' : '加入'}
      >
        +
      </button>
    </div>
  );

  const info = (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className={`truncate text-[15px] font-bold leading-tight ${
            soldOut ? 'text-slate-500' : 'text-slate-900'
          }`}
        >
          {product.name}
        </span>
        {promoTag}
      </div>
      {product.note ? (
        <p className="line-clamp-1 text-[12px] leading-snug text-slate-500">
          {product.note}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        {priceBlock}
        {stockChip}
      </div>
      {promoFooter}
    </div>
  );

  if (product.imageUrl) {
    return (
      <>
        <article className="flex items-center gap-3 py-3.5">
          <button
            type="button"
            className="relative h-[68px] w-[68px] shrink-0 overflow-hidden rounded-xl bg-slate-50 ring-1 ring-slate-100"
            onClick={() => setPreviewOpen(true)}
            aria-label="查看商品大图"
          >
            <img
              src={product.imageUrl}
              alt=""
              className={`h-full w-full object-cover ${soldOut ? 'opacity-60' : ''}`}
              loading="lazy"
            />
            {soldOut ? (
              <span className="absolute inset-x-0 bottom-0 bg-slate-900/70 py-0.5 text-center text-[11px] font-medium text-white">
                已售罄
              </span>
            ) : null}
          </button>
          {info}
          <div className="self-end pb-0.5">{stepper}</div>
        </article>
        {previewOpen ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            onClick={() => setPreviewOpen(false)}
          >
            <div
              className="relative max-h-[90vh] max-w-[90vw]"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="absolute -right-2 -top-2 h-8 w-8 rounded-full bg-white text-lg leading-none text-gray-800 shadow"
                onClick={() => setPreviewOpen(false)}
                aria-label="关闭预览"
              >
                ×
              </button>
              <img
                src={product.imageUrl}
                alt={product.name}
                className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
              />
            </div>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <article className="flex items-center gap-3 py-3.5">
      {info}
      <div className="self-end pb-0.5">{stepper}</div>
    </article>
  );
}
