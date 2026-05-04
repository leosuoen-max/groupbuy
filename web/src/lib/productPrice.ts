import type { MockProduct } from '../data/mockShopHome';

export type EffectivePrice = {
  unit: number;
  isDiscount: boolean;
  discountEndsAt?: string;
};

export function getEffectivePrice(
  product: MockProduct,
  now: Date = new Date()
): EffectivePrice {
  const { price, discountPrice, discountStart, discountEnd } = product;
  if (
    discountPrice != null &&
    discountEnd != null &&
    now <= new Date(discountEnd) &&
    (discountStart == null || now >= new Date(discountStart))
  ) {
    return {
      unit: discountPrice,
      isDiscount: true,
      discountEndsAt: discountEnd,
    };
  }
  return { unit: price, isDiscount: false };
}
