import {
  addDoc,
  collection,
  deleteField,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { getDb, getStorageClient } from './firebase';
import type { DeliveryPointDoc } from '../types/firestore';

export type DeliveryPointRow = { id: string; data: DeliveryPointDoc };

export type ListDeliveryPointsOptions = {
  /** 默认 false：顾客端仅看启用中的点 */
  includeInactive?: boolean;
  /** owner 口径暂无数据时，兼容回退到指定店铺旧数据 */
  fallbackShopId?: string;
};

const CODE_RE = /^[A-Za-z]{1,2}[0-9]{1,2}$/;

export function normalizeDeliveryPointCode(input: string): string {
  const v = input.trim().toUpperCase();
  if (!CODE_RE.test(v)) {
    throw new Error('编号格式需为 1-2 位字母 + 1-2 位数字（如 A1 / AB12）');
  }
  return v;
}

function sortRows(rows: DeliveryPointRow[]): DeliveryPointRow[] {
  return rows.sort((a, b) => {
    const ca = (a.data.code ?? '').trim();
    const cb = (b.data.code ?? '').trim();
    if (ca && cb && ca !== cb) return ca.localeCompare(cb);
    const na = a.data.number ?? a.data.sortOrder ?? 0;
    const nb = b.data.number ?? b.data.sortOrder ?? 0;
    if (na !== nb) return na - nb;
    const ta = a.data.updatedAt?.toMillis?.() ?? 0;
    const tb = b.data.updatedAt?.toMillis?.() ?? 0;
    return tb - ta;
  });
}

/** 账号维度配送点库（新口径：同账号跨店共享） */
export async function listDeliveryPointsByOwnerId(
  ownerId: string,
  opts?: ListDeliveryPointsOptions
): Promise<DeliveryPointRow[]> {
  const db = getDb();
  const q = query(collection(db, 'delivery_points'), where('ownerId', '==', ownerId));
  const snap = await getDocs(q);
  let rows = snap.docs.map((d) => ({
    id: d.id,
    data: d.data() as DeliveryPointDoc,
  }));
  if (rows.length === 0 && opts?.fallbackShopId) {
    rows = await listDeliveryPointsByShopId(opts.fallbackShopId, {
      includeInactive: true,
    });
    if (rows.length > 0) {
      await hydrateLegacyPointsOwner(rows, ownerId);
      // 再按 ownerId 重新读取一次，确保跨店共享立即生效
      const refetch = await getDocs(
        query(collection(db, 'delivery_points'), where('ownerId', '==', ownerId))
      );
      rows = refetch.docs.map((d) => ({
        id: d.id,
        data: d.data() as DeliveryPointDoc,
      }));
    }
  }
  if (!opts?.includeInactive) {
    rows = rows.filter((row) => row.data.isActive !== false);
  }
  return sortRows(rows);
}

async function hydrateLegacyPointsOwner(
  rows: DeliveryPointRow[],
  ownerId: string
): Promise<void> {
  const usedCodes = new Set(
    rows
      .map((r) => (r.data.code ?? '').trim().toUpperCase())
      .filter(Boolean)
  );
  let nextNum = 1;
  const nextLegacyCode = () => {
    while (nextNum <= 99) {
      const c = `L${nextNum}`;
      nextNum += 1;
      if (!usedCodes.has(c)) {
        usedCodes.add(c);
        return c;
      }
    }
    return `L${Math.floor(Math.random() * 90) + 10}`;
  };

  await Promise.all(
    rows.map(async (r) => {
      const payload: Record<string, unknown> = {
        ownerId,
        updatedAt: serverTimestamp(),
      };
      if (!r.data.code) payload.code = nextLegacyCode();
      if (!r.data.shortName) payload.shortName = r.data.name;
      await updateDoc(doc(getDb(), 'delivery_points', r.id), payload);
    })
  );
}

/** 店铺维度配送点库（兼容历史数据） */
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
  return sortRows(rows);
}

export type CreateDeliveryPointInput = {
  code: string;
  shortName: string;
  detailAddress?: string;
  mapsUrl?: string;
  imageUrl?: string;
  isActive?: boolean;
};

