import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getDb } from './firebase';
import { isPlatformAdmin } from './registeredUserService';
import { getProject, type ProjectRow } from './projectService';
import type { BundleToolDoc, ProjectDoc, ProjectProduct } from '../types/firestore';

const FEITUAN_ADMINS = 'feituan_admins';

export type FeituanProjectStatus = NonNullable<ProjectDoc['feituanStatus']>;

export async function isFeituanAdmin(uid: string): Promise<boolean> {
  if (await isPlatformAdmin(uid)) return true;
  const snap = await getDoc(doc(getDb(), FEITUAN_ADMINS, uid));
  return snap.exists();
}

function appendLog(
  project: ProjectDoc,
  input: {
    by: string;
    action: NonNullable<ProjectDoc['feituanChangeLog']>[number]['action'];
    note?: string;
  }
): NonNullable<ProjectDoc['feituanChangeLog']> {
  return [
    ...(project.feituanChangeLog ?? []),
    {
      at: Timestamp.now(),
      by: input.by,
      action: input.action,
      ...(input.note ? { note: input.note } : {}),
    },
  ];
}

async function updateFeituanProject(
  projectId: string,
  actorUid: string,
  action: NonNullable<ProjectDoc['feituanChangeLog']>[number]['action'],
  patch: Partial<ProjectDoc>,
  note?: string
): Promise<void> {
  const row = await getProject(projectId);
  if (!row) throw new Error('项目不存在');
  await updateDoc(doc(getDb(), 'projects', projectId), {
    ...patch,
    feituanChangeLog: appendLog(row.data, { by: actorUid, action, note }),
    updatedAt: Timestamp.now(),
  });
}

export function getFeituanProjectPublishBlocker(project: ProjectDoc): string | null {
  if (project.status !== 'published') {
    return '项目尚未发布，请商户先发布项目';
  }
  const closesAt = project.closesAt?.toDate?.();
  if (!closesAt || closesAt.getTime() <= Date.now()) {
    return '项目截止时间已过，请先延长截止时间';
  }
  if (!project.deliveryDate?.trim() || !project.deliveryPeriod) {
    return '请先配置配送时间（配送日与中午/傍晚）';
  }
  return null;
}

function assertReadyForFeituan(row: ProjectRow): void {
  const blocker = getFeituanProjectPublishBlocker(row.data);
  if (blocker) throw new Error(blocker);
}

export async function submitProjectToFeituan(
  projectId: string,
  actorUid: string
): Promise<void> {
  const row = await getProject(projectId);
  if (!row) throw new Error('项目不存在');
  if (row.data.feituanStatus === 'pending') throw new Error('项目已在饭团待审中');
  if (row.data.feituanStatus === 'listed') throw new Error('项目已在饭团上架');
  assertReadyForFeituan(row);
  await updateFeituanProject(projectId, actorUid, 'submit', {
    feituanStatus: 'pending',
    feituanSubmittedAt: Timestamp.now(),
    feituanReviewedAt: null,
    feituanReviewedBy: '',
    feituanRejectReason: '',
  });
}

export async function approveFeituanProject(
  projectId: string,
  actorUid: string
): Promise<void> {
  if (!(await isFeituanAdmin(actorUid))) throw new Error('需要饭团管理员权限');
  const row = await getProject(projectId);
  if (!row) throw new Error('项目不存在');
  if (row.data.feituanStatus !== 'pending') {
    throw new Error('只有待审项目可以批准上架');
  }
  assertReadyForFeituan(row);
  await updateFeituanProject(projectId, actorUid, 'approve', {
    feituanStatus: 'listed',
    feituanReviewedAt: Timestamp.now(),
    feituanReviewedBy: actorUid,
    feituanRejectReason: '',
  });
}

export async function rejectFeituanProject(
  projectId: string,
  actorUid: string,
  reason: string
): Promise<void> {
  if (!(await isFeituanAdmin(actorUid))) throw new Error('需要饭团管理员权限');
  const note = reason.trim();
  await updateFeituanProject(projectId, actorUid, 'reject', {
    feituanStatus: 'rejected',
    feituanReviewedAt: Timestamp.now(),
    feituanReviewedBy: actorUid,
    feituanRejectReason: note,
  }, note);
}

export async function delistFeituanProject(
  projectId: string,
  actorUid: string
): Promise<void> {
  if (!(await isFeituanAdmin(actorUid))) throw new Error('需要饭团管理员权限');
  await updateFeituanProject(projectId, actorUid, 'delist', {
    feituanStatus: 'delisted',
    feituanReviewedAt: Timestamp.now(),
    feituanReviewedBy: actorUid,
  });
}

