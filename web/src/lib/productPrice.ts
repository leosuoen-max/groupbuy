import type { MockProduct } from '../data/mockShopHome';

export type EffectivePrice = {
  unit: number;
  isDiscount: boolean;
  discountType?: 'special' | 'earlybird';
  discountEndsAt?: string;
};

export function getEffectivePrice(
  product: MockProduct,
  now: Date = new Date()
): EffectivePrice {
  const { price, discountPrice, discountStart, discountEnd } = product;
  if (discountPrice != null) {
    if (discountEnd != null) {
      const withinWindow =
        now <= new Date(discountEnd) &&
        (discountStart == null || now >= new Date(discountStart));
      if (withinWindow) {
        return {
          unit: discountPrice,
          isDiscount: true,
          discountType: 'earlybird',
          discountEndsAt: discountEnd,
        };
      }
      return { unit: price, isDiscount: false };
    }
    return {
      unit: discountPrice,
      isDiscount: true,
      discountType: 'special',
    };
  }
  return { unit: price, isDiscount: false };
}
