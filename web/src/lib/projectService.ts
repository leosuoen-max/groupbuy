import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  Timestamp,
  where,
} from 'firebase/firestore';
import { getDb } from './firebase';
import type { ProjectDoc, ProjectProduct } from '../types/firestore';

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
    products?: ProjectProduct[];
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
