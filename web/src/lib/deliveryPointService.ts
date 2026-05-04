import {
  addDoc,
  collection,
  deleteField,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getDb } from './firebase';
import type { DeliveryPointDoc } from '../types/firestore';

export type DeliveryPointRow = { id: string; data: DeliveryPointDoc };

export type ListDeliveryPointsOptions = {
  /** 默认 false：顾客端仅看启用中的点 */
  includeInactive?: boolean;
};

/** 店铺维度配送点库（见 docs/06 delivery_points） */
export async function listDeliveryPointsByShopId(
  shopId: string,
  opts?: ListDeliveryPointsOptions
): Promise<DeliveryPointRow[]> {
  const db = getDb();
  const q = query(
    collection(db, 'delivery_points'),
    where('shopId', '==', shopId)
  );
  const snap = await getDocs(q);
  let rows = snap.docs.map((d) => ({
    id: d.id,
    data: d.data() as DeliveryPointDoc,
  }));
  if (!opts?.includeInactive) {
    rows = rows.filter((row) => row.data.isActive !== false);
  }
  return rows.sort((a, b) => {
    const na = a.data.number ?? a.data.sortOrder ?? 0;
    const nb = b.data.number ?? b.data.sortOrder ?? 0;
    return na - nb;
  });
}

export type CreateDeliveryPointInput = {
  name: string;
  detailAddress?: string;
  deliveryTime?: string;
  imageUrl?: string;
  isActive?: boolean;
};

export async function createDeliveryPoint(
  shopId: string,
  input: CreateDeliveryPointInput
): Promise<string> {
  const db = getDb();
  const existing = await listDeliveryPointsByShopId(shopId, {
    includeInactive: true,
  });
  const maxNum = existing.reduce(
    (m, r) => Math.max(m, r.data.number ?? r.data.sortOrder ?? 0),
    0
  );
  const nextNum = maxNum + 1;
  const name = input.name.trim();
  if (!name) throw new Error('配送点名称不能为空');

  const payload: Record<string, unknown> = {
    shopId,
    number: nextNum,
    name,
    isActive: input.isActive !== false,
    sortOrder: nextNum,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const da = input.detailAddress?.trim();
  const dt = input.deliveryTime?.trim();
  const img = input.imageUrl?.trim();
  if (da) payload.detailAddress = da;
  if (dt) payload.deliveryTime = dt;
  if (img) payload.imageUrl = img;

  const ref = await addDoc(collection(db, 'delivery_points'), payload);
  return ref.id;
}

export async function updateDeliveryPoint(
  pointId: string,
  patch: {
    name?: string;
    detailAddress?: string | null;
    deliveryTime?: string | null;
    imageUrl?: string | null;
    isActive?: boolean;
  }
): Promise<void> {
  const db = getDb();
  const ref = doc(db, 'delivery_points', pointId);
  const payload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  if (patch.name !== undefined) {
    const n = patch.name.trim();
    if (!n) throw new Error('配送点名称不能为空');
    payload.name = n;
  }
  if (patch.detailAddress !== undefined) {
    const v = patch.detailAddress?.trim();
    payload.detailAddress = v ? v : deleteField();
  }
  if (patch.deliveryTime !== undefined) {
    const v = patch.deliveryTime?.trim();
    payload.deliveryTime = v ? v : deleteField();
  }
  if (patch.imageUrl !== undefined) {
    const v = patch.imageUrl?.trim();
    payload.imageUrl = v ? v : deleteField();
  }
  if (patch.isActive !== undefined) payload.isActive = patch.isActive;
  await updateDoc(ref, payload);
}
