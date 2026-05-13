import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { getDb } from './firebase';
import { isFeituanAdmin } from './feituanService';
import { normalizeDeliveryPointCode } from './deliveryPointService';
import type {
  FeituanDeliveryPointDoc,
  FeituanDeliverySetDoc,
  ProjectDoc,
} from '../types/firestore';
import type { MockDeliveryPoint } from '../types/orderDraft';

const DELIVERY_SETS = 'feituan_delivery_sets';

export type FeituanDeliverySetRow = {
  id: string;
  data: FeituanDeliverySetDoc;
};

function sortPoints(
  points: FeituanDeliveryPointDoc[]
): FeituanDeliveryPointDoc[] {
  return [...points].sort((a, b) => {
    const ca = (a.code ?? '').trim();
    const cb = (b.code ?? '').trim();
    if (ca && cb && ca !== cb) return ca.localeCompare(cb);
    return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
  });
}

function sortSets(rows: FeituanDeliverySetRow[]): FeituanDeliverySetRow[] {
  return [...rows].sort((a, b) => {
    const sa = Number(a.data.sortOrder ?? 0);
    const sb = Number(b.data.sortOrder ?? 0);
    if (sa !== sb) return sa - sb;
    return a.data.name.localeCompare(b.data.name, 'zh-CN');
  });
}

function normalizePoint(
  point: Partial<FeituanDeliveryPointDoc>,
  sortOrder: number
): FeituanDeliveryPointDoc {
  const shortName = (point.shortName ?? point.name ?? '').trim();
  if (!shortName) throw new Error('配送点简称不能为空');
  const code = point.code?.trim() ? normalizeDeliveryPointCode(point.code) : undefined;
  return {
    id: point.id?.trim() || crypto.randomUUID(),
    ...(code ? { code } : {}),
    shortName,
    name: shortName,
    ...(point.detailAddress?.trim()
      ? { detailAddress: point.detailAddress.trim() }
      : {}),
    ...(point.mapsUrl?.trim() ? { mapsUrl: point.mapsUrl.trim() } : {}),
    ...(point.imageUrl?.trim() ? { imageUrl: point.imageUrl.trim() } : {}),
    isActive: point.isActive !== false,
    sortOrder:
      typeof point.sortOrder === 'number' && Number.isFinite(point.sortOrder)
        ? point.sortOrder
        : sortOrder,
  };
}

export async function listFeituanDeliverySets(opts?: {
  includeInactive?: boolean;
}): Promise<FeituanDeliverySetRow[]> {
  const snap = await getDocs(collection(getDb(), DELIVERY_SETS));
  let rows = snap.docs.map((d) => {
    const data = d.data() as FeituanDeliverySetDoc;
    return {
      id: d.id,
      data: {
        ...data,
        points: sortPoints(data.points ?? []),
      },
    };
  });
  if (!opts?.includeInactive) {
    rows = rows.filter((row) => row.data.isActive !== false);
  }
  return sortSets(rows);
}

export async function getFeituanDeliverySet(
  setId: string
): Promise<FeituanDeliverySetRow | null> {
  const snap = await getDoc(doc(getDb(), DELIVERY_SETS, setId));
  if (!snap.exists()) return null;
  const data = snap.data() as FeituanDeliverySetDoc;
  return {
    id: snap.id,
    data: {
      ...data,
      points: sortPoints(data.points ?? []),
    },
  };
}

