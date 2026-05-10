import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getDb } from './firebase';
import type { ProductLibraryItemDoc } from '../types/firestore';

export type ProductLibraryRow = { id: string; data: ProductLibraryItemDoc };

export function normalizeProductLibraryNameKey(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

export async function listProductLibraryByShop(
  shopId: string
): Promise<ProductLibraryRow[]> {
  const db = getDb();
  const q = query(
    collection(db, 'product_library'),
    where('shopId', '==', shopId)
  );
  const snap = await getDocs(q);
  const rows = snap.docs.map((d) => ({
    id: d.id,
    data: d.data() as ProductLibraryItemDoc,
  }));
  return rows.sort((a, b) => {
    const ta =
      a.data.updatedAt?.toMillis?.() ?? a.data.createdAt?.toMillis?.() ?? 0;
    const tb =
      b.data.updatedAt?.toMillis?.() ?? b.data.createdAt?.toMillis?.() ?? 0;
    return tb - ta;
  });
}

export async function upsertProductLibraryItem(
  shopId: string,
  ownerId: string,
  input: {
    name: string;
    /** 有值则写入；空字符串表示清除图片（仅更新时） */
    imageUrl?: string;
    purchaseCost?: number;
    retailPrice: number;
    note?: string;
    kind: ProductLibraryItemDoc['kind'];
  }
): Promise<string> {
  const nameKey = normalizeProductLibraryNameKey(input.name);
  if (!nameKey) throw new Error('名称不能为空');

  const db = getDb();
  const snap = await getDocs(
    query(collection(db, 'product_library'), where('shopId', '==', shopId))
  );
  const existing = snap.docs.find((d) => {
    const row = d.data() as ProductLibraryItemDoc;
    return row.kind === input.kind && row.nameKey === nameKey;
  });

  const retailPrice = Math.max(0, Number(input.retailPrice) || 0);
  const baseName = input.name.trim().replace(/\s+/g, ' ');

  const core = {
    shopId,
    ownerId,
    nameKey,
    name: baseName,
    retailPrice,
    kind: input.kind,
    updatedAt: serverTimestamp(),
  };

  if (!existing) {
    const ref = await addDoc(collection(db, 'product_library'), {
      ...core,
      ...(input.imageUrl?.trim() ? { imageUrl: input.imageUrl.trim() } : {}),
      ...(typeof input.purchaseCost === 'number' &&
      !Number.isNaN(input.purchaseCost) &&
      input.purchaseCost >= 0
        ? { purchaseCost: input.purchaseCost }
        : {}),
      ...(input.note?.trim() ? { note: input.note.trim() } : {}),
      createdAt: serverTimestamp(),
    });
    return ref.id;
  }

  const updatePayload: Record<string, unknown> = { ...core };
  if (input.imageUrl !== undefined) {
    updatePayload.imageUrl = input.imageUrl.trim()
      ? input.imageUrl.trim()
      : deleteField();
  }
  if (input.purchaseCost !== undefined) {
    if (
      typeof input.purchaseCost === 'number' &&
      !Number.isNaN(input.purchaseCost) &&
      input.purchaseCost >= 0
    ) {
      updatePayload.purchaseCost = input.purchaseCost;
    } else {
      updatePayload.purchaseCost = deleteField();
    }
  }
  if (input.note !== undefined) {
    updatePayload.note = input.note.trim() ? input.note.trim() : deleteField();
  }

  await updateDoc(doc(db, 'product_library', existing.id), updatePayload);
  return existing.id;
}

export async function deleteProductLibraryItem(id: string): Promise<void> {
  const db = getDb();
  await deleteDoc(doc(db, 'product_library', id));
}
