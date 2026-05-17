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
import { compressImageFileForUpload } from './imageCompress';
import { getDb, getStorageClient } from './firebase';
import { getShopById, getShopBySlug, type ShopRow } from './shopService';
import {
  buildProjectDeliveryFields,
  defaultDeliveryDateInput,
  resolveProjectDeliverySlot,
} from './deliverySlot';
import type { BundleToolDoc, ProjectDoc, ProjectProduct } from '../types/firestore';

export type ProjectRow = { id: string; data: ProjectDoc };

function defaultProjectPayload(shopId: string): Omit<ProjectDoc, 'createdAt' | 'updatedAt'> {
  return {
    shopId,
    title: '未命名项目',
    status: 'draft',
    closesAt: Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000)),
    ...buildProjectDeliveryFields(defaultDeliveryDateInput(), 'midday'),
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

/**
 * 从顾客进店链接或分享页路径解析项目。
 * - `https://域名/shop/slug/projectId`、`/shop/slug/projectId/order` 等
 * - `https://域名/share/projectId`（与 `getProjectSharePageUrl` 一致）
 */
export type ParsedCustomerProjectLink =
  | { kind: 'shop_home'; shopSlug: string; projectId: string }
  | { kind: 'share'; projectId: string };

export function parseCustomerProjectLink(raw: string): ParsedCustomerProjectLink | null {
  const t = raw.trim();
  if (!t) return null;
  let pathname = t;
  if (/^https?:\/\//i.test(t)) {
    try {
      pathname = new URL(t).pathname;
    } catch {
      return null;
    }
  }
  const shareM = pathname.match(/\/share\/([^/?]+)/);
  if (shareM?.[1]) {
    try {
      return { kind: 'share', projectId: decodeURIComponent(shareM[1]) };
    } catch {
      return null;
    }
  }
  const m = pathname.match(/\/shop\/([^/]+)\/([^/]+)/);
  if (!m?.[1] || !m[2]) return null;
  try {
    return {
      kind: 'shop_home',
      shopSlug: decodeURIComponent(m[1]),
      projectId: decodeURIComponent(m[2]),
    };
  } catch {
    return null;
  }
}

/** @deprecated 使用 {@link parseCustomerProjectLink} */
export function parseShopProjectFromCustomerUrl(raw: string): {
  shopSlug: string;
  projectId: string;
} | null {
  const p = parseCustomerProjectLink(raw);
  if (!p || p.kind !== 'shop_home') return null;
  return { shopSlug: p.shopSlug, projectId: p.projectId };
}

function cloneProductsForCopy(
  products: ProjectProduct[],
  stripCardTemplates: boolean
): ProjectProduct[] {
  return (products ?? []).map((p) => {
    if (!stripCardTemplates) return { ...p };
    const { applicableCardTemplateIds: _a, ...rest } = p;
    return { ...rest };
  });
}

function cloneBundleToolsForCopy(
  tools: BundleToolDoc[] | undefined,
  stripCardTemplates: boolean
): BundleToolDoc[] {
  if (!tools?.length) return [];
  return tools.map((tool) => ({
    ...tool,
    series: tool.series.map((s) => ({
      ...s,
      options: s.options.map((o) => ({ ...o })),
    })),
    schemes: tool.schemes.map((sch) => {
      if (!stripCardTemplates) return { ...sch };
      const { applicableCardTemplateIds: _a, ...schRest } = sch;
      return { ...schRest };
    }),
  }));
}

function resolveCopyClosesAt(src: Timestamp | undefined): Timestamp {
  const fallback = Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000));
  if (!src?.toDate) return fallback;
  try {
    const d = src.toDate();
    if (d.getTime() > Date.now() + 60_000) return src;
  } catch {
    /* ignore */
  }
  return fallback;
}

/**
 * 将「顾客进店链接」或「/share/项目ID」对应的项目整份拷贝为**当前店铺**下的新草稿（新文档 ID）。
 * - 跨店拷贝时：清空 `deliveryPointIds`、去掉商品/套餐上的次卡模板抵扣配置（避免指向他店模板）。
 * - 同店拷贝：保留配送点与次卡适用模板。
 * - 统计字段归零；状态为 draft；标题后缀「（拷贝草稿）」（已带此后缀则不重复添加）。
 */
