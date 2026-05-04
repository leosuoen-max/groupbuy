import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Timestamp } from 'firebase/firestore';
import { PageShell } from '../../components/PageShell';
import { useAuthUser } from '../../hooks/useAuthUser';
import {
  createDraftProject,
  getProject,
  updateProjectDoc,
} from '../../lib/projectService';
import {
  listDeliveryPointsByShopId,
  type DeliveryPointRow,
} from '../../lib/deliveryPointService';
import { getShopBySlug, type ShopRow } from '../../lib/shopService';
import type { ProjectProduct } from '../../types/firestore';

function toDatetimeLocalValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
  const [status, setStatus] = useState<'draft' | 'published' | 'closed'>('draft');

  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [shopRow, setShopRow] = useState<ShopRow | null>(null);
  const [deliveryLibrary, setDeliveryLibrary] = useState<DeliveryPointRow[]>(
    []
  );
  const [selectedDpIds, setSelectedDpIds] = useState<string[]>([]);

  const resolvedPid = isNew ? '' : pid;

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
    setSelectedDpIds(row.data.deliveryPointIds ?? []);
  }, [resolvedPid]);

  useEffect(() => {
    if (!shopRow?.id) return;
    let cancelled = false;
    void listDeliveryPointsByShopId(shopRow.id, { includeInactive: true }).then(
      (rows) => {
        if (!cancelled) setDeliveryLibrary(rows);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [shopRow?.id]);

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

  const activeDeliveryIds = useMemo(() => {
    const set = new Set<string>();
    for (const r of deliveryLibrary) {
      if (r.data.isActive !== false) set.add(r.id);
    }
    return set;
  }, [deliveryLibrary]);

  const normalizedProducts = useMemo(() => {
    return products
      .map((p, i) => ({
        ...p,
        name: p.name.trim(),
        sortOrder: i,
      }))
      .filter((p) => p.name.length > 0);
  }, [products]);

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
    setSaving(true);
    setMsg(null);
    try {
      const d = new Date(closesAt);
      await updateProjectDoc(resolvedPid, {
        title: title.trim() || '未命名项目',
        closesAt: Timestamp.fromDate(d),
        textContent,
        products: normalizedProducts.length ? normalizedProducts : [],
        deliveryPointIds: sanitizedDeliveryPointIds,
        status: 'draft',
        publishedAt: null,
      });
      setMsg('已保存草稿');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!resolvedPid) return;
    const t = title.trim();
    if (!t) {
      setMsg('请填写项目标题');
      return;
    }
    const ok = normalizedProducts.some((p) => p.isActive && p.price > 0 && p.stock > 0);
    if (!ok) {
      setMsg('请至少保留一个上架商品：价格 > 0 且库存 > 0');
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
        deliveryPointIds: sanitizedDeliveryPointIds,
        status: 'published',
        publishedAt: Timestamp.now(),
      });
      setStatus('published');
      setMsg('已发布（顾客端读 Firestore 将在下一步接上）');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '发布失败');
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
            <span className="text-sm font-semibold text-gray-900">商品（最简版）</span>
            <button
              type="button"
              className="text-sm font-medium text-indigo-600"
              onClick={() =>
                setProducts((prev) => [...prev, newProduct(prev.length)])
              }
            >
              + 添加一行
            </button>
          </div>
          <div className="space-y-3">
            {products.map((p, idx) => (
              <div
                key={p.id}
                className="rounded-xl border border-gray-100 bg-gray-50 p-3"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-500">商品 {idx + 1}</span>
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
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    className="text-xs text-red-600"
                    onClick={() =>
                      setProducts((prev) =>
                        prev.length > 1 ? prev.filter((x) => x.id !== p.id) : prev
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
                      <span className="font-medium">{r.data.name}</span>
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
      </div>
    </PageShell>
  );
}
