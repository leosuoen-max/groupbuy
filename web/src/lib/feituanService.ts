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
import type { ProjectDoc } from '../types/firestore';

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

export async function submitProjectToFeituan(
  projectId: string,
  actorUid: string
): Promise<void> {
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
  return snap.docs
    .map((d) => ({ id: d.id, data: d.data() as ProjectDoc }))
    .sort((a, b) => {
      const ta = a.data.feituanReviewedAt?.toMillis?.() ?? 0;
      const tb = b.data.feituanReviewedAt?.toMillis?.() ?? 0;
      return tb - ta;
    });
}

export function isFeituanListedProject(project: ProjectDoc | null | undefined): boolean {
  return project?.feituanStatus === 'listed';
}