export async function createDeliveryPoint(
  ownerId: string,
  input: CreateDeliveryPointInput,
  opts?: { fallbackShopId?: string }
): Promise<string> {
  const db = getDb();
  const existing = await listDeliveryPointsByOwnerId(ownerId, {
    includeInactive: true,
    fallbackShopId: opts?.fallbackShopId,
  });
  const code = normalizeDeliveryPointCode(input.code);
  if (existing.some((r) => (r.data.code ?? '').trim().toUpperCase() === code)) {
    throw new Error(`编号 ${code} 已存在，请更换`);
  }
  const shortName = input.shortName.trim();
  if (!shortName) throw new Error('配送点简称不能为空');

  const payload: Record<string, unknown> = {
    ownerId,
    code,
    shortName,
    // 兼容历史读取逻辑：name 始终与 shortName 同步
    name: shortName,
    isActive: input.isActive !== false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const da = input.detailAddress?.trim();
  const maps = input.mapsUrl?.trim();
  const img = input.imageUrl?.trim();
  if (da) payload.detailAddress = da;
  if (maps) payload.mapsUrl = maps;
  if (img) payload.imageUrl = img;

  const ref = await addDoc(collection(db, 'delivery_points'), payload);
  return ref.id;
}

export async function updateDeliveryPoint(
  pointId: string,
  patch: {
    ownerId?: string;
    code?: string;
    shortName?: string;
    detailAddress?: string | null;
    mapsUrl?: string | null;
    imageUrl?: string | null;
    isActive?: boolean;
  },
  opts?: { fallbackShopId?: string }
): Promise<void> {
  const db = getDb();
  const ref = doc(db, 'delivery_points', pointId);
  const payload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  const currentSnap = await getDoc(ref);
  if (!currentSnap.exists()) throw new Error('配送点不存在');
  const current = currentSnap.data() as DeliveryPointDoc;

  if (patch.code !== undefined) {
    const ownerId = patch.ownerId?.trim() || current.ownerId?.trim();
    if (!ownerId) throw new Error('配送点缺少 ownerId，无法校验编号');
    const nextCode = normalizeDeliveryPointCode(patch.code);
    const existing = await listDeliveryPointsByOwnerId(ownerId, {
      includeInactive: true,
      fallbackShopId: opts?.fallbackShopId,
    });
    if (
      existing.some(
        (r) =>
          r.id !== pointId &&
          (r.data.code ?? '').trim().toUpperCase() === nextCode
      )
    ) {
      throw new Error(`编号 ${nextCode} 已存在，请更换`);
    }
    payload.code = nextCode;
  }
  if (patch.shortName !== undefined) {
    const n = patch.shortName.trim();
    if (!n) throw new Error('配送点简称不能为空');
    payload.shortName = n;
    payload.name = n;
  }
  if (patch.detailAddress !== undefined) {
    const v = patch.detailAddress?.trim();
    payload.detailAddress = v ? v : deleteField();
  }
  if (patch.mapsUrl !== undefined) {
    const v = patch.mapsUrl?.trim();
    payload.mapsUrl = v ? v : deleteField();
  }
  if (patch.imageUrl !== undefined) {
    const v = patch.imageUrl?.trim();
    payload.imageUrl = v ? v : deleteField();
  }
  if (patch.isActive !== undefined) payload.isActive = patch.isActive;
  await updateDoc(ref, payload);
}

export async function deleteDeliveryPoint(pointId: string): Promise<void> {
  const db = getDb();
  await deleteDoc(doc(db, 'delivery_points', pointId));
}

/** 配送点示意图上传（账号维度目录） */
export async function uploadDeliveryPointImage(
  ownerId: string,
  file: File
): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('请上传图片文件');
  }
  const rawExt = file.name.split('.').pop()?.toLowerCase() ?? '';
  const safeExt = rawExt && /^[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : 'jpg';
  const name = `${globalThis.crypto.randomUUID()}.${safeExt}`;
  const path = `deliveryPoints/${ownerId}/${name}`;
  const storageRef = ref(getStorageClient(), path);
  const contentType =
    file.type && file.type.startsWith('image/') ? file.type : 'image/jpeg';
  await uploadBytes(storageRef, file, { contentType });
  return getDownloadURL(storageRef);
}