export async function createFeituanDeliverySet(input: {
  actorUid: string;
  name: string;
  description?: string;
}): Promise<string> {
  if (!(await isFeituanAdmin(input.actorUid))) throw new Error('需要饭团管理员权限');
  const name = input.name.trim();
  if (!name) throw new Error('配送区名称不能为空');
  const ref = await addDoc(collection(getDb(), DELIVERY_SETS), {
    name,
    ...(input.description?.trim()
      ? { description: input.description.trim() }
      : {}),
    isActive: true,
    sortOrder: Date.now(),
    points: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateFeituanDeliverySet(input: {
  actorUid: string;
  setId: string;
  name?: string;
  description?: string | null;
  isActive?: boolean;
}): Promise<void> {
  if (!(await isFeituanAdmin(input.actorUid))) throw new Error('需要饭团管理员权限');
  const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new Error('配送区名称不能为空');
    payload.name = name;
  }
  if (input.description !== undefined) {
    const desc = input.description?.trim();
    payload.description = desc || '';
  }
  if (input.isActive !== undefined) payload.isActive = input.isActive;
  await updateDoc(doc(getDb(), DELIVERY_SETS, input.setId), payload);
}

export async function deleteFeituanDeliverySet(input: {
  actorUid: string;
  setId: string;
}): Promise<void> {
  if (!(await isFeituanAdmin(input.actorUid))) throw new Error('需要饭团管理员权限');
  await deleteDoc(doc(getDb(), DELIVERY_SETS, input.setId));
}

export async function upsertFeituanDeliveryPoint(input: {
  actorUid: string;
  setId: string;
  point?: Partial<FeituanDeliveryPointDoc>;
}): Promise<void> {
  if (!(await isFeituanAdmin(input.actorUid))) throw new Error('需要饭团管理员权限');
  const row = await getFeituanDeliverySet(input.setId);
  if (!row) throw new Error('配送区不存在');
  const points = row.data.points ?? [];
  const point = {
    ...normalizePoint(input.point ?? {}, points.length),
    zoneId: row.id,
    zoneName: row.data.name,
  };
  const nextPoints = points.some((p) => p.id === point.id)
    ? points.map((p) => (p.id === point.id ? point : p))
    : [...points, point];
  await updateDoc(doc(getDb(), DELIVERY_SETS, input.setId), {
    points: sortPoints(nextPoints),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteFeituanDeliveryPoint(input: {
  actorUid: string;
  setId: string;
  pointId: string;
}): Promise<void> {
  if (!(await isFeituanAdmin(input.actorUid))) throw new Error('需要饭团管理员权限');
  const row = await getFeituanDeliverySet(input.setId);
  if (!row) throw new Error('配送区不存在');
  await updateDoc(doc(getDb(), DELIVERY_SETS, input.setId), {
    points: row.data.points.filter((point) => point.id !== input.pointId),
    updatedAt: serverTimestamp(),
  });
}

export async function updateProjectFeituanDeliveryZones(input: {
  actorUid: string;
  projectId: string;
  zoneIds: string[];
}): Promise<void> {
  if (!(await isFeituanAdmin(input.actorUid))) throw new Error('需要饭团管理员权限');
  await updateDoc(doc(getDb(), 'projects', input.projectId), {
    feituanDeliveryZoneIds: [...new Set(input.zoneIds)],
    updatedAt: serverTimestamp(),
  });
}

export async function listActiveFeituanDeliveryPoints(
  zoneIds?: string[]
): Promise<MockDeliveryPoint[]> {
  const rows = await listFeituanDeliverySets();
  const selectedZones = new Set((zoneIds ?? []).filter(Boolean));
  const hasExplicitZones = selectedZones.size > 0;
  const points: MockDeliveryPoint[] = [];
  for (const row of rows) {
    if (row.data.isActive === false) continue;
    if (hasExplicitZones && !selectedZones.has(row.id)) continue;
    for (const point of row.data.points ?? []) {
      if (point.isActive === false) continue;
      points.push({
        id: `feituan:${row.id}:${point.id}`,
        name: point.shortName ?? point.name,
        code: point.code,
        zoneId: row.id,
        zoneName: row.data.name,
        detailAddress: point.detailAddress,
        imageUrl: point.imageUrl,
      });
    }
  }
  return points;
}

export async function listActiveFeituanDeliveryPointsForProject(
  project: ProjectDoc
): Promise<MockDeliveryPoint[]> {
  return listActiveFeituanDeliveryPoints(project.feituanDeliveryZoneIds);
}
