import type { MockDeliveryPoint } from '../types/orderDraft';

export function getMockDeliveryPoints(): MockDeliveryPoint[] {
  return [
    {
      id: 'dp1',
      name: '配送点 1 · A 座大堂',
      detailAddress: 'A 座 1 楼前台旁',
      deliveryTime: '18:30 - 19:00',
      imageUrl:
        'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=400&q=80',
    },
    {
      id: 'dp2',
      name: '配送点 2 · B 座入口',
      detailAddress: 'B 座机动车入口内侧',
      deliveryTime: '18:35 - 19:05',
    },
    {
      id: 'dp3',
      name: '配送点 3 · 自取',
      detailAddress: '店铺门口自取架',
      deliveryTime: '18:00 - 19:30',
    },
  ];
}

export const OTHER_DELIVERY_ID = '__other__';
