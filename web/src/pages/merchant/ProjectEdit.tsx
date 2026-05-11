import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FirebaseError } from 'firebase/app';
import { Timestamp } from 'firebase/firestore';
import { PageShell } from '../../components/PageShell';
import { useAuthUser } from '../../hooks/useAuthUser';
import {
  createDraftProject,
  getProject,
  updateProjectDoc,
  uploadProjectAsset,
} from '../../lib/projectService';
import {
  listDeliveryPointsByOwnerId,
  type DeliveryPointRow,
} from '../../lib/deliveryPointService';
import { getShopBySlug, type ShopRow } from '../../lib/shopService';
import {
  listProjectPermissions,
  listShopAdminPermissions,
  syncProjectAdminsFromShopPool,
  type PermissionRow,
} from '../../lib/permissionService';
import {
  listCardTemplatesByShop,
  type CardTemplateRow,
} from '../../lib/cardService';
import {
  dedupeProductLibraryByShop,
  listProductLibraryByShop,
  syncPublishedProjectToProductLibrary,
  type ProductLibraryRow,
} from '../../lib/productLibraryService';
import { ProductLibraryCombobox } from '../../components/merchant/ProductLibraryCombobox';
import type { BundleToolDoc, ProjectDoc, ProjectProduct } from '../../types/firestore';
import {
  DescriptionLineEditor,
  type DescriptionLineEditorHandle,
} from '../../components/merchant/DescriptionLineEditor';

/** 本地草稿写入 sessionStorage 的防抖间隔（毫秒），减轻主线程 JSON 序列化压力 */
const PROJECT_EDIT_DRAFT_DEBOUNCE_MS = 400;

function toDatetimeLocalValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function tsToDatetimeLocalInput(
  t: Timestamp | null | undefined
): string {
  if (!t || typeof t.toDate !== 'function') return '';
  return toDatetimeLocalValue(t.toDate());
}

function parseMaybeTimestamp(v: unknown): Timestamp | null | undefined {
  if (v == null) return v as null | undefined;
  if (v instanceof Timestamp) return v;
  if (typeof v === 'object') {
    const x = v as { seconds?: unknown; nanoseconds?: unknown; _seconds?: unknown; _nanoseconds?: unknown };
    const sec =
      typeof x.seconds === 'number'
        ? x.seconds
        : typeof x._seconds === 'number'
          ? x._seconds
          : null;
    const nano =
      typeof x.nanoseconds === 'number'
        ? x.nanoseconds
        : typeof x._nanoseconds === 'number'
          ? x._nanoseconds
          : 0;
    if (sec != null) return new Timestamp(sec, nano);
  }
  return undefined;
}

/** 同一套餐内方案名称唯一性：去首尾空白，连续空白视为一格 */
function normalizeBundleSchemeDisplayName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

function normalizeApplicableCardIds(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out = input.filter((x): x is string => typeof x === 'string' && !!x);
  return out.length > 0 ? out : undefined;
}

function getScheduledOffAtTs(row: {
  scheduledOffAt?: ProjectProduct['scheduledOffAt'];
}): Timestamp | null {
  if (!row.scheduledOffAt) return null;
  if (row.scheduledOffAt instanceof Timestamp) return row.scheduledOffAt;
  const t = parseMaybeTimestamp(row.scheduledOffAt as unknown);
  return t instanceof Timestamp ? t : null;
}

function normalizeDraftProducts(input: unknown): ProjectProduct[] {
  if (!Array.isArray(input)) return [];
  return input.map((p, i) => {
    const row = (p ?? {}) as Partial<ProjectProduct>;
    const schedRaw = row.scheduledOffAt;
    const schedParsed =
      schedRaw != null ? parseMaybeTimestamp(schedRaw as unknown) : undefined;
    return {
      id: typeof row.id === 'string' && row.id ? row.id : crypto.randomUUID(),
      name: typeof row.name === 'string' ? row.name : '',
      description: typeof row.description === 'string' ? row.description : '',
      ...(typeof row.purchaseCost === 'number' &&
      !Number.isNaN(row.purchaseCost) &&
      row.purchaseCost >= 0
        ? { purchaseCost: row.purchaseCost }
        : {}),
      price: Number(row.price ?? 0) || 0,
      discountPrice:
        row.discountPrice != null && Number(row.discountPrice) > 0
          ? Number(row.discountPrice)
          : undefined,
      discountStart: parseMaybeTimestamp(row.discountStart) ?? undefined,
      discountEnd: parseMaybeTimestamp(row.discountEnd) ?? null,
      stock: Number(row.stock ?? 0) || 0,
      imageUrl: typeof row.imageUrl === 'string' ? row.imageUrl : undefined,
      isActive: row.isActive !== false,
      sortOrder:
        typeof row.sortOrder === 'number' && Number.isFinite(row.sortOrder)
          ? row.sortOrder
          : i,
      ...(schedParsed instanceof Timestamp ? { scheduledOffAt: schedParsed } : {}),
      applicableCardTemplateIds: normalizeApplicableCardIds(
        (row as { applicableCardTemplateIds?: unknown }).applicableCardTemplateIds
      ),
    } satisfies ProjectProduct;
  });
}

function newProduct(sortOrder: number): ProjectProduct {
  return {
    id: crypto.randomUUID(),
    name: '',
    description: '',
    price: 0,
    stock: 0,
    isActive: true,
    sortOrder,
  };
}

function splitDescription(raw: string): { heading: string; body: string } {
  const text = raw.trim();
  if (!text) return { heading: '', body: '' };
  const lines = text.split('\n');
  const first = lines[0]?.trim() ?? '';
  if (!first.startsWith('# ')) return { heading: '', body: raw };
  const heading = first.replace(/^#\s+/, '').trim();
  const body = lines.slice(1).join('\n').trim();
  return { heading, body };
}

type ProjectImageBlock = NonNullable<ProjectDoc['imageBlocks']>[number];
type DescriptionAsset =
  | { id: string; lineIndex: number; type: 'image-large'; url: string }
  | { id: string; lineIndex: number; type: 'image-small'; urls: string[] }
  | { id: string; lineIndex: number; type: 'file'; name: string; url: string }
  | { id: string; lineIndex: number; type: 'video'; url: string }
  | { id: string; lineIndex: number; type: 'audio'; url: string }
  | { id: string; lineIndex: number; type: 'location'; url: string };

type NewDescriptionAsset =
  | { type: 'image-large'; url: string }
  | { type: 'image-small'; urls: string[] }
  | { type: 'file'; name: string; url: string }
  | { type: 'video'; url: string }
  | { type: 'audio'; url: string }
  | { type: 'location'; url: string };

type ParsedDescriptionLine =
  | { lineNo: number; type: 'text'; text: string }
  | { lineNo: number; type: 'image-large'; url: string }
  | { lineNo: number; type: 'image-small'; urls: string[] }
  | { lineNo: number; type: 'file'; name: string; url: string }
  | { lineNo: number; type: 'video'; url: string }
  | { lineNo: number; type: 'audio'; url: string }
  | { lineNo: number; type: 'location'; url: string };

function parseDescriptionLines(raw: string): ParsedDescriptionLine[] {
  const out: ParsedDescriptionLine[] = [];
  const rows = raw.split('\n');
  rows.forEach((lineRaw, lineNo) => {
    const line = lineRaw.trim();
    if (!line) {
      out.push({ lineNo, type: 'text', text: '' });
      return;
    }
    if (line.startsWith('【大图】')) {
      const url = line.replace('【大图】', '').trim();
      if (url) out.push({ lineNo, type: 'image-large', url });
      return;
    }
    if (line.startsWith('【小图】')) {
      const urls = line
        .replace('【小图】', '')
        .split('|')
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 3);
      if (urls.length) out.push({ lineNo, type: 'image-small', urls });
      return;
    }
    if (line.startsWith('【文件】')) {
      const rest = line.replace('【文件】', '').trim();
      const parts = rest.split(' ');
      const url = parts.pop() ?? '';
      const name = parts.join(' ').trim() || '文件';
      if (url) out.push({ lineNo, type: 'file', name, url });
      return;
    }
    if (line.startsWith('【视频】')) {
      const url = line.replace('【视频】', '').trim();
      if (url) out.push({ lineNo, type: 'video', url });
      return;
    }
    if (line.startsWith('【录音】')) {
      const url = line.replace('【录音】', '').trim();
      if (url) out.push({ lineNo, type: 'audio', url });
      return;
    }
    if (line.startsWith('【定位】')) {
      const url = line.replace('【定位】', '').trim();
      if (url) out.push({ lineNo, type: 'location', url });
      return;
    }
    out.push({ lineNo, type: 'text', text: lineRaw });
  });
  return out;
}

function composeWithLegacyAssets(plain: string, assets: DescriptionAsset[]): string {
  const lines: string[] = [];
  if (plain.trim()) lines.push(plain.trim());
  for (const a of assets) {
    if (a.type === 'image-large') lines.push(`【大图】${a.url}`);
    if (a.type === 'image-small') lines.push(`【小图】${a.urls.join(' | ')}`);
    if (a.type === 'file') lines.push(`【文件】${a.name} ${a.url}`);
    if (a.type === 'video') lines.push(`【视频】${a.url}`);
    if (a.type === 'audio') lines.push(`【录音】${a.url}`);
    if (a.type === 'location') lines.push(`【定位】${a.url}`);
  }
  return lines.join('\n').trim();
}

function parseEditorContent(raw: string): {
  plain: string;
  assets: DescriptionAsset[];
} {
  const parsed = parseDescriptionLines(raw);
  const plainLines: string[] = [];
  const assets: DescriptionAsset[] = [];
  for (const item of parsed) {
    if (item.type === 'text') {
      plainLines.push(item.text);
      continue;
    }
    assets.push({ id: crypto.randomUUID(), lineIndex: plainLines.length, ...item });
  }
  return {
    plain: plainLines.join('\n').trim(),
    assets,
  };
}

function DescriptionAssetCard(props: {
  asset: DescriptionAsset;
  onDelete: () => void;
  onAppendSmall: () => void;
  onFocusLine: () => void;
}) {
  const { asset: a, onDelete, onAppendSmall, onFocusLine } = props;
  return (
    <div className="relative rounded-xl bg-gray-50/80 p-2" onClick={onFocusLine}>
      <button
        type="button"
        className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/45 text-base font-bold text-white"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        aria-label="删除该素材"
        title="删除"
      >
        ×
      </button>
      {a.type === 'image-large' ? (
        <img src={a.url} alt="" className="w-full rounded-lg object-contain" />
      ) : null}
      {a.type === 'image-small' ? (
        <div className="grid grid-cols-3 gap-2">
          {a.urls.map((u) => (
            <img key={u} src={u} alt="" className="aspect-square w-full rounded-lg object-cover" />
          ))}
          {a.urls.length < 3 ? (
            <button
              type="button"
              className="flex aspect-square w-full items-center justify-center rounded-lg border border-dashed border-gray-300 bg-white text-xl text-gray-400"
              onClick={(e) => {
                e.stopPropagation();
                onAppendSmall();
              }}
              title="补充小图"
            >
              +
            </button>
          ) : null}
        </div>
      ) : null}
      {a.type === 'video' ? <video src={a.url} controls className="w-full rounded-lg" /> : null}
      {a.type === 'audio' ? <audio src={a.url} controls className="w-full" /> : null}
      {a.type === 'file' ? (
        <a href={a.url} target="_blank" rel="noreferrer" className="text-indigo-600 underline">
          {a.name}
        </a>
      ) : null}
      {a.type === 'location' ? (
        <a href={a.url} target="_blank" rel="noreferrer" className="text-indigo-600 underline">
          打开定位
        </a>
      ) : null}
    </div>
  );
}


