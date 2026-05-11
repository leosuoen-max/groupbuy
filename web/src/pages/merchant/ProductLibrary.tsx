import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { useAuthUser } from '../../hooks/useAuthUser';
import { formatMYR } from '../../lib/formatMYR';
import {
  dedupeProductLibraryByShop,
  deleteProductLibraryItem,
  listProductLibraryByShop,
  upsertProductLibraryItem,
  type ProductLibraryRow,
} from '../../lib/productLibraryService';
import { uploadProjectAsset } from '../../lib/projectService';
import { getShopBySlug, type ShopRow } from '../../lib/shopService';
import type { ProductLibraryKind } from '../../types/firestore';

const inputCls =
  'mt-0.5 w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-900 shadow-inner';

export default function ProductLibrary() {
  const { shopSlug = '' } = useParams<{ shopSlug: string }>();
  const slug = decodeURIComponent(shopSlug);
  const { user, loading: authLoading } = useAuthUser();
  const [shop, setShop] = useState<ShopRow | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<ProductLibraryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [draftName, setDraftName] = useState('');
  const [draftKind, setDraftKind] = useState<ProductLibraryKind>('product');
  const [draftRetail, setDraftRetail] = useState('');
  const [draftCost, setDraftCost] = useState('');
  const [draftNote, setDraftNote] = useState('');
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async (shopId: string) => {
    await dedupeProductLibraryByShop(shopId);
    const list = await listProductLibraryByShop(shopId);
    setRows(list);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setErr(null);
      try {
        const row = await getShopBySlug(slug);
        if (!cancelled) setShop(row);
      } catch (e) {
        if (!cancelled) {
          setShop(null);
          setErr(e instanceof Error ? e.message : '加载失败');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    if (!shop?.id) return;
    let cancelled = false;
    setLoading(true);
    void refresh(shop.id)
      .catch(() => {
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shop?.id, refresh]);

  if (authLoading || shop === undefined) {
    return (
      <PageShell title="产品库" subtitle="加载中…">
        <p className="text-sm text-gray-600">请稍候…</p>
      </PageShell>
    );
  }

  if (!user) {
    return (
      <PageShell title="产品库" subtitle="未登录">
        <Link className="text-indigo-600 underline-offset-2 hover:underline" to="/login">
          去登录
        </Link>
      </PageShell>
    );
  }

  if (err || !shop) {
    return (
      <PageShell title="产品库" subtitle="未找到商户">
        <p className="text-sm text-gray-600">{err ?? '链接无效'}</p>
        <Link
          className="mt-2 inline-block text-indigo-600 underline-offset-2 hover:underline"
          to="/dashboard"
        >
          返回
        </Link>
      </PageShell>
    );
  }

  if (shop.data.ownerId !== user.uid) {
    return (
      <PageShell title="产品库" subtitle="无权限">
        <p className="text-sm text-gray-600">仅店主可管理产品库。</p>
        <Link
          className="mt-2 inline-block text-indigo-600 underline-offset-2 hover:underline"
          to={`/dashboard/${encodeURIComponent(shop.data.slug)}`}
        >
          返回首页
        </Link>
      </PageShell>
    );
  }

  const base = `/dashboard/${encodeURIComponent(shop.data.slug)}`;

  const handleAdd = async () => {
    setMsg(null);
    const name = draftName.trim();
    if (!name) {
      setMsg('请填写名称');
      return;
    }
    const isOption = draftKind === 'bundle_option';
    const retail = isOption ? 0 : Number(draftRetail) || 0;
    if (draftKind === 'product' && retail <= 0) {
      setMsg('普通商品请填写大于 0 的零售价');
      return;
    }
    setSaving(true);
    try {
      await upsertProductLibraryItem(shop.id, shop.data.ownerId, {
        name,
        retailPrice: retail,
        purchaseCost: isOption
          ? undefined
          : draftCost.trim() === ''
            ? undefined
            : Math.max(0, Number(draftCost) || 0),
        note: draftNote || undefined,
        kind: draftKind,
      });
      setMsg('已保存（同名会合并更新）');
      setDraftName('');
      setDraftRetail('');
      setDraftCost('');
      setDraftNote('');
      await refresh(shop.id);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell
      title="产品库"
      subtitle="按名称去重收录；编辑项目时可搜索套用，减少重复录入。"
    >
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <Link
          className="text-indigo-600 underline-offset-2 hover:underline"
          to={base}
        >
          ← 商户首页
        </Link>
      </div>

      <section className="mb-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">新增 / 更新条目</h2>
        <p className="mb-3 text-xs text-gray-500">
          名称相同且类型相同视为同一条并更新字段。套餐方案选「套餐方案」；套餐里可复用的选项（荤菜 A、饮料 B
          等）选「套餐品项」。
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-gray-700">
            名称 *
            <input
              className={inputCls}
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="商品或方案名称"
            />
          </label>
          <label className="text-xs text-gray-700">
            类型
            <select
              className={inputCls}
              value={draftKind}
              onChange={(e) =>
                setDraftKind(e.target.value as ProductLibraryKind)
              }
            >
              <option value="product">普通商品</option>
              <option value="bundle_scheme">套餐方案</option>
              <option value="bundle_option">套餐品项</option>
            </select>
          </label>
          {draftKind === 'bundle_option' ? null : (
            <>
              <label className="text-xs text-gray-700">
                零售价 (RM) *
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className={inputCls}
                  value={draftRetail}
                  onChange={(e) => setDraftRetail(e.target.value)}
                />
              </label>
              <label className="text-xs text-gray-700">
                采购成本 (RM)
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className={inputCls}
                  placeholder="可选"
                  value={draftCost}
                  onChange={(e) => setDraftCost(e.target.value)}
                />
              </label>
            </>
          )}
          <label className="col-span-full text-xs text-gray-700">
            备注
            <textarea
              className={`${inputCls} min-h-[4rem]`}
              value={draftNote}
              onChange={(e) => setDraftNote(e.target.value)}
              placeholder="可选"
            />
          </label>
          <label className="col-span-full text-xs text-gray-700">
            照片（可选，保存时会写入本条）
            <input
              type="file"
              accept="image/*"
              className="mt-1 block w-full text-xs"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.currentTarget.value = '';
                if (!file || !user) return;
                const nameSnapshot = draftName.trim();
                if (!nameSnapshot) {
                  setMsg('请先填写名称再上传图片');
                  return;
                }
                void uploadProjectAsset(user.uid, file, 'product')
                  .then(async (url) => {
                    const optKind = draftKind === 'bundle_option';
                    const rPrice = optKind ? 0 : Number(draftRetail) || 0;
                    await upsertProductLibraryItem(shop.id, shop.data.ownerId, {
                      name: nameSnapshot,
                      imageUrl: url,
                      retailPrice: rPrice,
                      purchaseCost: optKind
                        ? undefined
                        : draftCost.trim() === ''
                          ? undefined
                          : Math.max(0, Number(draftCost) || 0),
                      note: draftNote || undefined,
                      kind: draftKind,
                    });
                    setMsg('已上传图片并写入本条');
                    await refresh(shop.id);
                  })
                  .catch((ex: unknown) =>
                    setMsg(ex instanceof Error ? ex.message : '上传失败')
                  );
              }}
            />
          </label>
        </div>
        <button
          type="button"
          disabled={saving}
          className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          onClick={() => void handleAdd()}
        >
          {saving ? '保存中…' : '保存到库'}
        </button>
      </section>

      {msg ? (
        <p className="mb-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-800">
          {msg}
        </p>
      ) : null}

      <h2 className="mb-2 text-sm font-semibold text-gray-900">已收录</h2>
      {loading ? (
        <p className="text-sm text-gray-500">加载中…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500">
          暂无记录。可在上方添加；编辑项目并<strong>发布</strong>后，当前商品、套餐方案与<strong>套餐系列品项</strong>会自动同步到商品库（同名同类型覆盖）。
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-start gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3"
            >
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-white">
                {r.data.imageUrl ? (
                  <img
                    src={r.data.imageUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-[10px] text-gray-400">
                    {r.data.kind === 'bundle_scheme'
                      ? '套餐'
                      : r.data.kind === 'bundle_option'
                        ? '品项'
                        : '无图'}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-medium text-gray-900">{r.data.name}</span>
                  <span className="rounded bg-white px-1.5 py-0.5 text-[10px] text-gray-600 ring-1 ring-gray-200">
                    {r.data.kind === 'bundle_scheme'
                      ? '套餐方案'
                      : r.data.kind === 'bundle_option'
                        ? '套餐品项'
                        : '商品'}
                  </span>
                </div>
                {r.data.kind === 'bundle_option' ? (
                  <p className="mt-1 text-xs text-gray-500">无固定零售价；用于系列选项名、图、备注复用。</p>
                ) : (
                  <div className="mt-1 text-xs text-gray-600">
                    零售 {formatMYR(r.data.retailPrice)}
                    {typeof r.data.purchaseCost === 'number' ? (
                      <span className="ml-2">
                        成本 {formatMYR(r.data.purchaseCost)}
                      </span>
                    ) : null}
                  </div>
                )}
                {r.data.note ? (
                  <p className="mt-1 text-xs text-gray-500">{r.data.note}</p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="text-xs text-red-600"
                    onClick={() => {
                      if (!window.confirm('确定从库中删除该条目？')) return;
                      void deleteProductLibraryItem(r.id)
                        .then(() => {
                          void refresh(shop.id);
                          setMsg('已删除');
                        })
                        .catch(() => setMsg('删除失败'));
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
