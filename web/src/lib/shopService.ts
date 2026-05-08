import {
  addDoc,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { getDb, getStorageClient } from './firebase';
import type { ShopDoc } from '../types/firestore';

export type ShopRow = { id: string; data: ShopDoc };

/** 同一 owner 下按创建时间排序；用于「一账号一商户」时稳定选取主商户（兼容历史多文档）。 */
export function sortShopsByCreatedAt(shops: ShopRow[]): ShopRow[] {
  return [...shops].sort(
    (a, b) => a.data.createdAt.toMillis() - b.data.createdAt.toMillis()
  );
}

export function getPrimaryShop(shops: ShopRow[]): ShopRow | null {
  if (shops.length === 0) return null;
  return sortShopsByCreatedAt(shops)[0] ?? null;
}

export async function listShopsByOwner(ownerId: string): Promise<ShopRow[]> {
  const db = getDb();
  const q = query(collection(db, 'shops'), where('ownerId', '==', ownerId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, data: d.data() as ShopDoc }));
}

export async function getShopBySlug(slug: string): Promise<ShopRow | null> {
  const db = getDb();
  const q = query(
    collection(db, 'shops'),
    where('slug', '==', slug),
    limit(1)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, data: d.data() as ShopDoc };
}

export async function getShopById(shopId: string): Promise<ShopRow | null> {
  const db = getDb();
  const ref = doc(db, 'shops', shopId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, data: snap.data() as ShopDoc };
}

export async function isSlugTaken(slug: string): Promise<boolean> {
  const row = await getShopBySlug(slug);
  return row !== null;
}

export async function createShop(
  ownerId: string,
  input: { name: string; slug: string }
): Promise<string> {
  const db = getDb();
  const slug = input.slug.trim().toLowerCase();
  const name = input.name.trim();
  const existing = await listShopsByOwner(ownerId);
  if (existing.length > 0) {
    throw new Error('OWNER_ALREADY_HAS_SHOP');
  }
  if (await isSlugTaken(slug)) {
    throw new Error('SLUG_TAKEN');
  }
  const ref = await addDoc(collection(db, 'shops'), {
    slug,
    name,
    ownerId,
    themeColor: '#E63946',
    paymentMethods: [],
    settings: { language: 'zh', currency: 'MYR' },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    isActive: true,
  });
  return ref.id;
}

export async function updateShop(
  shopId: string,
  patch: {
    name?: string;
    themeColor?: string;
    bannerImage?: string | null;
    logoImage?: string | null;
    paymentMethods?: { id: string; name: string; qrCodeUrl: string }[];
  }
): Promise<void> {
  const db = getDb();
  const ref = doc(db, 'shops', shopId);
  const payload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  if (patch.name !== undefined) {
    const v = patch.name.trim();
    if (!v) throw new Error('店名不能为空');
    payload.name = v;
  }
  if (patch.themeColor !== undefined) {
    const v = patch.themeColor.trim();
    if (!/^#[0-9A-Fa-f]{6}$/.test(v)) throw new Error('主题色格式错误');
    payload.themeColor = v;
  }
  if (patch.bannerImage !== undefined) {
    const v = patch.bannerImage?.trim();
    payload.bannerImage = v ? v : deleteField();
  }
  if (patch.logoImage !== undefined) {
    const v = patch.logoImage?.trim();
    payload.logoImage = v ? v : deleteField();
  }
  if (patch.paymentMethods !== undefined) {
    payload.paymentMethods = patch.paymentMethods;
  }
  await updateDoc(ref, payload);
}

export async function uploadShopImage(
  ownerId: string,
  kind: 'banner' | 'logo' | 'payment',
  file: File
): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('请上传图片文件');
  const rawExt = file.name.split('.').pop()?.toLowerCase() ?? '';
  const safeExt = rawExt && /^[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : 'jpg';
  const name = `${globalThis.crypto.randomUUID()}.${safeExt}`;
  const path = `shops/${ownerId}/${kind}/${name}`;
  const storageRef = ref(getStorageClient(), path);
  const contentType =
    file.type && file.type.startsWith('image/') ? file.type : 'image/jpeg';
  await uploadBytes(storageRef, file, { contentType });
  return getDownloadURL(storageRef);
}