export default function ProjectEdit() {
  const { shopSlug = '', projectId = '' } = useParams<{
    shopSlug: string;
    projectId: string;
  }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuthUser();
  const slug = decodeURIComponent(shopSlug);
  const pid = decodeURIComponent(projectId);
  const isNew = pid === 'new';

  const [bootErr, setBootErr] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);

  const [title, setTitle] = useState('');
  const [closesAt, setClosesAt] = useState(() =>
    toDatetimeLocalValue(new Date(Date.now() + 24 * 60 * 60 * 1000))
  );
  const [textContent, setTextContent] = useState('');
  const [descriptionAssets, setDescriptionAssets] = useState<DescriptionAsset[]>([]);
  const [imageBlocks, setImageBlocks] = useState<ProjectImageBlock[]>([]);
  const [products, setProducts] = useState<ProjectProduct[]>([newProduct(0)]);
  const [bundleTools, setBundleTools] = useState<BundleToolDoc[]>([]);
  const [status, setStatus] = useState<'draft' | 'published' | 'closed'>('draft');

  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [validationHighlightKey, setValidationHighlightKey] = useState<string | null>(null);

  const [shopRow, setShopRow] = useState<ShopRow | null>(null);
  const [shopAdminPool, setShopAdminPool] = useState<PermissionRow[]>([]);
  const [selectedProjectAdminUserIds, setSelectedProjectAdminUserIds] = useState<string[]>([]);
  const [passCardTemplates, setPassCardTemplates] = useState<CardTemplateRow[]>(
    []
  );
  const [deliveryLibrary, setDeliveryLibrary] = useState<DeliveryPointRow[]>(
    []
  );
  const [libraryRows, setLibraryRows] = useState<ProductLibraryRow[]>([]);
  const [selectedDpIds, setSelectedDpIds] = useState<string[]>([]);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const lineEditorRefs = useRef<Record<number, DescriptionLineEditorHandle | null>>({});
  const bigImageInputRef = useRef<HTMLInputElement | null>(null);
  const smallImageInputRef = useRef<HTMLInputElement | null>(null);
  const appendSmallImageInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const [recording, setRecording] = useState(false);
  const [appendSmallTargetLineNo, setAppendSmallTargetLineNo] = useState<number | null>(null);
  const [activeLineIndex, setActiveLineIndex] = useState(0);
  const [activeLineCaret, setActiveLineCaret] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<BlobPart[]>([]);
  const recordStreamRef = useRef<MediaStream | null>(null);

  const resolvedPid = isNew ? '' : pid;
  const draftStorageKey = resolvedPid
    ? `projectEditDraft:${slug}:${resolvedPid}`
    : '';

  type ProjectEditDraft = {
    savedAt: number;
    title: string;
    closesAt: string;
    textContent: string;
    descriptionAssets?: DescriptionAsset[];
    imageBlocks?: ProjectImageBlock[];
    products: ProjectProduct[];
    bundleTools: BundleToolDoc[];
    selectedDpIds: string[];
  };

  /** 供防抖落盘与 pagehide 时立即写入，避免主线程被频繁 JSON.stringify 阻塞 */
  const draftPersistRef = useRef<{ key: string; payload: ProjectEditDraft } | null>(null);

  const DRAFT_TTL_MS = 30 * 60 * 1000;

  const reindexProducts = useCallback(
    (rows: ProjectProduct[]) => rows.map((row, i) => ({ ...row, sortOrder: i })),
    []
  );

  const moveProduct = useCallback(
    (productId: string, direction: -1 | 1) => {
      setProducts((prev) => {
        const idx = prev.findIndex((x) => x.id === productId);
        if (idx < 0) return prev;
        const nextIdx = idx + direction;
        if (nextIdx < 0 || nextIdx >= prev.length) return prev;
        const next = [...prev];
        const [item] = next.splice(idx, 1);
        next.splice(nextIdx, 0, item);
        return reindexProducts(next);
      });
    },
    [reindexProducts]
  );

  const moveBundleTool = useCallback(
    (toolId: string, direction: -1 | 1) => {
      const mixed = [
        ...products.map((p) => ({
          type: 'product' as const,
          id: p.id,
          sortOrder: Number(p.sortOrder ?? 0) || 0,
        })),
        ...bundleTools.map((b) => ({
          type: 'bundle' as const,
          id: b.id,
          sortOrder: Number(b.sortOrder ?? 0) || 0,
        })),
      ].sort((a, b) => a.sortOrder - b.sortOrder);

      const idx = mixed.findIndex((x) => x.type === 'bundle' && x.id === toolId);
      if (idx < 0) return;
      const target = idx + direction;
      if (target < 0 || target >= mixed.length) return;

      const reordered = [...mixed];
      const [picked] = reordered.splice(idx, 1);
      reordered.splice(target, 0, picked);

      const productSort = new Map<string, number>();
      const bundleSort = new Map<string, number>();
      reordered.forEach((x, i) => {
        if (x.type === 'product') productSort.set(x.id, i);
        else bundleSort.set(x.id, i);
      });

      setProducts((prev) =>
        prev.map((p) => ({
          ...p,
          sortOrder: (productSort.get(p.id) ?? Number(p.sortOrder ?? 0)) || 0,
        }))
      );
      setBundleTools((prev) =>
        prev.map((b) => ({
          ...b,
          sortOrder: (bundleSort.get(b.id) ?? Number(b.sortOrder ?? 0)) || 0,
        }))
      );
    },
    [products, bundleTools]
  );

  const removeBundleTool = useCallback((toolId: string) => {
    if (
      !window.confirm(
        '确定删除该套餐工具？将移除其系列、选项、方案与价格等配置；保存草稿或发布后才会写入服务器。'
      )
    ) {
      return;
    }
    setBundleTools((prev) => prev.filter((b) => b.id !== toolId));
  }, []);

  const applyLocalDraftIfAny = useCallback((): boolean => {
    if (!draftStorageKey) return false;
    const raw = sessionStorage.getItem(draftStorageKey);
    if (!raw) return false;
    try {
      const d = JSON.parse(raw) as Partial<ProjectEditDraft>;
      if (!d.savedAt || Date.now() - d.savedAt > DRAFT_TTL_MS) {
        sessionStorage.removeItem(draftStorageKey);
        return false;
      }
      if (typeof d.title === 'string') setTitle(d.title);
      if (typeof d.closesAt === 'string') setClosesAt(d.closesAt);
      if (typeof d.textContent === 'string') {
        const parsed = splitDescription(d.textContent);
        const editor = parseEditorContent(parsed.body);
        setTextContent(editor.plain);
        setDescriptionAssets(editor.assets);
      }
      if (Array.isArray(d.descriptionAssets) && typeof d.textContent === 'string') {
        const parsed = splitDescription(d.textContent);
        const legacyWithLine = d.descriptionAssets.map((a, idx) => ({
          ...a,
          lineIndex: idx,
        }));
        setTextContent(composeWithLegacyAssets(parsed.body, legacyWithLine));
      }
      if (Array.isArray(d.imageBlocks)) setImageBlocks(d.imageBlocks);
      if (Array.isArray(d.products) && d.products.length > 0) {
        setProducts(normalizeDraftProducts(d.products));
      }
      if (Array.isArray(d.bundleTools)) {
        setBundleTools(
          d.bundleTools.map((tool) => {
            const row = tool as BundleToolDoc;
            const sched =
              row.scheduledOffAt != null
                ? parseMaybeTimestamp(row.scheduledOffAt as unknown)
                : null;
            const next = { ...row };
            if (row.scheduledOffAt != null) {
              if (sched instanceof Timestamp) next.scheduledOffAt = sched;
              else delete next.scheduledOffAt;
            }
            return next;
          })
        );
      }
      if (Array.isArray(d.selectedDpIds)) setSelectedDpIds(d.selectedDpIds);
      setMsg('已恢复未保存草稿');
      return true;
    } catch {
      // ignore bad draft
      return false;
    }
  }, [draftStorageKey, DRAFT_TTL_MS]);

  const refreshFromServer = useCallback(async () => {
    if (!resolvedPid) return;
    const row = await getProject(resolvedPid);
    if (!row) {
      setBootErr('项目不存在');
      return;
    }
    setTitle(row.data.title);
    const parsedDesc = splitDescription(row.data.textContent ?? '');
    const editor = parseEditorContent(parsedDesc.body);
    setTextContent(editor.plain);
    setDescriptionAssets(editor.assets);
    setImageBlocks(row.data.imageBlocks ?? []);
    setStatus(row.data.status);
    setClosesAt(
      toDatetimeLocalValue(row.data.closesAt?.toDate?.() ?? new Date())
    );
    const ps = row.data.products?.length
      ? row.data.products
      : [newProduct(0)];
    setProducts(
      ps.map((p, i) => ({
        ...p,
        sortOrder: Number.isFinite(p.sortOrder) ? Number(p.sortOrder) : i,
      }))
    );
    setBundleTools(
      (row.data.bundleTools ?? []).map((x, i) => ({
        ...x,
        sortOrder: Number.isFinite(x.sortOrder) ? x.sortOrder : i,
      }))
    );
    setSelectedDpIds(row.data.deliveryPointIds ?? []);
    applyLocalDraftIfAny();
  }, [resolvedPid, applyLocalDraftIfAny]);

  useEffect(() => {
    if (!shopRow?.data.ownerId) return;
    let cancelled = false;
    void listDeliveryPointsByOwnerId(shopRow.data.ownerId, {
      includeInactive: true,
      fallbackShopId: shopRow.id,
    }).then(
      (rows) => {
        if (!cancelled) setDeliveryLibrary(rows);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [shopRow?.data.ownerId, shopRow?.id]);

  const refreshLibrary = useCallback(async () => {
    if (!shopRow?.id) return;
    try {
      const rows = await listProductLibraryByShop(shopRow.id);
      setLibraryRows(rows);
    } catch {
      setLibraryRows([]);
    }
  }, [shopRow?.id]);

  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  /** 解析店铺 + 权限；新建项目时创建草稿并替换路由 */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (authLoading || !user) {
        setBooting(false);
        return;
      }
      setBootErr(null);
      try {
        const shop = await getShopBySlug(slug);
        if (!shop) {
          if (!cancelled) {
            setBootErr('未找到该商户链接');
            setShopRow(null);
          }
          return;
        }
        if (shop.data.ownerId !== user.uid) {
          if (!cancelled) {
            setBootErr('无权限');
            setShopRow(null);
          }
          return;
        }
        if (!cancelled) setShopRow(shop);
        // 拉取本店的次卡模板（仅 active），供产品 / 套餐方案勾选适配
        try {
          const cards = await listCardTemplatesByShop(shop.id);
          if (!cancelled) {
            setPassCardTemplates(cards.filter((c) => c.data.type === 'pass'));
          }
        } catch {
          if (!cancelled) setPassCardTemplates([]);
        }
        if (isNew) {
          const id = await createDraftProject(shop.id);
          if (!cancelled) {
            navigate(
              `/dashboard/${encodeURIComponent(slug)}/projects/${encodeURIComponent(id)}`,
              { replace: true }
            );
          }
          return;
        }

        await refreshFromServer();
        if (!cancelled) setDraftHydrated(true);
      } catch (e) {
        if (!cancelled) {
          setBootErr(e instanceof Error ? e.message : '加载失败');
        }
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user, slug, isNew, navigate, projectId, refreshFromServer]);

  useEffect(() => {
    if (!draftStorageKey || booting || !draftHydrated) {
      draftPersistRef.current = null;
      return;
    }
    const payload: ProjectEditDraft = {
      savedAt: Date.now(),
      title,
      closesAt,
      textContent,
      imageBlocks,
      products,
      bundleTools,
      selectedDpIds,
    };
    draftPersistRef.current = { key: draftStorageKey, payload };
    const timer = window.setTimeout(() => {
      try {
        sessionStorage.setItem(draftStorageKey, JSON.stringify(payload));
      } catch {
        /* 配额或隐私模式等：忽略 */
      }
    }, PROJECT_EDIT_DRAFT_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [
    draftStorageKey,
    booting,
    draftHydrated,
    title,
    closesAt,
    textContent,
    imageBlocks,
    products,
    bundleTools,
    selectedDpIds,
  ]);

  useEffect(() => {
    const flush = () => {
      const cur = draftPersistRef.current;
      if (!cur) return;
      try {
        sessionStorage.setItem(cur.key, JSON.stringify(cur.payload));
      } catch {
        /* ignore */
      }
    };
    const onVis = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  useEffect(
    () => () => {
      const cur = draftPersistRef.current;
      if (!cur) return;
      try {
        sessionStorage.setItem(cur.key, JSON.stringify(cur.payload));
      } catch {
        /* ignore */
      }
    },
    []
  );

  const activeDeliveryIds = useMemo(() => {
    const set = new Set<string>();
    for (const r of deliveryLibrary) {
      if (r.data.isActive !== false) set.add(r.id);
    }
    return set;
  }, [deliveryLibrary]);

  const normalizedProducts = useMemo(() => {
    return products
      .map((p) => {
        const price = Number(p.price ?? 0) || 0;
        const stock = Number(p.stock ?? 0) || 0;
        const discountPrice =
          p.discountPrice != null && Number(p.discountPrice) > 0
            ? Number(p.discountPrice)
            : null;
        const parsedDiscountStart = parseMaybeTimestamp(
          p.discountStart as unknown
        );
        const parsedDiscountEnd = parseMaybeTimestamp(p.discountEnd as unknown);
        const schedTs =
          p.scheduledOffAt instanceof Timestamp
            ? p.scheduledOffAt
            : parseMaybeTimestamp(p.scheduledOffAt as unknown);
        const purchaseCostRaw = p.purchaseCost;
        const normalized: ProjectProduct = {
          id: p.id,
          name: p.name.trim(),
          description: (p.description ?? '').trim(),
          price,
          stock,
          isActive: p.isActive !== false,
          sortOrder: Number(p.sortOrder ?? 0) || 0,
          ...(typeof p.imageUrl === 'string' && p.imageUrl.trim()
            ? { imageUrl: p.imageUrl.trim() }
            : {}),
          ...(discountPrice != null ? { discountPrice } : {}),
          ...(discountPrice != null && parsedDiscountStart instanceof Timestamp
            ? { discountStart: parsedDiscountStart }
            : {}),
          ...(discountPrice != null
            ? { discountEnd: parsedDiscountEnd instanceof Timestamp ? parsedDiscountEnd : null }
            : {}),
          ...(schedTs instanceof Timestamp ? { scheduledOffAt: schedTs } : {}),
          ...(typeof purchaseCostRaw === 'number' &&
          !Number.isNaN(purchaseCostRaw) &&
          purchaseCostRaw >= 0
            ? { purchaseCost: purchaseCostRaw }
            : {}),
          ...(Array.isArray(p.applicableCardTemplateIds) &&
          p.applicableCardTemplateIds.length > 0
            ? {
                applicableCardTemplateIds: p.applicableCardTemplateIds.filter(
                  (x): x is string => typeof x === 'string' && !!x
                ),
              }
            : {}),
        };
        return normalized;
      })
      .filter((p) => p.name.length > 0)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }, [products]);

  const normalizedBundleTools = useMemo(() => {
    return bundleTools
      .map((tool, i) => {
        const schedTs =
          tool.scheduledOffAt instanceof Timestamp
            ? tool.scheduledOffAt
            : parseMaybeTimestamp(tool.scheduledOffAt as unknown);
        return {
        id: tool.id,
        name: (tool.name ?? '').trim(),
        ...(typeof tool.description === 'string' && tool.description.trim()
          ? { description: tool.description.trim() }
          : {}),
        isActive: tool.isActive !== false,
        sortOrder: Number.isFinite(tool.sortOrder) ? tool.sortOrder : i,
        ...(schedTs instanceof Timestamp ? { scheduledOffAt: schedTs } : {}),
        series: (tool.series ?? [])
          .map((series, si) => {
            const options = (series.options ?? []).map((opt, oi) => ({
              id: opt.id,
              name: (opt.name ?? '').trim(),
              ...(opt.note && opt.note.trim() ? { note: opt.note.trim() } : {}),
              ...(opt.imageUrl && opt.imageUrl.trim()
                ? { imageUrl: opt.imageUrl.trim() }
                : {}),
              stock: Number(opt.stock ?? 0) || 0,
              isActive: opt.isActive !== false,
              sortOrder:
                typeof opt.sortOrder === 'number' && Number.isFinite(opt.sortOrder)
                  ? opt.sortOrder
                  : oi,
            }));
            return {
              id: series.id,
              code: series.code,
              name: (series.name ?? '').trim(),
              options,
              sortOrder:
                typeof series.sortOrder === 'number' && Number.isFinite(series.sortOrder)
                  ? series.sortOrder
                  : si,
            };
          })
          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
        schemes: (tool.schemes ?? [])
          .map((sch, si) => {
            const discountPrice =
              sch.discountPrice != null && Number(sch.discountPrice) > 0
                ? Number(sch.discountPrice)
                : null;
            const parsedDiscountStart = parseMaybeTimestamp(
              sch.discountStart as unknown
            );
            const parsedDiscountEnd = parseMaybeTimestamp(sch.discountEnd as unknown);
            const schCost = (sch as { purchaseCost?: unknown }).purchaseCost;
            const schNote = (sch as { note?: unknown }).note;
            return {
              id: sch.id,
              name: (sch.name ?? '').trim(),
              ...(typeof schNote === 'string' && schNote.trim()
                ? { note: schNote.trim() }
                : {}),
              price: Number(sch.price ?? 0) || 0,
              ...(typeof schCost === 'number' &&
              !Number.isNaN(schCost) &&
              schCost >= 0
                ? { purchaseCost: schCost }
                : {}),
              requirements: Object.fromEntries(
                Object.entries(sch.requirements ?? {}).map(([k, v]) => [
                  k,
                  Number(v ?? 0) || 0,
                ])
              ),
              isActive: sch.isActive !== false,
              sortOrder:
                typeof sch.sortOrder === 'number' && Number.isFinite(sch.sortOrder)
                  ? sch.sortOrder
                  : si,
              ...(discountPrice != null ? { discountPrice } : {}),
              ...(discountPrice != null && parsedDiscountStart instanceof Timestamp
                ? { discountStart: parsedDiscountStart }
                : {}),
              ...(discountPrice != null
                ? { discountEnd: parsedDiscountEnd instanceof Timestamp ? parsedDiscountEnd : null }
                : {}),
              ...(Array.isArray(
                (sch as { applicableCardTemplateIds?: unknown })
                  .applicableCardTemplateIds
              ) &&
              ((sch as { applicableCardTemplateIds?: string[] })
                .applicableCardTemplateIds?.length ?? 0) > 0
                ? {
                    applicableCardTemplateIds: (
                      (sch as { applicableCardTemplateIds: string[] })
                        .applicableCardTemplateIds
                    ).filter((x): x is string => typeof x === 'string' && !!x),
                  }
                : {}),
            };
          })
          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
      };
      })
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }, [bundleTools]);

  const mixedSortPreview = useMemo(() => {
    const productItems = products.map((p) => ({
      id: p.id,
      type: 'product' as const,
      name: p.name?.trim() || '未命名商品',
      sortOrder: Number(p.sortOrder ?? 0) || 0,
    }));
    const bundleItems = bundleTools.map((tool) => ({
      id: tool.id,
      type: 'bundle' as const,
      name: tool.name?.trim() || '未命名套餐',
      sortOrder: Number(tool.sortOrder ?? 0) || 0,
    }));
    return [...productItems, ...bundleItems].sort((a, b) => a.sortOrder - b.sortOrder);
  }, [products, bundleTools]);

  const promotionValidation = useMemo<{
    message: string;
    key: string;
  } | null>(() => {
    for (const p of normalizedProducts) {
      if (p.discountPrice == null) continue;
      if (p.discountPrice > p.price) {
        return {
          message: `商品「${p.name || '未命名商品'}」的优惠价不能高于原价`,
          key: `product:${p.id}`,
        };
      }
    }
    for (const tool of normalizedBundleTools) {
      for (const sch of tool.schemes) {
        if (sch.discountPrice == null) continue;
        if (sch.discountPrice > sch.price) {
          return {
            message: `套餐「${tool.name}」方案「${sch.name || '未命名方案'}」的优惠价不能高于原价`,
            key: `scheme:${sch.id}`,
          };
        }
      }
    }
    return null;
  }, [normalizedProducts, normalizedBundleTools]);

  const bundleSchemeDuplicateValidation = useMemo<{
    message: string;
    key: string;
  } | null>(() => {
    for (const tool of bundleTools) {
      const toolName = (tool.name ?? '').trim() || '未命名套餐';
      const keyToIds = new Map<string, string[]>();
      for (const sch of tool.schemes ?? []) {
        const k = normalizeBundleSchemeDisplayName(sch.name ?? '');
        if (!k) continue;
        const ids = keyToIds.get(k) ?? [];
        ids.push(sch.id);
        keyToIds.set(k, ids);
      }
      for (const [schemeLabel, ids] of keyToIds) {
        if (ids.length > 1) {
          return {
            message: `套餐「${toolName}」内不能有两个同名方案「${schemeLabel}」，请改名后再保存或发布`,
            key: `scheme-dup:${ids[0]}`,
          };
        }
      }
    }
    return null;
  }, [bundleTools]);

  const focusValidationTarget = useCallback((key: string) => {
    setValidationHighlightKey(key);
    queueMicrotask(() => {
      const el = document.getElementById(`validation-${key}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.focus();
      }
    });
  }, []);

  const canPublishByRegularProducts = useMemo(
    () => normalizedProducts.some((p) => p.isActive && p.price > 0 && p.stock > 0),
    [normalizedProducts]
  );

  const canPublishByBundleSchemes = useMemo(
    () =>
      normalizedBundleTools.some(
        (tool) =>
          tool.isActive &&
          tool.schemes.some((sch) => sch.isActive && Number(sch.price) > 0)
      ),
    [normalizedBundleTools]
  );

  const sanitizedDeliveryPointIds = useMemo(
    () => selectedDpIds.filter((id) => activeDeliveryIds.has(id)),
    [selectedDpIds, activeDeliveryIds]
  );

  const toggleDeliveryPoint = (id: string) => {
    setSelectedDpIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const composeDescription = () => {
    const plainLines = textContent.split('\n');
    const sortedAssets = [...descriptionAssets].sort((a, b) => {
      if (a.lineIndex !== b.lineIndex) return a.lineIndex - b.lineIndex;
      return a.id.localeCompare(b.id);
    });
    const bodyLines: string[] = [];
    let assetPtr = 0;
    const pushAsset = (a: DescriptionAsset) => {
      if (a.type === 'image-large') bodyLines.push(`【大图】${a.url}`);
      if (a.type === 'image-small') bodyLines.push(`【小图】${a.urls.join(' | ')}`);
      if (a.type === 'file') bodyLines.push(`【文件】${a.name} ${a.url}`);
      if (a.type === 'video') bodyLines.push(`【视频】${a.url}`);
      if (a.type === 'audio') bodyLines.push(`【录音】${a.url}`);
      if (a.type === 'location') bodyLines.push(`【定位】${a.url}`);
    };
    for (let i = 0; i < plainLines.length; i++) {
      while (assetPtr < sortedAssets.length && sortedAssets[assetPtr]!.lineIndex === i) {
        pushAsset(sortedAssets[assetPtr]!);
        assetPtr += 1;
      }
      bodyLines.push(plainLines[i] ?? '');
    }
    while (assetPtr < sortedAssets.length) {
      pushAsset(sortedAssets[assetPtr]!);
      assetPtr += 1;
    }
    const body = bodyLines.join('\n').trim();
    if (!body) return '';
    return title.trim() ? `# ${title.trim()}\n\n${body}` : body;
  };

  const textLines = useMemo(() => textContent.split('\n'), [textContent]);

  const setLineText = useCallback((idx: number, value: string) => {
    setTextContent((prev) => {
      const lines = prev.split('\n');
      if (idx < 0 || idx >= lines.length) return prev;
      lines[idx] = value;
      return lines.join('\n');
    });
  }, []);

  const insertTextLineAfter = useCallback((idx: number, initial = '') => {
    setTextContent((prev) => {
      const lines = prev.split('\n');
      const at = Math.max(0, Math.min(idx + 1, lines.length));
      lines.splice(at, 0, initial);
      return lines.join('\n');
    });
    setDescriptionAssets((prev) =>
      prev.map((a) => (a.lineIndex > idx ? { ...a, lineIndex: a.lineIndex + 1 } : a))
    );
    queueMicrotask(() => {
      lineEditorRefs.current[idx + 1]?.focusStart();
      setActiveLineIndex(idx + 1);
      setActiveLineCaret(0);
    });
  }, []);

  const splitLineAtCaret = useCallback((idx: number, left: string, right: string) => {
    setTextContent((prev) => {
      const lines = prev.split('\n');
      if (idx < 0 || idx >= lines.length) return prev;
      lines[idx] = left;
      lines.splice(idx + 1, 0, right);
      return lines.join('\n');
    });
    setDescriptionAssets((prev) =>
      prev.map((a) => (a.lineIndex > idx ? { ...a, lineIndex: a.lineIndex + 1 } : a))
    );
    queueMicrotask(() => {
      lineEditorRefs.current[idx + 1]?.focusStart();
      setActiveLineIndex(idx + 1);
      setActiveLineCaret(0);
    });
  }, []);

  /** 将第 idx 行与上一行合并（Backspace 行首、或空行回退） */
  const mergeLineWithPrevious = useCallback((idx: number) => {
    if (idx <= 0) return;
    const boundaryPlain = lineEditorRefs.current[idx - 1]?.getPlainLength() ?? 0;
    setTextContent((prev) => {
      const lines = prev.split('\n');
      if (idx >= lines.length) return prev;
      const merged = `${lines[idx - 1] ?? ''}${lines[idx] ?? ''}`;
      lines[idx - 1] = merged;
      lines.splice(idx, 1);
      return lines.join('\n');
    });
    setDescriptionAssets((prev) =>
      prev.map((a) => (a.lineIndex > idx ? { ...a, lineIndex: a.lineIndex - 1 } : a))
    );
    queueMicrotask(() => {
      const ed = lineEditorRefs.current[idx - 1];
      if (!ed) return;
      ed.setCaretCharacterOffset(boundaryPlain);
      setActiveLineIndex(idx - 1);
      setActiveLineCaret(boundaryPlain);
    });
  }, []);

  const insertAssetAtCursor = useCallback((asset: NewDescriptionAsset) => {
    const lines = textContent.split('\n');
    const lineNo = Math.max(0, Math.min(activeLineIndex, lines.length - 1));
    const ed = lineEditorRefs.current[lineNo];
    const split = ed?.extractSplitAtCaret();
    const currentLine = lines[lineNo] ?? '';
    const left = split?.left ?? currentLine.slice(0, activeLineCaret);
    const right = split?.right ?? currentLine.slice(activeLineCaret);
    const nextLines = [
      ...lines.slice(0, lineNo),
      left,
      right,
      ...lines.slice(lineNo + 1),
    ];
    setTextContent(nextLines.join('\n'));
    const insertLineIndex = lineNo + 1;
    setDescriptionAssets((prevAssets) => [
      ...prevAssets.map((a) =>
        a.lineIndex >= insertLineIndex ? { ...a, lineIndex: a.lineIndex + 1 } : a
      ),
      { id: crypto.randomUUID(), lineIndex: insertLineIndex, ...asset },
    ]);
    queueMicrotask(() => {
      lineEditorRefs.current[insertLineIndex + 1]?.focusStart();
      setActiveLineIndex(insertLineIndex + 1);
      setActiveLineCaret(0);
    });
  }, [activeLineCaret, activeLineIndex, textContent]);

  const focusEditorAtLine = useCallback((lineIndex: number) => {
    const ed = lineEditorRefs.current[lineIndex];
    if (!ed) return;
    ed.focusEnd();
    const len = ed.getPlainLength();
    setActiveLineIndex(lineIndex);
    setActiveLineCaret(len);
  }, []);

  const uploadDescriptionAsset = async (file: File) => {
    if (!shopRow) throw new Error('商户信息未加载完成');
    return uploadProjectAsset(shopRow.data.ownerId, file, 'description');
  };

  const appendUploadedLine = async (
    file: File,
    label: string,
    onUploaded: (url: string, f: File) => void
  ) => {
    try {
      const url = await uploadDescriptionAsset(file);
      onUploaded(url, file);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : `${label}上传失败`);
    }
  };

  const startAudioRecord = async () => {
    if (recording) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setMsg('当前浏览器不支持录音');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordChunksRef.current = [];
      recordStreamRef.current = stream;
      recorderRef.current = recorder;
      recorder.ondataavailable = (ev) => {
        if (ev.data?.size) recordChunksRef.current.push(ev.data);
      };
      recorder.start();
      setRecording(true);
      setMsg('录音中…再次点击「停止录音」保存到说明区');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '无法开始录音');
    }
  };

  const stopAudioRecord = async () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });
    setRecording(false);
    recordStreamRef.current?.getTracks().forEach((t) => t.stop());
    const type = recorder.mimeType || 'audio/webm';
    const blob = new Blob(recordChunksRef.current, { type });
    const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
    const file = new File([blob], `record-${Date.now()}.${ext}`, { type });
    await appendUploadedLine(file, '录音', (url) => insertAssetAtCursor({ type: 'audio', url }));
  };

  const coverBlock = useMemo(
    () => imageBlocks.find((b) => b.isCoverImage),
    [imageBlocks]
  );
  const resolvedBannerUrl = (coverBlock?.url?.trim() || shopRow?.data.bannerImage?.trim() || '');

  const upsertCoverImage = (url: string) => {
    setImageBlocks((prev) => {
      const rest = prev.filter((x) => !x.isCoverImage);
      return [{ url, caption: '项目头图', isCoverImage: true }, ...rest];
    });
  };

  useEffect(
    () => () => {
      recordStreamRef.current?.getTracks().forEach((t) => t.stop());
    },
    []
  );

  useEffect(() => {
    if (!shopRow?.id || !resolvedPid) {
      setShopAdminPool([]);
      setSelectedProjectAdminUserIds([]);
      return;
    }
    let cancelled = false;
    void Promise.all([
      listShopAdminPermissions(shopRow.id),
      listProjectPermissions(resolvedPid),
    ])
      .then(([pool, projectPerms]) => {
        if (cancelled) return;
        setShopAdminPool(pool);
        const poolSet = new Set(pool.map((x) => x.data.userId));
        const selected = projectPerms
          .map((p) => p.data.userId)
          .filter((uid) => poolSet.has(uid));
        setSelectedProjectAdminUserIds(Array.from(new Set(selected)));
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setShopAdminPool([]);
        setSelectedProjectAdminUserIds([]);
      });
    return () => {
      cancelled = true;
    };
  }, [shopRow?.id, resolvedPid]);

  const handleSaveDraft = async () => {
    if (!resolvedPid) return;
    if (bundleSchemeDuplicateValidation) {
      setMsg(bundleSchemeDuplicateValidation.message);
      focusValidationTarget(bundleSchemeDuplicateValidation.key);
      return;
    }
    if (promotionValidation) {
      setMsg(promotionValidation.message);
      focusValidationTarget(promotionValidation.key);
      return;
    }
    setValidationHighlightKey(null);
    setSaving(true);
    setMsg(null);
    try {
      const d = new Date(closesAt);
      await updateProjectDoc(resolvedPid, {
        title: title.trim() || '未命名项目',
        closesAt: Timestamp.fromDate(d),
        textContent: composeDescription(),
        imageBlocks,
        products: normalizedProducts.length ? normalizedProducts : [],
        bundleTools: normalizedBundleTools,
        deliveryPointIds: sanitizedDeliveryPointIds,
        status: 'draft',
        publishedAt: null,
      });
      if (user && shopRow?.id) {
        await syncProjectAdminsFromShopPool({
          projectId: resolvedPid,
          shopId: shopRow.id,
          selectedUserIds: selectedProjectAdminUserIds,
          grantedBy: user.uid,
        });
      }
      if (draftStorageKey) sessionStorage.removeItem(draftStorageKey);
      setMsg('已保存草稿');
    } catch (e) {
      if (e instanceof FirebaseError) {
        setMsg(`保存失败（${e.code}）：${e.message}`);
      } else {
        setMsg(e instanceof Error ? e.message : '保存失败');
      }
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!resolvedPid) return;
    if (bundleSchemeDuplicateValidation) {
      setMsg(bundleSchemeDuplicateValidation.message);
      focusValidationTarget(bundleSchemeDuplicateValidation.key);
      return;
    }
    if (promotionValidation) {
      setMsg(promotionValidation.message);
      focusValidationTarget(promotionValidation.key);
      return;
    }
    setValidationHighlightKey(null);
    const t = title.trim();
    if (!t) {
      setMsg('请填写项目标题');
      return;
    }
    if (!canPublishByRegularProducts && !canPublishByBundleSchemes) {
      setMsg('请至少保留一个可售项：普通商品（上架+价格>0+库存>0）或启用中的套餐方案（价格>0）');
      return;
    }
    setPublishing(true);
    setMsg(null);
    try {
      const d = new Date(closesAt);
      await updateProjectDoc(resolvedPid, {
        title: t,
        closesAt: Timestamp.fromDate(d),
        textContent: composeDescription(),
        imageBlocks,
        products: normalizedProducts,
        bundleTools: normalizedBundleTools,
        deliveryPointIds: sanitizedDeliveryPointIds,
        status: 'published',
        publishedAt: Timestamp.now(),
      });
      if (user && shopRow?.id) {
        await syncProjectAdminsFromShopPool({
          projectId: resolvedPid,
          shopId: shopRow.id,
          selectedUserIds: selectedProjectAdminUserIds,
          grantedBy: user.uid,
        });
      }
      if (draftStorageKey) sessionStorage.removeItem(draftStorageKey);
      setStatus('published');
      let pubMsg = '已发布（顾客端读 Firestore 将在下一步接上）';
      if (shopRow?.id) {
        try {
          await syncPublishedProjectToProductLibrary(
            shopRow.id,
            shopRow.data.ownerId,
            normalizedProducts,
            normalizedBundleTools
          );
          await dedupeProductLibraryByShop(shopRow.id);
          void refreshLibrary();
          pubMsg =
            '已发布；商品库已自动同步当前上架商品与套餐方案（同名覆盖，无重名）';
        } catch {
          pubMsg = '已发布；商品库自动同步失败，请稍后在「商品库」页检查';
        }
      }
      setMsg(pubMsg);
    } catch (e) {
      if (e instanceof FirebaseError) {
        setMsg(`发布失败（${e.code}）：${e.message}`);
      } else {
        setMsg(e instanceof Error ? e.message : '发布失败');
      }
    } finally {
      setPublishing(false);
    }
  };

  const base = `/dashboard/${encodeURIComponent(slug)}`;

  if (authLoading || booting || isNew) {
    return (
      <PageShell title="编辑项目" subtitle={isNew ? '正在创建草稿…' : '加载中…'}>
        <p className="text-sm text-gray-600">请稍候…</p>
      </PageShell>
    );
  }

  if (!user) {
    return (
      <PageShell title="编辑项目" subtitle="未登录">
        <Link className="text-indigo-600 underline-offset-2 hover:underline" to="/dashboard">
          返回后台入口
        </Link>
      </PageShell>
    );
  }

  if (bootErr) {
    return (
      <PageShell title="编辑项目" subtitle="错误">
        <p className="text-sm text-red-600">{bootErr}</p>
        <Link className="mt-3 inline-block text-indigo-600 underline-offset-2 hover:underline" to={`${base}/projects`}>
          返回项目列表
        </Link>
      </PageShell>
    );
  }

  const input =
    'mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[16px] leading-6 text-gray-900 shadow-sm transition focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100';
  const toolBtn =
    'rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-[15px] text-gray-800 shadow-sm transition active:scale-[0.99]';

  const addBundleTool = () => {
    const maxProductSort = products.reduce(
      (m, x) => Math.max(m, Number(x.sortOrder ?? 0) || 0),
      -1
    );
    const maxBundleSort = bundleTools.reduce(
      (m, x) => Math.max(m, Number(x.sortOrder ?? 0) || 0),
      -1
    );
    const nextSort = Math.max(maxProductSort, maxBundleSort) + 1;
    setBundleTools((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name: `套餐 ${prev.length + 1}`,
        isActive: true,
        sortOrder: nextSort,
        series: [],
        schemes: [],
      },
    ]);
  };

  const seriesCodeAt = (idx: number) => String.fromCharCode(65 + idx);

  return (
    <PageShell title="编辑项目" subtitle={`状态：${status === 'draft' ? '草稿' : status === 'published' ? '已发布' : '已截止'}`}>
      {msg ? (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{msg}</p>
      ) : null}

      <div className="space-y-5">
        <label className="block text-sm font-medium text-gray-800">
          项目标题
          <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="block text-sm font-medium text-gray-800">
          截止时间（本地时间）
          <input
            type="datetime-local"
            className={input}
            value={closesAt}
            onChange={(e) => setClosesAt(e.target.value)}
          />
        </label>
        <section className="rounded-xl border border-gray-100 bg-white p-3">
          <div className="mb-1 text-sm font-semibold text-gray-900">项目管理员</div>
          <p className="mb-2 text-xs text-gray-500">
            先在「管理员管理」邀请加入店铺，再在此分配到当前项目。
          </p>
          {shopAdminPool.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-300 px-3 py-3 text-xs text-gray-500">
              暂无店铺管理员可分配。
            </p>
          ) : (
            <div className="space-y-2">
              {shopAdminPool.map((p) => {
                const checked = selectedProjectAdminUserIds.includes(p.data.userId);
                return (
                  <label
                    key={p.id}
                    className="flex cursor-pointer items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-xs text-gray-800"
                  >
                    <span>
                      用户 {p.data.userId.slice(-8)}
                      <span className="ml-1 text-gray-500">
                        （{p.data.role === 'high_admin' ? '高级管理员' : '普通管理员'}）
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={checked}
                      onChange={(e) => {
                        const on = e.target.checked;
                        setSelectedProjectAdminUserIds((prev) => {
                          if (on) return Array.from(new Set([...prev, p.data.userId]));
                          return prev.filter((x) => x !== p.data.userId);
                        });
                      }}
                    />
                  </label>
                );
              })}
            </div>
          )}
        </section>
        <section className="rounded-2xl border border-gray-100 bg-gradient-to-b from-gray-50 to-white p-3.5 shadow-sm">
          <div className="mb-2 text-base font-semibold text-gray-900">项目 Banner 与说明</div>
          <div className="mb-3 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="relative h-40 w-full bg-gray-100">
              {resolvedBannerUrl ? (
                <img
                  src={resolvedBannerUrl}
                  alt="项目头图"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-gray-500">
                  未设置头图
                </div>
              )}
              <label className="absolute bottom-2 right-2 cursor-pointer rounded-lg bg-black/55 px-2.5 py-1 text-xs text-white shadow">
                点击更换图片
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file || !shopRow) return;
                    void uploadProjectAsset(shopRow.data.ownerId, file, 'description')
                      .then((url) => upsertCoverImage(url))
                      .catch((err) =>
                        setMsg(err instanceof Error ? err.message : '图片上传失败')
                      )
                      .finally(() => {
                        e.currentTarget.value = '';
                      });
                  }}
                />
              </label>
            </div>
          </div>
          <div className="mb-2 block text-sm font-medium text-gray-800">
            输入描述说明
            <div className="mt-1 rounded-lg bg-indigo-50/60 px-3 py-2 text-xs leading-5 text-indigo-700">
              建议：先选中文字再点稍小/稍大；可多次叠加。工具栏在按下时生效，避免选区丢失。
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-medium text-gray-500">本行选区：</span>
              <button
                type="button"
                className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-sm text-gray-800 shadow-sm"
                onMouseDown={(e) => {
                  e.preventDefault();
                  lineEditorRefs.current[activeLineIndex]?.toggleSmall();
                }}
              >
                稍小
              </button>
              <button
                type="button"
                className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-sm text-gray-800 shadow-sm"
                onMouseDown={(e) => {
                  e.preventDefault();
                  lineEditorRefs.current[activeLineIndex]?.toggleLarge();
                }}
              >
                稍大
              </button>
            </div>
            <div className="mt-2 space-y-1 rounded-xl border border-gray-200 bg-white px-3 py-2.5 shadow-sm">
              {[...descriptionAssets].filter((x) => x.lineIndex === 0).map((a) => (
                <DescriptionAssetCard
                  key={a.id}
                  asset={a}
                  onDelete={() => setDescriptionAssets((prev) => prev.filter((x) => x.id !== a.id))}
                  onAppendSmall={() => {
                    setAppendSmallTargetLineNo(a.lineIndex);
                    appendSmallImageInputRef.current?.click();
                  }}
                  onFocusLine={() => focusEditorAtLine(0)}
                />
              ))}
              {textLines.map((line, idx) => (
                <div key={`line-${idx}`} className="space-y-1">
                  <DescriptionLineEditor
                    ref={(r) => {
                      lineEditorRefs.current[idx] = r;
                    }}
                    lineIndex={idx}
                    value={line}
                    placeholder={idx === 0 ? '输入描述说明' : ''}
                    onChange={(markers) => setLineText(idx, markers)}
                    onSplitLine={(left, right) => splitLineAtCaret(idx, left, right)}
                    onMergeWithPrevious={() => mergeLineWithPrevious(idx)}
                    onGoToPreviousLineEnd={() => {
                      const ed = lineEditorRefs.current[idx - 1];
                      if (!ed) return;
                      ed.focusEnd();
                      setActiveLineIndex(idx - 1);
                      setActiveLineCaret(ed.getPlainLength());
                    }}
                    onGoToNextLineStart={() => {
                      const ed = lineEditorRefs.current[idx + 1];
                      if (!ed) return;
                      ed.focusStart();
                      setActiveLineIndex(idx + 1);
                      setActiveLineCaret(0);
                    }}
                    canMergeUp={idx > 0}
                    hasLineAbove={idx > 0}
                    hasLineBelow={idx < textLines.length - 1}
                    onFocus={() => setActiveLineIndex(idx)}
                  />
                  {[...descriptionAssets]
                    .filter((x) => x.lineIndex === idx + 1)
                    .map((a) => (
                      <DescriptionAssetCard
                        key={a.id}
                        asset={a}
                        onDelete={() =>
                          setDescriptionAssets((prev) => prev.filter((x) => x.id !== a.id))
                        }
                        onAppendSmall={() => {
                          setAppendSmallTargetLineNo(a.lineIndex);
                          appendSmallImageInputRef.current?.click();
                        }}
                        onFocusLine={() => focusEditorAtLine(idx + 1)}
                      />
                    ))}
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2.5 text-sm">
            <button
              type="button"
              className={toolBtn}
              onClick={() => insertTextLineAfter(activeLineIndex)}
            >
              + 文字
            </button>
            <button type="button" className={toolBtn} onClick={() => bigImageInputRef.current?.click()}>+ 大图</button>
            <button type="button" className={toolBtn} onClick={() => smallImageInputRef.current?.click()}>+ 小图</button>
            <button type="button" className={toolBtn} onClick={() => fileInputRef.current?.click()}>+ 文件</button>
            <button type="button" className={toolBtn} onClick={() => videoInputRef.current?.click()}>+ 视频</button>
            <button type="button" className={toolBtn} onClick={() => void startAudioRecord()} disabled={recording}>+ 录音</button>
            {recording ? (
              <button type="button" className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-1.5 text-[15px] font-medium text-rose-700 shadow-sm" onClick={() => void stopAudioRecord()}>
                停止录音
              </button>
            ) : null}
            <button
              type="button"
              className={toolBtn}
              onClick={() => {
                const custom = window.prompt(
                  '输入任意地址或地图链接；留空则使用当前位置',
                  ''
                );
                const value = custom?.trim() ?? '';
                if (value) {
                  const isUrl = /^https?:\/\//i.test(value);
                  insertAssetAtCursor({
                    type: 'location',
                    url: isUrl
                      ? value
                      : `https://maps.google.com/?q=${encodeURIComponent(value)}`,
                  });
                  return;
                }
                if (!navigator.geolocation) {
                  setMsg('当前浏览器不支持定位，请手动输入地址或地图链接');
                  return;
                }
                navigator.geolocation.getCurrentPosition(
                  (pos) => {
                    const lat = pos.coords.latitude.toFixed(6);
                    const lng = pos.coords.longitude.toFixed(6);
                    insertAssetAtCursor({
                      type: 'location',
                      url: `https://maps.google.com/?q=${lat},${lng}`,
                    });
                  },
                  () => {
                    setMsg('定位失败，请手动输入地址或地图链接');
                  }
                );
              }}
            >
              + 定位
            </button>
          </div>
          <input
            ref={bigImageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                void appendUploadedLine(file, '大图', (url) =>
                  insertAssetAtCursor({ type: 'image-large', url })
                );
              }
              e.currentTarget.value = '';
            }}
          />
          <input
            ref={smallImageInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []).slice(0, 3);
              if (files.length === 0) return;
              void (async () => {
                const urls: string[] = [];
                for (const f of files) {
                  try {
                    urls.push(await uploadDescriptionAsset(f));
                  } catch (err) {
                    setMsg(err instanceof Error ? err.message : '小图上传失败');
                    return;
                  }
                }
                insertAssetAtCursor({ type: 'image-small', urls });
              })();
              e.currentTarget.value = '';
            }}
          />
          <input
            ref={appendSmallImageInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const target = appendSmallTargetLineNo;
              const files = Array.from(e.target.files ?? []);
              e.currentTarget.value = '';
              if (target == null || files.length === 0) return;
              void (async () => {
                const line = descriptionAssets.find(
                  (x): x is Extract<DescriptionAsset, { type: 'image-small' }> =>
                    x.type === 'image-small' && x.lineIndex === target
                );
                if (!line) return;
                const remain = Math.max(0, 3 - line.urls.length);
                if (remain <= 0) return;
                const picked = files.slice(0, remain);
                const urls: string[] = [];
                for (const f of picked) {
                  try {
                    urls.push(await uploadDescriptionAsset(f));
                  } catch (err) {
                    setMsg(err instanceof Error ? err.message : '小图上传失败');
                    return;
                  }
                }
                const merged = [...line.urls, ...urls].slice(0, 3);
                setDescriptionAssets((prev) =>
                  prev.map((x) =>
                    x.id === line.id && x.type === 'image-small'
                      ? { ...x, urls: merged }
                      : x
                  )
                );
                setAppendSmallTargetLineNo(null);
              })();
            }}
          />
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                void appendUploadedLine(file, '文件', (url, f) =>
                  insertAssetAtCursor({ type: 'file', name: f.name, url })
                );
              }
              e.currentTarget.value = '';
            }}
          />
          <input
            ref={videoInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                void appendUploadedLine(file, '视频', (url) =>
                  insertAssetAtCursor({ type: 'video', url })
                );
              }
              e.currentTarget.value = '';
            }}
          />
        </section>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-900">商品清单</span>
            <button
              type="button"
              className="text-sm font-medium text-indigo-600"
              onClick={() =>
                setProducts((prev) => {
                  const maxProductSort = prev.reduce(
                    (m, x) => Math.max(m, Number(x.sortOrder ?? 0) || 0),
                    -1
                  );
                  const maxBundleSort = bundleTools.reduce(
                    (m, x) => Math.max(m, Number(x.sortOrder ?? 0) || 0),
                    -1
                  );
                  const nextSort = Math.max(maxProductSort, maxBundleSort) + 1;
                  return [...prev, newProduct(nextSort)];
                })
              }
            >
              + 添加商品
            </button>
          </div>
          <div className="mb-3 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2">
            <div className="mb-1 text-xs font-medium text-indigo-700">前端展示顺序预览（商品 + 套餐）</div>
            <div className="flex flex-wrap gap-1.5">
              {mixedSortPreview.map((item, i) => (
                <span
                  key={`${item.type}:${item.id}`}
                  className={`rounded-full px-2 py-0.5 text-[11px] ${
                    item.type === 'bundle'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-white text-slate-700'
                  }`}
                >
                  {i + 1}. {item.type === 'bundle' ? '套餐' : '商品'}：{item.name}
                </span>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            {products.map((p, idx) => (
              <div
                key={p.id}
                className="rounded-xl border border-gray-100 bg-gray-50 p-3"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-500">商品 {idx + 1}</span>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-xs text-gray-700">
                      <input
                        type="checkbox"
                        checked={!p.isActive}
                        onChange={(e) => {
                          const delist = e.target.checked;
                          setProducts((prev) =>
                            prev.map((x) => {
                              if (x.id !== p.id) return x;
                              if (delist) {
                                const next = { ...x, isActive: false };
                                delete next.scheduledOffAt;
                                return next;
                              }
                              return { ...x, isActive: true };
                            })
                          );
                        }}
                      />
                      下架
                    </label>
                    <span className="flex flex-wrap items-center gap-1.5 text-xs text-gray-700">
                      <label
                        className={`flex items-center gap-1.5 ${p.isActive ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
                        title={
                          p.isActive
                            ? undefined
                            : '请先取消「下架」后再设置定时下架'
                        }
                      >
                        <input
                          type="checkbox"
                          disabled={!p.isActive}
                          checked={Boolean(getScheduledOffAtTs(p))}
                          onChange={(e) => {
                            const on = e.target.checked;
                            setProducts((prev) =>
                              prev.map((x) => {
                                if (x.id !== p.id) return x;
                                if (!on) {
                                  const next = { ...x };
                                  delete next.scheduledOffAt;
                                  return next;
                                }
                                const withListing = { ...x, isActive: true };
                                if (getScheduledOffAtTs(withListing)) return withListing;
                                return {
                                  ...withListing,
                                  scheduledOffAt: Timestamp.fromMillis(
                                    Date.now() + 60 * 60 * 1000
                                  ),
                                };
                              })
                            );
                          }}
                        />
                        定时下架
                      </label>
                      {getScheduledOffAtTs(p) ? (
                        <input
                          type="datetime-local"
                          disabled={!p.isActive}
                          className="max-w-[11rem] rounded border border-gray-200 bg-white px-1.5 py-1 text-[11px] text-gray-800 shadow-inner disabled:cursor-not-allowed disabled:opacity-60 sm:max-w-none"
                          value={tsToDatetimeLocalInput(getScheduledOffAtTs(p))}
                          onChange={(e) => {
                            const v = e.target.value;
                            setProducts((prev) =>
                              prev.map((x) => {
                                if (x.id !== p.id) return x;
                                if (!v) {
                                  const next = { ...x };
                                  delete next.scheduledOffAt;
                                  return next;
                                }
                                const d = new Date(v);
                                if (Number.isNaN(d.getTime())) return x;
                                return { ...x, scheduledOffAt: Timestamp.fromDate(d) };
                              })
                            );
                          }}
                        />
                      ) : null}
                    </span>
                    <div className="flex items-center gap-1 text-xs">
                      <button
                        type="button"
                        className="rounded border border-gray-200 bg-white px-2 py-1 text-gray-700 disabled:text-gray-300"
                        disabled={idx === 0}
                        onClick={() => moveProduct(p.id, -1)}
                      >
                        上移
                      </button>
                      <button
                        type="button"
                        className="rounded border border-gray-200 bg-white px-2 py-1 text-gray-700 disabled:text-gray-300"
                        disabled={idx === products.length - 1}
                        onClick={() => moveProduct(p.id, 1)}
                      >
                        下移
                      </button>
                    </div>
                  </div>
                </div>
                <div className="mb-2 flex items-start gap-3">
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-white">
                    {p.imageUrl ? (
                      <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[10px] text-gray-400">无图</div>
                    )}
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-gray-700">
                      商品图片（可选）
                      <input
                        type="file"
                        accept="image/*"
                        className="mt-1 block w-full text-xs"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.currentTarget.value = '';
                          if (!file || !user) return;
                          void uploadProjectAsset(user.uid, file, 'product')
                            .then((url) => {
                              setProducts((prev) =>
                                prev.map((x) => (x.id === p.id ? { ...x, imageUrl: url } : x))
                              );
                            })
                            .catch((err: unknown) =>
                              setMsg(err instanceof Error ? err.message : '图片上传失败')
                            );
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      className="mt-1 text-xs text-red-600 disabled:text-gray-400"
                      disabled={!p.imageUrl}
                      onClick={() =>
                        setProducts((prev) =>
                          prev.map((x) =>
                            x.id === p.id ? { ...x, imageUrl: undefined } : x
                          )
                        )
                      }
                    >
                      删除图片
                    </button>
                  </div>
                </div>
                <label className="mb-2 block text-xs text-gray-700">
                  名称（输入即筛选商品库，点选套用）
                  <ProductLibraryCombobox
                    className="mt-1"
                    items={libraryRows}
                    kindFilter="product"
                    value={p.name}
                    onChangeValue={(v) =>
                      setProducts((prev) =>
                        prev.map((x) => (x.id === p.id ? { ...x, name: v } : x))
                      )
                    }
                    onPickRow={(row) => {
                      setProducts((prev) =>
                        prev.map((x) =>
                          x.id === p.id
                            ? {
                                ...x,
                                name: row.data.name,
                                imageUrl: row.data.imageUrl,
                                purchaseCost: row.data.purchaseCost,
                                price: row.data.retailPrice,
                                description: row.data.note ?? '',
                              }
                            : x
                        )
                      );
                      setMsg('已从商品库套用');
                    }}
                    inputClassName={input}
                    placeholder="名称"
                  />
                </label>
                <textarea
                  className={`${input} mt-2 min-h-[3rem]`}
                  placeholder="说明文字（显示在名称下方）"
                  value={p.description ?? ''}
                  onChange={(e) =>
                    setProducts((prev) =>
                      prev.map((x) =>
                        x.id === p.id ? { ...x, description: e.target.value } : x
                      )
                    )
                  }
                />
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <label className="text-xs text-gray-700">
                    价格 (RM)
                    <input
                      type="number"
                      min={0}
                      step="0.1"
                      className={input}
                      value={p.price || ''}
                      onChange={(e) =>
                        setProducts((prev) =>
                          prev.map((x) =>
                            x.id === p.id
                              ? { ...x, price: Number(e.target.value) || 0 }
                              : x
                          )
                        )
                      }
                    />
                  </label>
                  <label className="text-xs text-gray-700">
                    库存
                    <input
                      type="number"
                      min={0}
                      step="1"
                      className={input}
                      value={p.stock || ''}
                      onChange={(e) =>
                        setProducts((prev) =>
                          prev.map((x) =>
                            x.id === p.id
                              ? { ...x, stock: Number(e.target.value) || 0 }
                              : x
                          )
                        )
                      }
                    />
                  </label>
                  <label className="text-xs text-gray-700">
                    采购成本 (RM)
                    <input
                      type="number"
                      min={0}
                      step="0.1"
                      className={input}
                      placeholder="可选"
                      value={p.purchaseCost ?? ''}
                      onChange={(e) =>
                        setProducts((prev) =>
                          prev.map((x) =>
                            x.id === p.id
                              ? {
                                  ...x,
                                  purchaseCost:
                                    e.target.value.trim() === ''
                                      ? undefined
                                      : Math.max(0, Number(e.target.value) || 0),
                                }
                              : x
                          )
                        )
                      }
                    />
                  </label>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="text-xs text-gray-700">
                    优惠价 (RM，可选)
                    <input
                      id={`validation-product:${p.id}`}
                      type="number"
                      min={0}
                      step="0.1"
                      className={`${input} ${
                        validationHighlightKey === `product:${p.id}`
                          ? 'border-red-500 ring-2 ring-red-200'
                          : ''
                      }`}
                      value={p.discountPrice ?? ''}
                      onChange={(e) =>
                        {
                          setValidationHighlightKey(null);
                          setProducts((prev) =>
                            prev.map((x) =>
                              x.id === p.id
                                ? {
                                    ...x,
                                    discountPrice:
                                      e.target.value.trim() === ''
                                        ? undefined
                                        : Number(e.target.value) || 0,
                                  }
                                : x
                            )
                          );
                        }
                      }
                    />
                  </label>
                  <div className="text-xs text-gray-700">
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="min-w-0 flex-1">
                        优惠结束时间（可选）
                        <input
                          type="datetime-local"
                          className={input}
                          value={tsToDatetimeLocalInput(p.discountEnd ?? null)}
                          onChange={(e) => {
                            const raw = e.target.value;
                            setProducts((prev) =>
                              prev.map((x) =>
                                x.id === p.id
                                  ? {
                                      ...x,
                                      discountEnd: raw
                                        ? Timestamp.fromDate(new Date(raw))
                                        : null,
                                    }
                                  : x
                              )
                            );
                          }}
                        />
                      </label>
                      {p.discountEnd ? (
                        <button
                          type="button"
                          className="shrink-0 rounded border border-gray-200 bg-white px-2 py-1.5 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
                          onClick={() =>
                            setProducts((prev) =>
                              prev.map((x) =>
                                x.id === p.id ? { ...x, discountEnd: null } : x
                              )
                            )
                          }
                        >
                          清除截止
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
                <p className="mt-1 text-[11px] text-gray-500">
                  规则：不填优惠价=普通；填优惠价=特惠；再填结束时间=早鸟价。
                </p>
                {passCardTemplates.length > 0 ? (
                  <div className="mt-3 rounded-lg border border-gray-100 bg-white p-2">
                    <div className="mb-1 text-[11px] font-medium text-gray-700">
                      适配次卡（顾客可用此次卡抵扣本商品）
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {passCardTemplates.map((c) => {
                        const checked =
                          p.applicableCardTemplateIds?.includes(c.id) ?? false;
                        return (
                          <label
                            key={c.id}
                            className={`flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-[11px] ${
                              checked
                                ? 'border-purple-300 bg-purple-50 text-purple-800'
                                : 'border-gray-200 bg-white text-gray-700'
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="h-3 w-3"
                              checked={checked}
                              onChange={(e) => {
                                const next = e.target.checked;
                                setProducts((prev) =>
                                  prev.map((x) => {
                                    if (x.id !== p.id) return x;
                                    const cur = Array.isArray(
                                      x.applicableCardTemplateIds
                                    )
                                      ? x.applicableCardTemplateIds
                                      : [];
                                    const set = new Set(cur);
                                    if (next) set.add(c.id);
                                    else set.delete(c.id);
                                    const arr = Array.from(set);
                                    return {
                                      ...x,
                                      applicableCardTemplateIds:
                                        arr.length > 0 ? arr : undefined,
                                    };
                                  })
                                );
                              }}
                            />
                            {c.data.name}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    className="text-xs text-red-600"
                    onClick={() =>
                      setProducts((prev) =>
                        prev.length > 1
                          ? prev.filter((x) => x.id !== p.id)
                          : prev
                      )
                    }
                  >
                    删除本行
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-900">套餐工具（可选）</span>
            <button
              type="button"
              className="text-xs font-medium text-indigo-600"
              onClick={addBundleTool}
            >
              + 添加套餐工具
            </button>
          </div>
          {bundleTools.length === 0 ? (
            <p className="text-xs text-gray-500">
              未启用套餐工具。启用后可配置系列（最多 5 组）、组合方案与价格。
            </p>
          ) : (
            <div className="space-y-4">
              {bundleTools.map((tool) => (
                <div key={tool.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                  <label className="block text-xs text-gray-700">
                    套餐名称
                    <input
                      className={input}
                      value={tool.name}
                      onChange={(e) =>
                        setBundleTools((prev) =>
                          prev.map((x) =>
                            x.id === tool.id ? { ...x, name: e.target.value } : x
                          )
                        )
                      }
                    />
                  </label>
                  <label className="mt-2 block text-xs text-gray-700">
                    备注（显示在套餐名下方，可选）
                    <textarea
                      className={`${input} min-h-[3rem]`}
                      placeholder="例如：每天 11:30 开始备餐，先选方案再点菜品"
                      value={tool.description ?? ''}
                      onChange={(e) =>
                        setBundleTools((prev) =>
                          prev.map((x) =>
                            x.id === tool.id ? { ...x, description: e.target.value } : x
                          )
                        )
                      }
                    />
                  </label>
                  <div className="mt-2 flex items-center gap-2 text-xs">
                    <span className="text-gray-700">排序（与普通商品共用）</span>
                    <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-700">当前位次：{Number(tool.sortOrder ?? 0) + 1}</span>
                    <button
                      type="button"
                      className="rounded border border-gray-200 bg-white px-2 py-1 text-gray-700 disabled:text-gray-300"
                      disabled={Number(tool.sortOrder ?? 0) <= 0}
                      onClick={() => moveBundleTool(tool.id, -1)}
                    >
                      上移
                    </button>
                    <button
                      type="button"
                      className="rounded border border-gray-200 bg-white px-2 py-1 text-gray-700 disabled:text-gray-300"
                      disabled={Number(tool.sortOrder ?? 0) >= products.length + bundleTools.length - 1}
                      onClick={() => moveBundleTool(tool.id, 1)}
                    >
                      下移
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-700">
                    <div className="flex min-w-0 flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={!tool.isActive}
                          onChange={(e) => {
                            const delist = e.target.checked;
                            setBundleTools((prev) =>
                              prev.map((x) => {
                                if (x.id !== tool.id) return x;
                                if (delist) {
                                  const next = { ...x, isActive: false };
                                  delete next.scheduledOffAt;
                                  return next;
                                }
                                return { ...x, isActive: true };
                              })
                            );
                          }}
                        />
                        下架
                      </label>
                      <span
                        className={`flex flex-wrap items-center gap-1.5 ${tool.isActive ? '' : 'cursor-not-allowed opacity-60'}`}
                        title={
                          tool.isActive ? undefined : '请先取消「下架」后再设置定时下架'
                        }
                      >
                        <label className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            disabled={!tool.isActive}
                            checked={Boolean(getScheduledOffAtTs(tool))}
                            onChange={(e) => {
                              const on = e.target.checked;
                              setBundleTools((prev) =>
                                prev.map((x) => {
                                  if (x.id !== tool.id) return x;
                                  if (!on) {
                                    const next = { ...x };
                                    delete next.scheduledOffAt;
                                    return next;
                                  }
                                  const withListing = { ...x, isActive: true };
                                  if (getScheduledOffAtTs(withListing)) return withListing;
                                  return {
                                    ...withListing,
                                    scheduledOffAt: Timestamp.fromMillis(
                                      Date.now() + 60 * 60 * 1000
                                    ),
                                  };
                                })
                              );
                            }}
                          />
                          定时下架
                        </label>
                        {getScheduledOffAtTs(tool) ? (
                          <input
                            type="datetime-local"
                            disabled={!tool.isActive}
                            className="max-w-[11rem] rounded border border-gray-200 bg-white px-1.5 py-1 text-[11px] text-gray-800 shadow-inner disabled:cursor-not-allowed disabled:opacity-60 sm:max-w-none"
                            value={tsToDatetimeLocalInput(getScheduledOffAtTs(tool))}
                            onChange={(e) => {
                              const v = e.target.value;
                              setBundleTools((prev) =>
                                prev.map((x) => {
                                  if (x.id !== tool.id) return x;
                                  if (!v) {
                                    const next = { ...x };
                                    delete next.scheduledOffAt;
                                    return next;
                                  }
                                  const d = new Date(v);
                                  if (Number.isNaN(d.getTime())) return x;
                                  return { ...x, scheduledOffAt: Timestamp.fromDate(d) };
                                })
                              );
                            }}
                          />
                        ) : null}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 rounded border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                      onClick={() => removeBundleTool(tool.id)}
                    >
                      删除该套餐
                    </button>
                  </div>

                  <div className="mt-3 rounded-lg border border-gray-100 bg-white p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-800">系列（最多 5 组）</span>
                      <button
                        type="button"
                        className="text-xs text-indigo-600"
                        disabled={tool.series.length >= 5}
                        onClick={() =>
                          setBundleTools((prev) =>
                            prev.map((x) =>
                              x.id === tool.id
                                ? {
                                    ...x,
                                    series: [
                                      ...x.series,
                                      {
                                        id: crypto.randomUUID(),
                                        code: seriesCodeAt(x.series.length),
                                        name: '',
                                        sortOrder: x.series.length,
                                        options: [],
                                      },
                                    ],
                                  }
                                : x
                            )
                          )
                        }
                      >
                        + 添加系列
                      </button>
                    </div>
                    <div className="space-y-3">
                      {tool.series.map((series) => (
                        <div key={series.id} className="rounded border border-gray-100 p-2">
                          <div className="mb-2 flex items-center gap-2">
                            <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-600">
                              {series.code}
                            </span>
                            <input
                              className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs placeholder:text-gray-400"
                              value={series.name}
                              onChange={(e) =>
                                setBundleTools((prev) =>
                                  prev.map((x) =>
                                    x.id === tool.id
                                      ? {
                                          ...x,
                                          series: x.series.map((s) =>
                                            s.id === series.id
                                              ? { ...s, name: e.target.value }
                                              : s
                                          ),
                                        }
                                      : x
                                  )
                                )
                              }
                              placeholder={`${series.code} 类，如荤菜、素菜`}
                            />
                          </div>
                          <div className="space-y-2">
                            {series.options.map((opt) => (
                              <div
                                key={opt.id}
                                className="rounded border border-gray-100 bg-gray-50/80 p-2"
                              >
                                <div className="flex gap-2">
                                  {/* 左：缩略图 + 选择文件 + 删除图 单列纵向，省宽 */}
                                  <div className="flex w-14 shrink-0 flex-col items-stretch gap-1">
                                    <div className="h-14 w-full shrink-0 overflow-hidden rounded border border-gray-200 bg-white">
                                      {opt.imageUrl ? (
                                        <img src={opt.imageUrl} alt="" className="h-full w-full object-cover" />
                                      ) : (
                                        <div className="flex h-full items-center justify-center text-[10px] text-gray-400">
                                          无图
                                        </div>
                                      )}
                                    </div>
                                    <label className="cursor-pointer">
                                      <span className="block rounded border border-gray-300 bg-white px-1 py-0.5 text-center text-[10px] leading-tight text-gray-700 shadow-sm hover:bg-gray-50">
                                        选择文件
                                      </span>
                                      <input
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={(e) => {
                                          const file = e.target.files?.[0];
                                          e.currentTarget.value = '';
                                          if (!file || !user) return;
                                          void uploadProjectAsset(user.uid, file, 'bundle-option')
                                            .then((url) => {
                                              setBundleTools((prev) =>
                                                prev.map((x) =>
                                                  x.id === tool.id
                                                    ? {
                                                        ...x,
                                                        series: x.series.map((s) =>
                                                          s.id === series.id
                                                            ? {
                                                                ...s,
                                                                options: s.options.map((o) =>
                                                                  o.id === opt.id
                                                                    ? { ...o, imageUrl: url }
                                                                    : o
                                                                ),
                                                              }
                                                            : s
                                                        ),
                                                      }
                                                    : x
                                                )
                                              );
                                            })
                                            .catch((err: unknown) =>
                                              setMsg(err instanceof Error ? err.message : '图片上传失败')
                                            );
                                        }}
                                      />
                                    </label>
                                    <button
                                      type="button"
                                      className="text-center text-[10px] leading-tight text-red-600 underline-offset-2 hover:underline disabled:text-gray-400 disabled:no-underline"
                                      disabled={!opt.imageUrl}
                                      onClick={() =>
                                        setBundleTools((prev) =>
                                          prev.map((x) =>
                                            x.id === tool.id
                                              ? {
                                                  ...x,
                                                  series: x.series.map((s) =>
                                                    s.id === series.id
                                                      ? {
                                                          ...s,
                                                          options: s.options.map((o) =>
                                                            o.id === opt.id
                                                              ? { ...o, imageUrl: undefined }
                                                              : o
                                                          ),
                                                        }
                                                      : s
                                                  ),
                                                }
                                              : x
                                          )
                                        )
                                      }
                                    >
                                      删除图
                                    </button>
                                  </div>
                                  {/* 右：三行 — 选项名 / 备注 / 库存+删除整行 */}
                                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                                    <ProductLibraryCombobox
                                      items={libraryRows}
                                      kindFilter="bundle_option"
                                      value={opt.name}
                                      onChangeValue={(v) =>
                                        setBundleTools((prev) =>
                                          prev.map((x) =>
                                            x.id === tool.id
                                              ? {
                                                  ...x,
                                                  series: x.series.map((s) =>
                                                    s.id === series.id
                                                      ? {
                                                          ...s,
                                                          options: s.options.map((o) =>
                                                            o.id === opt.id ? { ...o, name: v } : o
                                                          ),
                                                        }
                                                      : s
                                                  ),
                                                }
                                              : x
                                          )
                                        )
                                      }
                                      onPickRow={(row) => {
                                        setBundleTools((prev) =>
                                          prev.map((x) =>
                                            x.id === tool.id
                                              ? {
                                                  ...x,
                                                  series: x.series.map((s) =>
                                                    s.id === series.id
                                                      ? {
                                                          ...s,
                                                          options: s.options.map((o) =>
                                                            o.id === opt.id
                                                              ? {
                                                                  ...o,
                                                                  name: row.data.name,
                                                                  imageUrl: row.data.imageUrl,
                                                                  note: row.data.note ?? '',
                                                                }
                                                              : o
                                                          ),
                                                        }
                                                      : s
                                                  ),
                                                }
                                              : x
                                          )
                                        );
                                        setMsg('已从商品库套用套餐品项');
                                      }}
                                      inputClassName="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-xs"
                                      placeholder="选项名（输入筛选商品库）"
                                    />
                                    <input
                                      className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-xs placeholder:text-gray-400"
                                      value={opt.note ?? ''}
                                      placeholder="备注"
                                      onChange={(e) =>
                                        setBundleTools((prev) =>
                                          prev.map((x) =>
                                            x.id === tool.id
                                              ? {
                                                  ...x,
                                                  series: x.series.map((s) =>
                                                    s.id === series.id
                                                      ? {
                                                          ...s,
                                                          options: s.options.map((o) =>
                                                            o.id === opt.id
                                                              ? { ...o, note: e.target.value }
                                                              : o
                                                          ),
                                                        }
                                                      : s
                                                  ),
                                                }
                                              : x
                                          )
                                        )
                                      }
                                    />
                                    <div className="flex min-h-[2.25rem] items-center gap-2">
                                      <span className="shrink-0 text-[11px] text-gray-500">库存</span>
                                      <input
                                        type="number"
                                        min={0}
                                        inputMode="numeric"
                                        placeholder="0"
                                        className="w-[5rem] shrink-0 rounded border border-gray-200 bg-white px-2 py-1.5 text-xs tabular-nums"
                                        value={opt.stock === 0 ? '' : opt.stock}
                                        onChange={(e) => {
                                          const raw = e.target.value;
                                          const n = raw === '' ? 0 : Number(raw);
                                          if (Number.isNaN(n) || n < 0) return;
                                          setBundleTools((prev) =>
                                            prev.map((x) =>
                                              x.id === tool.id
                                                ? {
                                                    ...x,
                                                    series: x.series.map((s) =>
                                                      s.id === series.id
                                                        ? {
                                                            ...s,
                                                            options: s.options.map((o) =>
                                                              o.id === opt.id ? { ...o, stock: n } : o
                                                            ),
                                                          }
                                                        : s
                                                    ),
                                                  }
                                                : x
                                            )
                                          );
                                        }}
                                      />
                                      <button
                                        type="button"
                                        className="ml-auto shrink-0 rounded border border-red-200 bg-white px-2 py-1.5 text-xs text-red-700"
                                        onClick={() =>
                                          setBundleTools((prev) =>
                                            prev.map((x) =>
                                              x.id === tool.id
                                                ? {
                                                    ...x,
                                                    series: x.series.map((s) =>
                                                      s.id === series.id
                                                        ? {
                                                            ...s,
                                                            options: s.options.filter((o) => o.id !== opt.id),
                                                          }
                                                        : s
                                                    ),
                                                  }
                                                : x
                                            )
                                          )
                                        }
                                      >
                                        删除
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                            <button
                              type="button"
                              className="text-xs text-indigo-600"
                              onClick={() =>
                                setBundleTools((prev) =>
                                  prev.map((x) =>
                                    x.id === tool.id
                                      ? {
                                          ...x,
                                          series: x.series.map((s) =>
                                            s.id === series.id
                                              ? {
                                                  ...s,
                                                  options: [
                                                    ...s.options,
                                                    {
                                                      id: crypto.randomUUID(),
                                                      name: '',
                                                      stock: 0,
                                                      isActive: true,
                                                      sortOrder: s.options.length,
                                                    },
                                                  ],
                                                }
                                              : s
                                          ),
                                        }
                                      : x
                                  )
                                )
                              }
                            >
                              + 添加该系列选项
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-3 rounded-lg border border-gray-100 bg-white p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-800">套餐方案与价格</span>
                      <button
                        type="button"
                        className="text-xs text-indigo-600"
                        onClick={() =>
                          setBundleTools((prev) =>
                            prev.map((x) =>
                              x.id === tool.id
                                ? {
                                    ...x,
                                    schemes: [
                                      ...x.schemes,
                                      {
                                        id: crypto.randomUUID(),
                                        name: '',
                                        price: 0,
                                        discountPrice: undefined,
                                        discountEnd: null,
                                        isActive: true,
                                        sortOrder: x.schemes.length,
                                        requirements: Object.fromEntries(
                                          x.series.map((s) => [s.id, 0])
                                        ),
                                      },
                                    ],
                                  }
                                : x
                            )
                          )
                        }
                      >
                        + 添加方案
                      </button>
                    </div>
                    <div className="space-y-2">
                      {tool.schemes.map((sch) => (
                        <div key={sch.id} className="rounded border border-gray-100 bg-gray-50/50 p-2">
                          <div className="flex flex-wrap items-end gap-x-2 gap-y-2">
                            <label className="flex min-w-[10rem] flex-[2] basis-[min(100%,18rem)] flex-col gap-0.5">
                              <span className="text-[10px] text-gray-500">
                                方案名称（输入即筛选商品库，点选套用）
                              </span>
                              <ProductLibraryCombobox
                                  inputId={`validation-scheme-dup:${sch.id}`}
                                  items={libraryRows}
                                  kindFilter="bundle_scheme"
                                  value={sch.name}
                                  onChangeValue={(v) => {
                                    setValidationHighlightKey(null);
                                    setBundleTools((prev) =>
                                      prev.map((x) =>
                                        x.id === tool.id
                                          ? {
                                              ...x,
                                              schemes: x.schemes.map((s) =>
                                                s.id === sch.id ? { ...s, name: v } : s
                                              ),
                                            }
                                          : x
                                      )
                                    );
                                  }}
                                  onPickRow={(row) => {
                                    const picked = normalizeBundleSchemeDisplayName(
                                      row.data.name ?? ''
                                    );
                                    if (picked) {
                                      const dup = tool.schemes.some(
                                        (s) =>
                                          s.id !== sch.id &&
                                          normalizeBundleSchemeDisplayName(s.name ?? '') ===
                                            picked
                                      );
                                      if (dup) {
                                        setMsg(
                                          `该套餐内已有同名方案「${picked}」，请先改名或删除重复项后再套用`
                                        );
                                        return;
                                      }
                                    }
                                    setBundleTools((prev) =>
                                      prev.map((x) =>
                                        x.id === tool.id
                                          ? {
                                              ...x,
                                              schemes: x.schemes.map((s) =>
                                                s.id === sch.id
                                                  ? {
                                                      ...s,
                                                      name: row.data.name,
                                                      price: row.data.retailPrice,
                                                      purchaseCost: row.data.purchaseCost,
                                                      note: row.data.note,
                                                    }
                                                  : s
                                              ),
                                            }
                                          : x
                                      )
                                    );
                                    setMsg('已从商品库套用方案');
                                  }}
                                  inputClassName={`w-full rounded border bg-white px-2 py-1.5 text-xs ${
                                    validationHighlightKey === `scheme-dup:${sch.id}`
                                      ? 'border-red-500 ring-2 ring-red-200'
                                      : 'border-gray-200'
                                  }`}
                                  placeholder="如：双人套餐"
                                />
                            </label>
                            <label className="flex w-full basis-full flex-col gap-0.5">
                              <span className="text-[10px] text-gray-500">备注（可选）</span>
                              <textarea
                                className="min-h-[2rem] rounded border border-gray-200 bg-white px-2 py-1 text-xs"
                                value={sch.note ?? ''}
                                placeholder="可与产品库备注对应"
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setBundleTools((prev) =>
                                    prev.map((x) =>
                                      x.id === tool.id
                                        ? {
                                            ...x,
                                            schemes: x.schemes.map((s) =>
                                              s.id === sch.id
                                                ? {
                                                    ...s,
                                                    note: v.trim() ? v : undefined,
                                                  }
                                                : s
                                            ),
                                          }
                                        : x
                                    )
                                  );
                                }}
                              />
                            </label>
                            <label className="flex min-w-[6rem] flex-1 flex-col gap-0.5">
                              <span className="text-[10px] text-gray-500">标价 RM</span>
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                placeholder="0"
                                className="rounded border border-gray-200 bg-white px-2 py-1.5 text-xs tabular-nums"
                                value={sch.price === 0 ? '' : sch.price}
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  const n = raw === '' ? 0 : Number(raw);
                                  if (Number.isNaN(n) || n < 0) return;
                                  setBundleTools((prev) =>
                                    prev.map((x) =>
                                      x.id === tool.id
                                        ? {
                                            ...x,
                                            schemes: x.schemes.map((s) =>
                                              s.id === sch.id ? { ...s, price: n } : s
                                            ),
                                          }
                                        : x
                                    )
                                  );
                                }}
                              />
                            </label>
                            <label className="flex min-w-[6rem] flex-1 flex-col gap-0.5">
                              <span className="text-[10px] text-gray-500">采购成本</span>
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                placeholder="可选"
                                className="rounded border border-gray-200 bg-white px-2 py-1.5 text-xs tabular-nums"
                                value={
                                  sch.purchaseCost != null && sch.purchaseCost > 0
                                    ? sch.purchaseCost
                                    : sch.purchaseCost === 0
                                      ? 0
                                      : ''
                                }
                                onChange={(e) => {
                                  const raw = e.target.value.trim();
                                  setBundleTools((prev) =>
                                    prev.map((x) =>
                                      x.id === tool.id
                                        ? {
                                            ...x,
                                            schemes: x.schemes.map((s) =>
                                              s.id === sch.id
                                                ? {
                                                    ...s,
                                                    purchaseCost:
                                                      raw === ''
                                                        ? undefined
                                                        : Math.max(0, Number(raw) || 0),
                                                  }
                                                : s
                                            ),
                                          }
                                        : x
                                    )
                                  );
                                }}
                              />
                            </label>
                            <label className="flex min-w-[6rem] flex-1 flex-col gap-0.5">
                              <span className="text-[10px] text-gray-500">优惠价</span>
                              <input
                                id={`validation-scheme:${sch.id}`}
                                type="number"
                                min={0}
                                step="0.01"
                                className={`rounded border bg-white px-2 py-1.5 text-xs tabular-nums ${
                                  validationHighlightKey === `scheme:${sch.id}`
                                    ? 'border-red-500 ring-2 ring-red-200'
                                    : 'border-gray-200'
                                }`}
                                placeholder="可选"
                                value={sch.discountPrice ?? ''}
                                onChange={(e) => {
                                  setValidationHighlightKey(null);
                                  setBundleTools((prev) =>
                                    prev.map((x) =>
                                      x.id === tool.id
                                        ? {
                                            ...x,
                                            schemes: x.schemes.map((s) =>
                                              s.id === sch.id
                                                ? {
                                                    ...s,
                                                    discountPrice:
                                                      e.target.value.trim() === ''
                                                        ? undefined
                                                        : Number(e.target.value) || 0,
                                                  }
                                                : s
                                            ),
                                          }
                                        : x
                                    )
                                  );
                                }}
                              />
                            </label>
                            <div className="flex w-full min-w-[11rem] max-w-[15rem] flex-col gap-0.5 sm:w-auto sm:flex-none">
                              <span className="text-[10px] text-gray-500">特惠截止</span>
                              <div className="flex flex-wrap items-end gap-1.5">
                                <input
                                  type="datetime-local"
                                  className="min-w-0 flex-1 max-w-[15rem] rounded border border-gray-200 bg-white px-2 py-1.5 text-xs"
                                  value={tsToDatetimeLocalInput(sch.discountEnd ?? null)}
                                  onChange={(e) => {
                                    const raw = e.target.value;
                                    setBundleTools((prev) =>
                                      prev.map((x) =>
                                        x.id === tool.id
                                          ? {
                                              ...x,
                                              schemes: x.schemes.map((s) =>
                                                s.id === sch.id
                                                  ? {
                                                      ...s,
                                                      discountEnd: raw
                                                        ? Timestamp.fromDate(new Date(raw))
                                                        : null,
                                                    }
                                                  : s
                                              ),
                                            }
                                          : x
                                      )
                                    );
                                  }}
                                />
                                {sch.discountEnd ? (
                                  <button
                                    type="button"
                                    className="shrink-0 rounded border border-gray-200 bg-white px-1.5 py-1 text-[10px] font-medium text-gray-700 hover:bg-gray-50"
                                    onClick={() =>
                                      setBundleTools((prev) =>
                                        prev.map((x) =>
                                          x.id === tool.id
                                            ? {
                                                ...x,
                                                schemes: x.schemes.map((s) =>
                                                  s.id === sch.id
                                                    ? { ...s, discountEnd: null }
                                                    : s
                                                ),
                                              }
                                            : x
                                        )
                                      )
                                    }
                                  >
                                    清除
                                  </button>
                                ) : null}
                              </div>
                            </div>
                            <label className="inline-flex shrink-0 items-center gap-1 pb-1 text-xs text-gray-700">
                              <input
                                type="checkbox"
                                checked={sch.isActive}
                                onChange={(e) =>
                                  setBundleTools((prev) =>
                                    prev.map((x) =>
                                      x.id === tool.id
                                        ? {
                                            ...x,
                                            schemes: x.schemes.map((s) =>
                                              s.id === sch.id
                                                ? { ...s, isActive: e.target.checked }
                                                : s
                                            ),
                                          }
                                        : x
                                    )
                                  )
                                }
                              />
                              启用
                            </label>
                            <button
                              type="button"
                              className="ml-auto shrink-0 rounded border border-red-200 bg-white px-2.5 py-1.5 text-xs text-red-700 sm:ml-0"
                              onClick={() =>
                                setBundleTools((prev) =>
                                  prev.map((x) =>
                                    x.id === tool.id
                                      ? {
                                          ...x,
                                          schemes: x.schemes.filter((s) => s.id !== sch.id),
                                        }
                                      : x
                                  )
                                )
                              }
                            >
                              删除
                            </button>
                          </div>
                          <p className="mt-2 text-[10px] text-gray-500">
                            方案规则：不填特惠价=普通；填特惠价=特惠；再填结束时间=早鸟价。
                          </p>
                          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                            {tool.series.map((s) => (
                              <label key={s.id} className="text-[11px] text-gray-600">
                                {(s.name.trim() || `${s.code}类`) + '数量'}
                                <input
                                  type="number"
                                  min={0}
                                  inputMode="numeric"
                                  placeholder="0"
                                  className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-xs tabular-nums"
                                  value={
                                    (sch.requirements[s.id] ?? 0) === 0
                                      ? ''
                                      : sch.requirements[s.id] ?? 0
                                  }
                                  onChange={(e) => {
                                    const raw = e.target.value;
                                    const n = raw === '' ? 0 : Number(raw);
                                    if (Number.isNaN(n) || n < 0) return;
                                    setBundleTools((prev) =>
                                      prev.map((x) =>
                                        x.id === tool.id
                                          ? {
                                              ...x,
                                              schemes: x.schemes.map((r) =>
                                                r.id === sch.id
                                                  ? {
                                                      ...r,
                                                      requirements: {
                                                        ...r.requirements,
                                                        [s.id]: n,
                                                      },
                                                    }
                                                  : r
                                              ),
                                            }
                                          : x
                                      )
                                    );
                                  }}
                                />
                              </label>
                            ))}
                          </div>
                          {passCardTemplates.length > 0 ? (
                            <div className="mt-2 rounded border border-gray-100 bg-white p-2">
                              <div className="mb-1 text-[11px] font-medium text-gray-700">
                                适配次卡（顾客可用此次卡抵扣本方案）
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {passCardTemplates.map((c) => {
                                  const ids =
                                    (sch as { applicableCardTemplateIds?: string[] })
                                      .applicableCardTemplateIds ?? [];
                                  const checked = ids.includes(c.id);
                                  return (
                                    <label
                                      key={c.id}
                                      className={`flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-[11px] ${
                                        checked
                                          ? 'border-purple-300 bg-purple-50 text-purple-800'
                                          : 'border-gray-200 bg-white text-gray-700'
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        className="h-3 w-3"
                                        checked={checked}
                                        onChange={(e) => {
                                          const next = e.target.checked;
                                          setBundleTools((prev) =>
                                            prev.map((x) => {
                                              if (x.id !== tool.id) return x;
                                              return {
                                                ...x,
                                                schemes: x.schemes.map((s) => {
                                                  if (s.id !== sch.id) return s;
                                                  const cur =
                                                    (s as {
                                                      applicableCardTemplateIds?: string[];
                                                    }).applicableCardTemplateIds ??
                                                    [];
                                                  const set = new Set(cur);
                                                  if (next) set.add(c.id);
                                                  else set.delete(c.id);
                                                  const arr = Array.from(set);
                                                  const updated = {
                                                    ...s,
                                                    applicableCardTemplateIds:
                                                      arr.length > 0
                                                        ? arr
                                                        : undefined,
                                                  };
                                                  return updated;
                                                }),
                                              };
                                            })
                                          );
                                        }}
                                      />
                                      {c.data.name}
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-gray-900">
              本次启用配送点
            </span>
            <Link
              to={`${base}/delivery-points`}
              className="text-xs font-medium text-indigo-600 underline-offset-2 hover:underline"
            >
              管理配送点库
            </Link>
          </div>
          <p className="mb-3 text-xs text-gray-500">
            不勾选任何项时，顾客下单页将显示本店<strong>全部启用中</strong>
            的配送点；勾选后仅显示所选。
          </p>
          {deliveryLibrary.filter((r) => activeDeliveryIds.has(r.id)).length ===
          0 ? (
            <p className="text-sm text-amber-800">
              尚无启用中的配送点，请先到「配送点库」新增；顾客仍可选用「其他」。
            </p>
          ) : (
            <div className="space-y-2">
              {deliveryLibrary
                .filter((r) => activeDeliveryIds.has(r.id))
                .map((r) => (
                  <label
                    key={r.id}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-100 px-3 py-2"
                  >
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4"
                      checked={selectedDpIds.includes(r.id)}
                      onChange={() => toggleDeliveryPoint(r.id)}
                    />
                    <span className="text-sm text-gray-900">
                      <span className="font-medium">
                        [{r.data.code ?? '—'}] {r.data.shortName ?? r.data.name}
                      </span>
                      {r.data.detailAddress ? (
                        <span className="mt-0.5 block text-xs text-gray-600">
                          {r.data.detailAddress}
                        </span>
                      ) : null}
                    </span>
                  </label>
                ))}
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  className="text-xs font-medium text-indigo-600"
                  onClick={() =>
                    setSelectedDpIds(
                      deliveryLibrary
                        .filter((r) => activeDeliveryIds.has(r.id))
                        .map((r) => r.id)
                    )
                  }
                >
                  全选启用项
                </button>
                <button
                  type="button"
                  className="text-xs font-medium text-gray-600"
                  onClick={() => setSelectedDpIds([])}
                >
                  清空（顾客端用全部启用项）
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap gap-2 border-t border-gray-100 bg-white/95 px-1 pb-[max(env(safe-area-inset-bottom),8px)] pt-3 backdrop-blur">
          <Link
            to={`${base}/projects`}
            className="inline-flex h-11 items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-sm font-medium text-gray-800 shadow-sm"
          >
            返回列表
          </Link>
          <button
            type="button"
            className="inline-flex h-11 min-w-[7rem] flex-1 items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-900 shadow-sm disabled:bg-gray-100"
            disabled={saving || !resolvedPid}
            onClick={() => void handleSaveDraft()}
          >
            {saving ? '保存中…' : '保存草稿'}
          </button>
          <button
            type="button"
            className="inline-flex h-11 min-w-[7rem] flex-1 items-center justify-center rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm disabled:bg-gray-300"
            disabled={publishing || !resolvedPid}
            onClick={() => void handlePublish()}
          >
            {publishing ? '发布中…' : '发布'}
          </button>
        </div>
        {msg ? (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {msg}
          </p>
        ) : null}
      </div>
    </PageShell>
  );
}
