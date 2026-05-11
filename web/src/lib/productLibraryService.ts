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
import type {
  BundleToolDoc,
  ProductLibraryItemDoc,
  ProjectProduct,
} from '../types/firestore';

export type ProductLibraryRow = { id: string; data: ProductLibraryItemDoc };

export function normalizeProductLibraryNameKey(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

function rowMillis(d: ProductLibraryItemDoc): number {
  return d.updatedAt?.toMillis?.() ?? d.createdAt?.toMillis?.() ?? 0;
}

/** 同 kind + nameKey 只保留一条（时间最新），避免历史重复文档影响列表 */
export function dedupeProductLibraryRows(
  rows: ProductLibraryRow[]
): ProductLibraryRow[] {
  const m = new Map<string, ProductLibraryRow>();
  for (const r of rows) {
    const nk =
      r.data.nameKey?.trim() ||
      normalizeProductLibraryNameKey(r.data.name ?? '');
    const key = `${r.data.kind}|${nk}`;
    const cur = m.get(key);
    if (!cur) {
      m.set(key, r);
      continue;
    }
    m.set(key, rowMillis(r.data) >= rowMillis(cur.data) ? r : cur);
  }
  return [...m.values()].sort((a, b) => rowMillis(b.data) - rowMillis(a.data));
}

/**
 * 删除 Firestore 中同 kind + nameKey 的重复文档，仅保留 updatedAt 最新的一条。
 * @returns 删除的文档数
 */
export async function dedupeProductLibraryByShop(
  shopId: string
): Promise<number> {
  const db = getDb();
  const snap = await getDocs(
    query(collection(db, 'product_library'), where('shopId', '==', shopId))
  );
  const groups = new Map<string, { id: string; ms: number }[]>();
  for (const d of snap.docs) {
    const data = d.data() as ProductLibraryItemDoc;
    const nk =
      data.nameKey?.trim() ||
      normalizeProductLibraryNameKey(data.name ?? '');
    const key = `${data.kind}|${nk}`;
    const ms = rowMillis(data);
    const arr = groups.get(key) ?? [];
    arr.push({ id: d.id, ms });
    groups.set(key, arr);
  }
  let deleted = 0;
  for (const arr of groups.values()) {
    if (arr.length <= 1) continue;
    arr.sort((a, b) => b.ms - a.ms);
    for (const { id } of arr.slice(1)) {
      await deleteDoc(doc(db, 'product_library', id));
      deleted += 1;
    }
  }
  return deleted;
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
  return dedupeProductLibraryRows(rows);
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

/** 项目发布成功后：把当前所有有名称的普通商品与套餐方案写入商品库（同名 upsert 覆盖） */
export async function syncPublishedProjectToProductLibrary(
  shopId: string,
  ownerId: string,
  products: ProjectProduct[],
  bundleTools: BundleToolDoc[]
): Promise<void> {
  for (const p of products) {
    if (!p.name?.trim()) continue;
    await upsertProductLibraryItem(shopId, ownerId, {
      name: p.name,
      imageUrl: p.imageUrl,
      purchaseCost: p.purchaseCost,
      retailPrice: p.price,
      note: p.description,
      kind: 'product',
    });
  }
  for (const tool of bundleTools) {
    for (const sch of tool.schemes ?? []) {
      if (!sch.name?.trim()) continue;
      await upsertProductLibraryItem(shopId, ownerId, {
        name: sch.name,
        retailPrice: sch.price,
        purchaseCost: sch.purchaseCost,
        note: sch.note,
        kind: 'bundle_scheme',
      });
    }
  }
}

export async function deleteProductLibraryItem(id: string): Promise<void> {
  const db = getDb();
  await deleteDoc(doc(db, 'product_library', id));
}
