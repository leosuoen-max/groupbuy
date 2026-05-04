import { collection, getDocs, query, where } from 'firebase/firestore';
import { getDb } from './firebase';
import type { DeliveryPointDoc } from '../types/firestore';

export type DeliveryPointRow = { id: string; data: DeliveryPointDoc };

/** 店铺维度配送点库（见 docs/06 delivery_points） */
export async function listDeliveryPointsByShopId(
  shopId: string
): Promise<DeliveryPointRow[]> {
  const db = getDb();
  const q = query(
    collection(db, 'delivery_points'),
    where('shopId', '==', shopId)
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, data: d.data() as DeliveryPointDoc }))
    .filter((row) => row.data.isActive !== false)
    .sort((a, b) => {
      const na = a.data.number ?? a.data.sortOrder ?? 0;
      const nb = b.data.number ?? b.data.sortOrder ?? 0;
      return na - nb;
    });
}