export async function delistExpiredFeituanProjects(actorUid: string): Promise<number> {
  if (!(await isFeituanAdmin(actorUid))) throw new Error('需要饭团管理员权限');
  const projects = await listFeituanProjects(['listed']);
  const now = Date.now();
  const expired = projects.filter((row) => {
    const closes = row.data.closesAt?.toDate?.();
    return closes ? closes.getTime() <= now : false;
  });
  await Promise.all(
    expired.map((row) =>
      updateFeituanProject(row.id, actorUid, 'delist', {
        feituanStatus: 'delisted',
        feituanReviewedAt: Timestamp.now(),
        feituanReviewedBy: actorUid,
      }, '系统检测已过截单时间，自动下架')
    )
  );
  return expired.length;
}

export async function updateFeituanProjectCosts(input: {
  projectId: string;
  actorUid: string;
  productCosts: Record<string, number | null>;
  schemeCosts: Record<string, number | null>;
}): Promise<void> {
  if (!(await isFeituanAdmin(input.actorUid))) {
    throw new Error('需要饭团管理员权限');
  }
  const row = await getProject(input.projectId);
  if (!row) throw new Error('项目不存在');
  const products: ProjectProduct[] = (row.data.products ?? []).map((p) => {
    if (!(p.id in input.productCosts)) return p;
    const raw = input.productCosts[p.id];
    const next: ProjectProduct = { ...p };
    if (raw == null || Number.isNaN(Number(raw))) {
      delete next.purchaseCost;
      return next;
    }
    next.purchaseCost = Math.max(0, Number(raw));
    return next;
  });
  const bundleTools: BundleToolDoc[] = (row.data.bundleTools ?? []).map((tool) => ({
    ...tool,
    schemes: tool.schemes.map((scheme) => {
      const key = `${tool.id}:${scheme.id}`;
      if (!(key in input.schemeCosts)) return scheme;
      const raw = input.schemeCosts[key];
      const next = { ...scheme };
      if (raw == null || Number.isNaN(Number(raw))) {
        delete next.purchaseCost;
        return next;
      }
      next.purchaseCost = Math.max(0, Number(raw));
      return next;
    }),
  }));
  await updateFeituanProject(input.projectId, input.actorUid, 'cost_update', {
    products,
    bundleTools,
    feituanCostConfirmedAt: Timestamp.now(),
    feituanCostConfirmedBy: input.actorUid,
  });
}

export async function confirmFeituanProjectCosts(
  projectId: string,
  actorUid: string
): Promise<void> {
  if (!(await isFeituanAdmin(actorUid))) throw new Error('需要饭团管理员权限');
  await updateFeituanProject(projectId, actorUid, 'cost_confirm', {
    feituanCostConfirmedAt: Timestamp.now(),
    feituanCostConfirmedBy: actorUid,
  });
}

export async function listFeituanProjects(
  statuses: FeituanProjectStatus[]
): Promise<ProjectRow[]> {
  if (statuses.length === 0) return [];
  const q = query(collection(getDb(), 'projects'), where('feituanStatus', 'in', statuses));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, data: d.data() as ProjectDoc }))
    .sort((a, b) => {
      const ta =
        a.data.feituanSubmittedAt?.toMillis?.() ??
        a.data.updatedAt?.toMillis?.() ??
        0;
      const tb =
        b.data.feituanSubmittedAt?.toMillis?.() ??
        b.data.updatedAt?.toMillis?.() ??
        0;
      return tb - ta;
    });
}

export async function listListedFeituanProjects(): Promise<ProjectRow[]> {
  const q = query(collection(getDb(), 'projects'), where('feituanStatus', '==', 'listed'));
  const snap = await getDocs(q);
  const now = Date.now();
  return snap.docs
    .map((d) => ({ id: d.id, data: d.data() as ProjectDoc }))
    .filter((row) => {
      const closes = row.data.closesAt?.toDate?.();
      return closes ? closes.getTime() > now : true;
    })
    .sort((a, b) => {
      const ta = a.data.feituanReviewedAt?.toMillis?.() ?? 0;
      const tb = b.data.feituanReviewedAt?.toMillis?.() ?? 0;
      return tb - ta;
    });
}

export function isFeituanListedProject(project: ProjectDoc | null | undefined): boolean {
  return project?.feituanStatus === 'listed';
}
