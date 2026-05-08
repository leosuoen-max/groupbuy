import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  Timestamp,
  where,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { getDb, getStorageClient } from './firebase';
import type { BundleToolDoc, ProjectDoc, ProjectProduct } from '../types/firestore';

export type ProjectRow = { id: string; data: ProjectDoc };

function defaultProjectPayload(shopId: string): Omit<ProjectDoc, 'createdAt' | 'updatedAt'> {
  return {
    shopId,
    title: '未命名项目',
    status: 'draft',
    closesAt: Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000)),
    textContent: '',
    imageBlocks: [],
    products: [],
    bundleTools: [],
    deliveryPointIds: [],
    formFields: {
      name: { required: true },
      phone: { required: true },
      address: { required: true },
      note: { required: false },
    },
    orderSettings: {
      maxOrdersPerCustomer: null,
      visibility: 'self',
      allowEdit: true,
      allowCancel: true,
    },
    stats: {
      totalOrders: 0,
      confirmedOrders: 0,
      pendingOrders: 0,
      unpaidOrders: 0,
      totalRevenue: 0,
      confirmedRevenue: 0,
    },
  };
}

export async function listProjectsByShopId(shopId: string): Promise<ProjectRow[]> {
  const db = getDb();
  const q = query(collection(db, 'projects'), where('shopId', '==', shopId));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, data: d.data() as ProjectDoc }))
    .sort((a, b) => {
      const ta = a.data.createdAt?.toMillis?.() ?? 0;
      const tb = b.data.createdAt?.toMillis?.() ?? 0;
      return tb - ta;
    });
}

export async function getProject(projectId: string): Promise<ProjectRow | null> {
  const db = getDb();
  const ref = doc(db, 'projects', projectId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, data: snap.data() as ProjectDoc };
}

export async function createDraftProject(shopId: string): Promise<string> {
  const db = getDb();
  const payload = defaultProjectPayload(shopId);
  const ref = await addDoc(collection(db, 'projects'), {
    ...payload,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateProjectDoc(
  projectId: string,
  patch: {
    title?: string;
    status?: ProjectDoc['status'];
    closesAt?: Timestamp;
    textContent?: string;
    imageBlocks?: ProjectDoc['imageBlocks'];
    products?: ProjectProduct[];
    bundleTools?: BundleToolDoc[];
    publishedAt?: Timestamp | null;
    deliveryPointIds?: string[];
  }
) {
  const db = getDb();
  const ref = doc(db, 'projects', projectId);
  await updateDoc(ref, {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

export async function canDeleteProject(
  projectId: string
): Promise<{ allowed: boolean; reason?: string }> {
  const row = await getProject(projectId);
  if (!row) return { allowed: false, reason: '项目不存在' };
  if (row.data.status === 'draft') return { allowed: true };

  const db = getDb();
  const q = query(
    collection(db, 'orders'),
    where('projectId', '==', projectId),
    limit(1)
  );
  const snap = await getDocs(q);
  if (!snap.empty) {
    return { allowed: false, reason: '该项目已有订单，不能删除（请保留历史数据）' };
  }
  return { allowed: true };
}

export async function deleteProjectIfAllowed(projectId: string): Promise<void> {
  const check = await canDeleteProject(projectId);
  if (!check.allowed) throw new Error(check.reason ?? '当前项目不可删除');
  const db = getDb();
  await deleteDoc(doc(db, 'projects', projectId));
}

export async function uploadProjectAsset(
  ownerId: string,
  file: File,
  scope: 'product' | 'bundle-option' | 'description'
): Promise<string> {
  if (scope !== 'description' && !file.type.startsWith('image/')) {
    throw new Error('请上传图片文件');
  }
  const rawExt = file.name.split('.').pop()?.toLowerCase() ?? '';
  const safeExt = rawExt && /^[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : 'jpg';
  const name = `${globalThis.crypto.randomUUID()}.${safeExt}`;
  const path = `projects/${ownerId}/${scope}/${name}`;
  const storageRef = ref(getStorageClient(), path);
  const contentType = file.type || 'application/octet-stream';
  await uploadBytes(storageRef, file, { contentType });
  return getDownloadURL(storageRef);
}