export async function copyProjectFromCustomerLinkAsDraft(params: {
  linkOrPath: string;
  targetShopId: string;
}): Promise<{ newProjectId: string }> {
  const parsed = parseCustomerProjectLink(params.linkOrPath);
  if (!parsed) {
    throw new Error(
      '无法识别链接：请粘贴完整顾客链接（/shop/店铺slug/项目ID）或分享页链接（/share/项目ID）'
    );
  }

  let shopRow: ShopRow;
  let projRow: ProjectRow;

  if (parsed.kind === 'share') {
    const p = await getProject(parsed.projectId);
    if (!p) throw new Error('链接中的项目不存在或无权读取');
    projRow = p;
    const srcShop = await getShopById(p.data.shopId);
    if (!srcShop) throw new Error('来源店铺不存在');
    shopRow = srcShop;
  } else {
    const s = await getShopBySlug(parsed.shopSlug);
    if (!s) throw new Error('链接中的店铺不存在或 slug 有误');
    shopRow = s;
    const p = await getProject(parsed.projectId);
    if (!p) throw new Error('链接中的项目不存在或无权读取');
    projRow = p;
    if (p.data.shopId !== s.id) {
      throw new Error('链接与项目数据不一致，请检查是否复制完整');
    }
  }

  const src = projRow.data;
  const stripCardTemplates = shopRow.id !== params.targetShopId;
  const deliveryPointIds = stripCardTemplates ? [] : [...(src.deliveryPointIds ?? [])];

  const baseTitle = (src.title || '未命名项目').trim();
  const suffix = '（拷贝草稿）';
  const title = baseTitle.endsWith(suffix) ? baseTitle : `${baseTitle}${suffix}`;

  const def = defaultProjectPayload(params.targetShopId);
  const ff = src.formFields;
  const os = src.orderSettings;
  const payload: Omit<ProjectDoc, 'createdAt' | 'updatedAt'> = {
    shopId: params.targetShopId,
    title,
    status: 'draft',
    closesAt: resolveCopyClosesAt(src.closesAt),
    ...((): Pick<
      ProjectDoc,
      'deliveryDate' | 'deliveryPeriod' | 'deliveryTimeText'
    > => {
      const slot = resolveProjectDeliverySlot(src);
      if (slot) return buildProjectDeliveryFields(slot.date, slot.period);
      return { deliveryTimeText: src.deliveryTimeText ?? '' };
    })(),
    maxParticipants: src.maxParticipants ?? null,
    textContent: src.textContent ?? '',
    imageBlocks: [...(src.imageBlocks ?? [])].map((b) => ({ ...b })),
    products: cloneProductsForCopy(src.products ?? [], stripCardTemplates),
    bundleTools: cloneBundleToolsForCopy(src.bundleTools, stripCardTemplates),
    deliveryPointIds,
    formFields: {
      name: { required: ff?.name?.required ?? def.formFields.name.required },
      phone: { required: ff?.phone?.required ?? def.formFields.phone.required },
      address: { required: ff?.address?.required ?? def.formFields.address.required },
      note: { required: ff?.note?.required ?? def.formFields.note.required },
    },
    orderSettings: {
      maxOrdersPerCustomer: os?.maxOrdersPerCustomer ?? def.orderSettings.maxOrdersPerCustomer,
      visibility: os?.visibility ?? def.orderSettings.visibility,
      allowEdit: os?.allowEdit ?? def.orderSettings.allowEdit,
      allowCancel: os?.allowCancel ?? def.orderSettings.allowCancel,
    },
    stats: {
      totalOrders: 0,
      confirmedOrders: 0,
      pendingOrders: 0,
      unpaidOrders: 0,
      totalRevenue: 0,
      confirmedRevenue: 0,
    },
    publishedAt: null,
  };

  const db = getDb();
  const ref = await addDoc(collection(db, 'projects'), {
    ...payload,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { newProjectId: ref.id };
}

export async function updateProjectDoc(
  projectId: string,
  patch: {
    title?: string;
    status?: ProjectDoc['status'];
    closesAt?: Timestamp;
    deliveryDate?: string;
    deliveryPeriod?: ProjectDoc['deliveryPeriod'];
    deliveryTimeText?: string;
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
  const toUpload =
    file.type.startsWith('image/') ? await compressImageFileForUpload(file) : file;
  const rawExt = toUpload.name.split('.').pop()?.toLowerCase() ?? '';
  const safeExt = rawExt && /^[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : 'jpg';
  const name = `${globalThis.crypto.randomUUID()}.${safeExt}`;
  const path = `projects/${ownerId}/${scope}/${name}`;
  const storageRef = ref(getStorageClient(), path);
  const contentType = toUpload.type || 'application/octet-stream';
  await uploadBytes(storageRef, toUpload, { contentType });
  return getDownloadURL(storageRef);
}
