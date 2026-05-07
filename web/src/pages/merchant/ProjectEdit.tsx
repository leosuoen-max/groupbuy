import { useCallback, useEffect, useMemo, useState } from 'react';
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
  listCardTemplatesByShop,
  type CardTemplateRow,
} from '../../lib/cardService';
import type { BundleToolDoc, ProjectProduct } from '../../types/firestore';

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

function normalizeApplicableCardIds(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out = input.filter((x): x is string => typeof x === 'string' && !!x);
  return out.length > 0 ? out : undefined;
}

function normalizeDraftProducts(input: unknown): ProjectProduct[] {
  if (!Array.isArray(input)) return [];
  return input.map((p, i) => {
    const row = (p ?? {}) as Partial<ProjectProduct>;
    return {
      id: typeof row.id === 'string' && row.id ? row.id : crypto.randomUUID(),
      name: typeof row.name === 'string' ? row.name : '',
      description: typeof row.description === 'string' ? row.description : '',
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
  const [products, setProducts] = useState<ProjectProduct[]>([newProduct(0)]);
  const [bundleTools, setBundleTools] = useState<BundleToolDoc[]>([]);
  const [status, setStatus] = useState<'draft' | 'published' | 'closed'>('draft');

  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [validationHighlightKey, setValidationHighlightKey] = useState<string | null>(null);

  const [shopRow, setShopRow] = useState<ShopRow | null>(null);
  const [passCardTemplates, setPassCardTemplates] = useState<CardTemplateRow[]>(
    []
  );
  const [deliveryLibrary, setDeliveryLibrary] = useState<DeliveryPointRow[]>(
    []
  );
  const [selectedDpIds, setSelectedDpIds] = useState<string[]>([]);
  const [draftHydrated, setDraftHydrated] = useState(false);

  const resolvedPid = isNew ? '' : pid;
  const draftStorageKey = resolvedPid
    ? `projectEditDraft:${slug}:${resolvedPid}`
    : '';

  type ProjectEditDraft = {
    savedAt: number;
    title: string;
    closesAt: string;
    textContent: string;
    products: ProjectProduct[];
    bundleTools: BundleToolDoc[];
    selectedDpIds: string[];
  };

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
      setBundleTools((prev) => {
        const totalCount = products.length + prev.length;
        const maxSortOrder = Math.max(0, totalCount - 1);
        let changed = false;
        const next = prev.map((x) => {
          if (x.id !== toolId) return x;
          const current = Number.isFinite(x.sortOrder) ? Number(x.sortOrder) : 0;
          const target = Math.max(0, Math.min(maxSortOrder, current + direction));
          if (target !== current) {
            changed = true;
            return { ...x, sortOrder: target };
          }
          return x;
        });
        return changed ? next : prev;
      });
    },
    [products.length]
  );

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
      if (typeof d.textContent === 'string') setTextContent(d.textContent);
      if (Array.isArray(d.products) && d.products.length > 0) {
        setProducts(normalizeDraftProducts(d.products));
      }
      if (Array.isArray(d.bundleTools)) setBundleTools(d.bundleTools);
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
    setTextContent(row.data.textContent ?? '');
    setStatus(row.data.status);
    setClosesAt(
      toDatetimeLocalValue(row.data.closesAt?.toDate?.() ?? new Date())
    );
    const ps = row.data.products?.length
      ? row.data.products
      : [newProduct(0)];
    setProducts(ps.map((p, i) => ({ ...p, sortOrder: i })));
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
            setBootErr('店铺不存在');
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
    if (!draftStorageKey || booting || !draftHydrated) return;
    const payload: ProjectEditDraft = {
      savedAt: Date.now(),
      title,
      closesAt,
      textContent,
      products,
      bundleTools,
      selectedDpIds,
    };
    sessionStorage.setItem(draftStorageKey, JSON.stringify(payload));
  }, [
    draftStorageKey,
    booting,
    draftHydrated,
    title,
    closesAt,
    textContent,
    products,
    bundleTools,
    selectedDpIds,
  ]);

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
      .map((tool, i) => ({
        id: tool.id,
        name: (tool.name ?? '').trim(),
        ...(typeof tool.description === 'string' && tool.description.trim()
          ? { description: tool.description.trim() }
          : {}),
        isActive: tool.isActive !== false,
        sortOrder: Number.isFinite(tool.sortOrder) ? tool.sortOrder : i,
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
            return {
              id: sch.id,
              name: (sch.name ?? '').trim(),
              price: Number(sch.price ?? 0) || 0,
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
      }))
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

  const handleSaveDraft = async () => {
    if (!resolvedPid) return;
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
        textContent,
        products: normalizedProducts.length ? normalizedProducts : [],
        bundleTools: normalizedBundleTools,
        deliveryPointIds: sanitizedDeliveryPointIds,
        status: 'draft',
        publishedAt: null,
      });
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
        textContent,
        products: normalizedProducts,
        bundleTools: normalizedBundleTools,
        deliveryPointIds: sanitizedDeliveryPointIds,
        status: 'published',
        publishedAt: Timestamp.now(),
      });
      if (draftStorageKey) sessionStorage.removeItem(draftStorageKey);
      setStatus('published');
      setMsg('已发布（顾客端读 Firestore 将在下一步接上）');
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
          返回我的店铺
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
    'mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-[16px] text-gray-900';

  const addBundleTool = () => {
    if (bundleTools.length >= 1) return;
    setBundleTools([
      {
        id: crypto.randomUUID(),
        name: '午餐套餐',
        isActive: true,
        sortOrder: products.length,
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

      <div className="space-y-4">
        <label className="block text-sm text-gray-800">
          项目标题
          <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="block text-sm text-gray-800">
          截止时间（本地时间）
          <input
            type="datetime-local"
            className={input}
            value={closesAt}
            onChange={(e) => setClosesAt(e.target.value)}
          />
        </label>
        <label className="block text-sm text-gray-800">
          文字说明（区块一）
          <textarea
            className={`${input} min-h-[6rem]`}
            value={textContent}
            onChange={(e) => setTextContent(e.target.value)}
            placeholder="套餐说明、规则等"
          />
        </label>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-900">商品清单</span>
            <button
              type="button"
              className="text-sm font-medium text-indigo-600"
              onClick={() =>
                setProducts((prev) => [...prev, newProduct(prev.length)].map((x, i) => ({ ...x, sortOrder: i })))
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
                        checked={p.isActive}
                        onChange={(e) =>
                          setProducts((prev) =>
                            prev.map((x) =>
                              x.id === p.id ? { ...x, isActive: e.target.checked } : x
                            )
                          )
                        }
                      />
                      上架
                    </label>
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
                <input
                  className={input}
                  placeholder="名称"
                  value={p.name}
                  onChange={(e) =>
                    setProducts((prev) =>
                      prev.map((x) =>
                        x.id === p.id ? { ...x, name: e.target.value } : x
                      )
                    )
                  }
                />
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
                <div className="mt-2 grid grid-cols-2 gap-2">
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
                  <label className="text-xs text-gray-700">
                    优惠结束时间（可选）
                    <input
                      type="datetime-local"
                      className={input}
                      value={tsToDatetimeLocalInput(p.discountEnd ?? null)}
                      onChange={(e) =>
                        setProducts((prev) =>
                          prev.map((x) =>
                            x.id === p.id
                              ? {
                                  ...x,
                                  discountEnd: e.target.value
                                    ? Timestamp.fromDate(new Date(e.target.value))
                                    : null,
                                }
                              : x
                          )
                        )
                      }
                    />
                  </label>
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
                          ? prev
                              .filter((x) => x.id !== p.id)
                              .map((x, i) => ({ ...x, sortOrder: i }))
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
              disabled={bundleTools.length >= 1}
            >
              {bundleTools.length >= 1 ? '已创建' : '+ 新建套餐工具'}
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
                  <label className="mt-2 flex items-center gap-2 text-xs text-gray-700">
                    <input
                      type="checkbox"
                      checked={tool.isActive}
                      onChange={(e) =>
                        setBundleTools((prev) =>
                          prev.map((x) =>
                            x.id === tool.id ? { ...x, isActive: e.target.checked } : x
                          )
                        )
                      }
                    />
                    启用套餐工具
                  </label>

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
                                        name: `${seriesCodeAt(x.series.length)}类`,
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
                            <span className="text-xs text-gray-500">{series.code}</span>
                            <input
                              className="w-full rounded border border-gray-200 px-2 py-1 text-xs"
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
                              placeholder="如：荤菜"
                            />
                          </div>
                          <div className="space-y-1">
                            {series.options.map((opt) => (
                              <div key={opt.id} className="grid grid-cols-12 gap-1 rounded border border-gray-100 p-2">
                                <div className="col-span-2">
                                  <div className="h-12 w-12 overflow-hidden rounded border border-gray-200 bg-white">
                                    {opt.imageUrl ? (
                                      <img src={opt.imageUrl} alt="" className="h-full w-full object-cover" />
                                    ) : (
                                      <div className="flex h-full items-center justify-center text-[10px] text-gray-400">无图</div>
                                    )}
                                  </div>
                                  <input
                                    type="file"
                                    accept="image/*"
                                    className="mt-1 w-full text-[10px]"
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
                                  <button
                                    type="button"
                                    className="mt-1 text-[10px] text-red-600 disabled:text-gray-400"
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
                                <input
                                  className="col-span-3 rounded border border-gray-200 px-2 py-1 text-xs"
                                  value={opt.name}
                                  placeholder="选项名"
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
                                                          ? { ...o, name: e.target.value }
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
                                <input
                                  className="col-span-4 rounded border border-gray-200 px-2 py-1 text-xs"
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
                                <input
                                  type="number"
                                  min={0}
                                  className="col-span-2 rounded border border-gray-200 px-2 py-1 text-xs"
                                  value={opt.stock}
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
                                                          ? {
                                                              ...o,
                                                              stock: Number(e.target.value) || 0,
                                                            }
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
                                <button
                                  type="button"
                                  className="col-span-1 rounded border border-red-200 text-[10px] text-red-700"
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
                                                      options: s.options.filter(
                                                        (o) => o.id !== opt.id
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
                                  删
                                </button>
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
                                        name: '新方案',
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
                        <div key={sch.id} className="rounded border border-gray-100 p-2">
                          <div className="grid grid-cols-12 gap-2">
                            <input
                              className="col-span-5 rounded border border-gray-200 px-2 py-1 text-xs"
                              value={sch.name}
                              placeholder="方案名（可编辑）"
                              onChange={(e) =>
                                setBundleTools((prev) =>
                                  prev.map((x) =>
                                    x.id === tool.id
                                      ? {
                                          ...x,
                                          schemes: x.schemes.map((s) =>
                                            s.id === sch.id
                                              ? { ...s, name: e.target.value }
                                              : s
                                          ),
                                        }
                                      : x
                                  )
                                )
                              }
                            />
                            <input
                              type="number"
                              min={0}
                              step="0.1"
                              className="col-span-3 rounded border border-gray-200 px-2 py-1 text-xs"
                              value={sch.price}
                              onChange={(e) =>
                                setBundleTools((prev) =>
                                  prev.map((x) =>
                                    x.id === tool.id
                                      ? {
                                          ...x,
                                          schemes: x.schemes.map((s) =>
                                            s.id === sch.id
                                              ? { ...s, price: Number(e.target.value) || 0 }
                                              : s
                                          ),
                                        }
                                      : x
                                  )
                                )
                              }
                            />
                            <input
                              id={`validation-scheme:${sch.id}`}
                              type="number"
                              min={0}
                              step="0.1"
                              className={`col-span-2 rounded border px-2 py-1 text-xs ${
                                validationHighlightKey === `scheme:${sch.id}`
                                  ? 'border-red-500 ring-2 ring-red-200'
                                  : 'border-gray-200'
                              }`}
                              placeholder="特惠价"
                              value={sch.discountPrice ?? ''}
                              onChange={(e) =>
                                {
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
                                }
                              }
                            />
                            <label className="col-span-3 inline-flex items-center gap-1 text-xs text-gray-700">
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
                              className="col-span-1 rounded border border-red-200 text-[10px] text-red-700"
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
                              删
                            </button>
                          </div>
                          <div className="mt-2">
                            <input
                              type="datetime-local"
                              className="w-full rounded border border-gray-200 px-2 py-1 text-xs"
                              value={tsToDatetimeLocalInput(sch.discountEnd ?? null)}
                              onChange={(e) =>
                                setBundleTools((prev) =>
                                  prev.map((x) =>
                                    x.id === tool.id
                                      ? {
                                          ...x,
                                          schemes: x.schemes.map((s) =>
                                            s.id === sch.id
                                              ? {
                                                  ...s,
                                                  discountEnd: e.target.value
                                                    ? Timestamp.fromDate(
                                                        new Date(e.target.value)
                                                      )
                                                    : null,
                                                }
                                              : s
                                          ),
                                        }
                                      : x
                                  )
                                )
                              }
                            />
                            <p className="mt-1 text-[10px] text-gray-500">
                              方案规则：不填特惠价=普通；填特惠价=特惠；再填结束时间=早鸟价。
                            </p>
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                            {tool.series.map((s) => (
                              <label key={s.id} className="text-[11px] text-gray-600">
                                {s.name}数量
                                <input
                                  type="number"
                                  min={0}
                                  className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-xs"
                                  value={sch.requirements[s.id] ?? 0}
                                  onChange={(e) =>
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
                                                        [s.id]:
                                                          Number(e.target.value) || 0,
                                                      },
                                                    }
                                                  : r
                                              ),
                                            }
                                          : x
                                      )
                                    )
                                  }
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

        <div className="flex flex-wrap gap-2 pt-2">
          <Link
            to={`${base}/projects`}
            className="inline-flex h-11 items-center justify-center rounded-xl border border-gray-200 px-4 text-sm font-medium text-gray-800"
          >
            返回列表
          </Link>
          <button
            type="button"
            className="inline-flex h-11 flex-1 items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-900 disabled:bg-gray-100"
            disabled={saving || !resolvedPid}
            onClick={() => void handleSaveDraft()}
          >
            {saving ? '保存中…' : '保存草稿'}
          </button>
          <button
            type="button"
            className="inline-flex h-11 flex-1 items-center justify-center rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white disabled:bg-gray-300"
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
