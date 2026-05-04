import {
  addDoc,
  collection,
  getDocs,
  limit,
  query,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { getDb } from './firebase';
import type { ShopDoc } from '../types/firestore';

export type ShopRow = { id: string; data: ShopDoc };

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
