import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PageShell } from '../components/PageShell';
import { useWechatNotifySession } from '../hooks/useWechatNotifySession';
import { useWechatShareCard } from '../hooks/useWechatShareCard';
import { getProject, type ProjectRow } from '../lib/projectService';
import { getShopById, type ShopRow } from '../lib/shopService';
import { buildWechatShareCardFromProject } from '../lib/wechatShareMeta';
import { formatMYR } from '../lib/formatMYR';
import { formatRemainingShort } from '../lib/countdown';
import {
  customerAppendLinesToOrder,
  getOrderByNumber,
  type OrderRow,
} from '../lib/orderService';
import { getOrCreateCustomerKey } from '../lib/customerIdentity';
import {
  isBundleToolPastScheduledOff,
  isProjectProductSellable,
} from '../lib/productAvailability';
import type { BundleSelectionDraft, OrderLine } from '../types/orderDraft';
import type { BundleSchemeDoc, BundleToolDoc, ProjectProduct } from '../types/firestore';

function stripText(s: string | undefined): string {
  return (s ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

type PriceInfo = {
  unit: number;
  isDiscount: boolean;
  discountType?: 'special' | 'earlybird';
  discountEndsAt?: string;
};

type BundleDraft = {
  schemeId: string;
  selectedBySeries: Record<string, string[]>;
};

function useTick(ms: number) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

function tsToDate(t: { toDate?: () => Date } | null | undefined): Date | null {
  return t?.toDate ? t.toDate() : null;
}

function effectiveProductPrice(p: ProjectProduct, now: Date): PriceInfo {
  const price = Number(p.price) || 0;
  const discount = p.discountPrice == null ? null : Number(p.discountPrice);
  if (discount == null || Number.isNaN(discount)) return { unit: price, isDiscount: false };
  const end = tsToDate(p.discountEnd);
  if (end) {
    const start = tsToDate(p.discountStart);
    const inWindow = now <= end && (!start || now >= start);
    if (!inWindow) return { unit: price, isDiscount: false };
    return {
      unit: discount,
      isDiscount: true,
      discountType: 'earlybird',
      discountEndsAt: end.toISOString(),
    };
  }
  return {
    unit: discount,
    isDiscount: true,
    discountType: 'special',
  };
}

function effectiveSchemePrice(scheme: BundleSchemeDoc, now: Date): PriceInfo {
  const price = Number(scheme.price) || 0;
  const discount = scheme.discountPrice == null ? null : Number(scheme.discountPrice);
  if (discount == null || Number.isNaN(discount)) return { unit: price, isDiscount: false };
  const end = tsToDate(scheme.discountEnd);
  if (end) {
    const start = tsToDate(scheme.discountStart);
    const inWindow = now <= end && (!start || now >= start);
    if (!inWindow) return { unit: price, isDiscount: false };
    return {
      unit: discount,
      isDiscount: true,
      discountType: 'earlybird',
      discountEndsAt: end.toISOString(),
    };
  }
  return { unit: discount, isDiscount: true, discountType: 'special' };
}

function promoLabel(price: PriceInfo): string | null {
  if (!price.isDiscount) return null;
  return price.discountType === 'earlybird' ? '早鸟价' : '特惠';
}

function getSeriesRequiredCount(
  requirements: Record<string, number> | undefined,
  series: { id: string; code?: string; name?: string }
): number {
  if (!requirements) return 0;
  const byId = Number(requirements[series.id] ?? 0);
  if (byId > 0) return byId;
  const code = series.code?.trim();
  if (code) {
    const byCode = Number(requirements[code] ?? 0);
    if (byCode > 0) return byCode;
  }
  const name = series.name?.trim();
  if (name) {
    const byName = Number(requirements[name] ?? 0);
    if (byName > 0) return byName;
  }
  return 0;
}

export default function FeituanProject() {
  useWechatNotifySession();
  const { projectId = '' } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
  const appendOrderNumber = searchParams.get('appendOrder')?.trim() ?? '';
  const isAppendMode = appendOrderNumber.length > 0;
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [shop, setShop] = useState<ShopRow | null>(null);
  const [appendTarget, setAppendTarget] = useState<OrderRow | null>(null);
  const [appendErr, setAppendErr] = useState<string | null>(null);
  const [appendSubmitting, setAppendSubmitting] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [bundleBuilder, setBundleBuilder] = useState<Record<string, BundleDraft>>({});
  const [bundleCart, setBundleCart] = useState<BundleSelectionDraft[]>([]);
  const [openBundleToolId, setOpenBundleToolId] = useState<string | null>(null);
  const now = useTick(30_000);
  const wechatShareCard = useMemo(
    () =>
      project
        ? buildWechatShareCardFromProject(project.id, project.data, shop?.data, {
            prefix: '大马饭团',
          })
        : null,
    [project, shop?.data]
  );
  const wechatShareDebug = useWechatShareCard(wechatShareCard);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setErr(null);
      try {
        const row = await getProject(decodeURIComponent(projectId));
        if (!row || row.data.feituanStatus !== 'listed') {
          if (!cancelled) setErr('饭团项目不存在或尚未上架。');
          return;
        }
        const shopRow = await getShopById(row.data.shopId);
        if (!cancelled) {
          setProject(row);
          setShop(shopRow);
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : '加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    if (!isAppendMode) {
      setAppendTarget(null);
      setAppendErr(null);
      return;
    }
    void (async () => {
      setAppendErr(null);
      try {
        const row = await getOrderByNumber(
          decodeURIComponent(projectId),
          decodeURIComponent(appendOrderNumber)
        );
        if (cancelled) return;
        if (!row || row.data.channel !== 'feituan') {
          setAppendTarget(null);
          setAppendErr('找不到可加购的饭团订单。');
          return;
        }
        setAppendTarget(row);
      } catch (e) {
        if (!cancelled) {
          setAppendErr(e instanceof Error ? e.message : '加载加购订单失败');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appendOrderNumber, isAppendMode, projectId]);

  const sellableProducts = useMemo(
    () =>
      [...(project?.data.products ?? [])]
        .filter((p) => isProjectProductSellable(p, now) && p.stock > 0)
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [project?.data.products, now]
  );

  const activeBundleTools = useMemo(
    () =>
      [...(project?.data.bundleTools ?? [])]
        .filter(
          (tool) =>
            tool.isActive &&
            !isBundleToolPastScheduledOff(tool, now.getTime()) &&
            tool.schemes.some((scheme) => scheme.isActive)
        )
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [now, project?.data.bundleTools]
  );

  const mixedItems = useMemo(() => {
    const products = sellableProducts.map((product) => ({
      kind: 'product' as const,
      key: `p:${product.id}`,
      sortOrder: product.sortOrder ?? 0,
      product,
    }));
    const bundles = activeBundleTools.map((tool) => ({
      kind: 'bundle' as const,
      key: `b:${tool.id}`,
      sortOrder: tool.sortOrder ?? 0,
      tool,
    }));
    return [...products, ...bundles].sort((a, b) => a.sortOrder - b.sortOrder);
  }, [activeBundleTools, sellableProducts]);

  const orderLines = useMemo<OrderLine[]>(() => {
    const normalLines = sellableProducts
      .map((p) => {
        const q = qty[p.id] ?? 0;
        if (q <= 0) return null;
        const price = effectiveProductPrice(p, now);
        return {
          productId: p.id,
          name: p.name,
          quantity: q,
          unitPrice: price.unit,
          isDiscount: price.isDiscount,
          ...(price.discountEndsAt ? { discountEndsAt: price.discountEndsAt } : {}),
        } satisfies OrderLine;
      })
      .filter((x): x is OrderLine => Boolean(x));
    const bundleLines = bundleCart.map((x, idx) => ({
      productId: `bundle:${x.bundleToolId}:${x.schemeId}:${idx}`,
      name: x.label,
      quantity: x.quantity,
      unitPrice: x.unitPrice,
      isDiscount: x.isDiscount ?? false,
      ...(x.discountEndsAt ? { discountEndsAt: x.discountEndsAt } : {}),
    }));
    return [...normalLines, ...bundleLines];
  }, [bundleCart, now, qty, sellableProducts]);

  const total = orderLines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const totalQty = orderLines.reduce((sum, l) => sum + l.quantity, 0);

  const getCurrentScheme = (tool: BundleToolDoc): BundleSchemeDoc | null => {
    const draft = bundleBuilder[tool.id];
    if (!draft?.schemeId) return null;
    return tool.schemes.find((s) => s.id === draft.schemeId && s.isActive) ?? null;
  };

  const toggleBundleOption = (tool: BundleToolDoc, seriesId: string, optionId: string) => {
    setBundleBuilder((prev) => {
      const cur = prev[tool.id] ?? { schemeId: '', selectedBySeries: {} };
      const scheme = tool.schemes.find((x) => x.id === cur.schemeId);
      const series = tool.series.find((x) => x.id === seriesId);
      if (!scheme || !series) return prev;
      const required = getSeriesRequiredCount(scheme.requirements, series);
      if (required <= 0) return prev;
      const selected = cur.selectedBySeries[seriesId] ?? [];
      const has = selected.includes(optionId);
      if (!has && selected.length >= required) return prev;
      return {
        ...prev,
        [tool.id]: {
          ...cur,
          selectedBySeries: {
            ...cur.selectedBySeries,
            [seriesId]: has
              ? selected.filter((x) => x !== optionId)
              : [...selected, optionId],
          },
        },
      };
    });
  };

  const addBundleToCart = (tool: BundleToolDoc) => {
    const draft = bundleBuilder[tool.id];
    if (!draft?.schemeId) return;
    const scheme = tool.schemes.find((x) => x.id === draft.schemeId && x.isActive);
    if (!scheme) return;

    for (const series of tool.series) {
      const required = getSeriesRequiredCount(scheme.requirements, series);
      const picked = draft.selectedBySeries[series.id] ?? [];
      if (picked.length !== required) return;
    }

    const labelParts = tool.series
      .map((series) => {
        const picked = draft.selectedBySeries[series.id] ?? [];
        if (picked.length === 0) return '';
        const names = picked
          .map((id) => series.options.find((o) => o.id === id)?.name)
          .filter(Boolean)
          .join('、');
        return `${series.name}:${names}`;
      })
      .filter(Boolean);
    const label = `${tool.name}（${scheme.name}） ${labelParts.join('；')}`.trim();
    const price = effectiveSchemePrice(scheme, now);
    const selectedOptionIdsBySeries = Object.fromEntries(
      Object.entries(draft.selectedBySeries).map(([key, value]) => [key, [...value]])
    );

    setBundleCart((prev) => {
      const idx = prev.findIndex(
        (x) =>
          x.bundleToolId === tool.id &&
          x.schemeId === scheme.id &&
          JSON.stringify(x.selectedOptionIdsBySeries) ===
            JSON.stringify(selectedOptionIdsBySeries)
      );
      if (idx < 0) {
        return [
          ...prev,
          {
            bundleToolId: tool.id,
            schemeId: scheme.id,
            selectedOptionIdsBySeries,
            quantity: 1,
            unitPrice: price.unit,
            isDiscount: price.isDiscount,
            ...(price.discountEndsAt ? { discountEndsAt: price.discountEndsAt } : {}),
            label,
          },
        ];
      }
      const next = [...prev];
      next[idx] = { ...next[idx]!, quantity: next[idx]!.quantity + 1 };
      return next;
    });
    setBundleBuilder((prev) => ({
      ...prev,
      [tool.id]: { schemeId: prev[tool.id]?.schemeId ?? '', selectedBySeries: {} },
    }));
  };

  const goOrder = () => {
    if (!project || orderLines.length === 0) return;
    if (isAppendMode) {
      if (!appendTarget || appendSubmitting) return;
      setAppendSubmitting(true);
      setAppendErr(null);
      void customerAppendLinesToOrder({
        orderFirestoreId: appendTarget.id,
        projectId: project.id,
        orderNumber: appendTarget.data.orderNumber,
        customerKey: getOrCreateCustomerKey(),
        additionalLines: orderLines,
        bundleSelections: bundleCart,
      })
        .then(() => {
          navigate(
            `/feituan/projects/${encodeURIComponent(project.id)}/orders/${encodeURIComponent(appendTarget.data.orderNumber)}`,
            { replace: true }
          );
        })
        .catch((e: unknown) => {
          setAppendErr(e instanceof Error ? e.message : '加购失败，请重试');
        })
        .finally(() => setAppendSubmitting(false));
      return;
    }
    navigate(`/feituan/projects/${encodeURIComponent(project.id)}/order`, {
      state: {
        lines: orderLines,
        bundleSelections: bundleCart,
        projectTitle: project.data.title,
        cartDraft: qty,
      },
    });
  };

  return (
    <PageShell title="饭团项目" subtitle={shop?.data.name ?? '大马饭团'}>
      <div className="mb-3 flex flex-wrap gap-2">
        <Link to="/feituan" className="text-sm text-indigo-600">
          ← 返回大马饭团
        </Link>
        <Link
          to={`/feituan/projects/${encodeURIComponent(projectId)}/my-orders`}
          className="text-sm font-medium text-orange-700"
        >
          我的订单
        </Link>
      </div>
      {loading ? <p className="text-sm text-gray-600">加载中…</p> : null}
      {err ? <p className="text-sm text-red-600">{err}</p> : null}
      {project ? (
        <div className="space-y-4">
          <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <p className="mb-1 text-xs text-gray-500">{shop?.data.name ?? '店铺'}</p>
            <h1 className="text-2xl font-bold text-gray-900">{project.data.title || '未命名项目'}</h1>
            {isAppendMode ? (
              <p className="mt-3 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                正在为订单 #{appendOrderNumber} 加购。若还没有发生新的支付动作，本次加购会并入当前待付款支付组。
              </p>
            ) : null}
            {appendErr ? (
              <p className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
                {appendErr}
              </p>
            ) : null}
            {stripText(project.data.textContent) ? (
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                {stripText(project.data.textContent)}
              </p>
            ) : null}
          </section>
          <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-base font-semibold text-gray-900">选择商品 / 套餐</h2>
            {sellableProducts.length === 0 && activeBundleTools.length === 0 ? (
              <p className="text-sm text-gray-600">暂无可售商品。</p>
            ) : (
              <div className="space-y-3">
                {mixedItems.map((item) => {
                  if (item.kind === 'product') {
                  const p = item.product;
                  const price = effectiveProductPrice(p, now);
                  const cur = qty[p.id] ?? 0;
                  return (
                    <div key={item.key} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                      <div className="flex gap-3">
                        {p.imageUrl ? (
                          <img src={p.imageUrl} alt="" className="h-20 w-20 rounded-lg object-cover" loading="lazy" />
                        ) : null}
                        <div className="min-w-0 flex-1">
                          <h3 className="font-semibold text-gray-900">{p.name}</h3>
                          {p.description ? (
                            <p className="mt-1 line-clamp-2 text-xs text-gray-500">{p.description}</p>
                          ) : null}
                          <p className="mt-2 text-sm font-semibold text-orange-700">
                            {price.isDiscount ? (
                              <span className="mr-1 text-xs text-gray-400 line-through">
                                {formatMYR(p.price)}
                              </span>
                            ) : null}
                            {formatMYR(price.unit)}
                            {price.isDiscount ? (
                              <span
                                className={`ml-1 rounded px-1.5 py-0.5 text-xs font-semibold ${
                                  price.discountType === 'earlybird'
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-rose-100 text-rose-700'
                                }`}
                              >
                                {promoLabel(price)}
                              </span>
                            ) : null}
                          </p>
                          {price.discountEndsAt ? (
                            <p className="mt-1 text-[11px] text-amber-700">
                              早鸟截止{' '}
                              {new Date(price.discountEndsAt).toLocaleString('zh-CN', {
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: false,
                              })}
                              {formatRemainingShort(price.discountEndsAt, now)
                                ? ` · 还剩 ${formatRemainingShort(price.discountEndsAt, now)}`
                                : ''}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            className="h-8 w-8 rounded-full border border-gray-200 bg-white text-lg"
                            onClick={() => setQty((prev) => ({ ...prev, [p.id]: Math.max(0, cur - 1) }))}
                          >
                            -
                          </button>
                          <span className="w-6 text-center text-sm font-semibold">{cur}</span>
                          <button
                            type="button"
                            className="h-8 w-8 rounded-full bg-orange-600 text-lg text-white"
                            onClick={() =>
                              setQty((prev) => ({
                                ...prev,
                                [p.id]: Math.min(p.stock, cur + 1),
                              }))
                            }
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                  }
                  const tool = item.tool;
                  const draft = bundleBuilder[tool.id] ?? {
                    schemeId: '',
                    selectedBySeries: {},
                  };
                  const scheme = getCurrentScheme(tool);
                  const isOpen = openBundleToolId === tool.id;
                  const activeSchemes = tool.schemes
                    .filter((x) => x.isActive)
                    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
                  const previewOptions = tool.series
                    .flatMap((series) => series.options)
                    .filter((option) => option.isActive && option.imageUrl)
                    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
                  const compactPreviewOptions = previewOptions.slice(0, isOpen ? 9 : 4);
                  const hiddenPreviewCount = Math.max(
                    0,
                    previewOptions.length - compactPreviewOptions.length
                  );
                  const bundleAddDisabled =
                    !scheme ||
                    tool.series.some((series) => {
                      const required = scheme
                        ? getSeriesRequiredCount(scheme.requirements, series)
                        : 0;
                      if (required <= 0) return false;
                      const selected = draft.selectedBySeries[series.id] ?? [];
                      return selected.length !== required;
                    });
                  return (
                    <div key={item.key} className="rounded-xl border border-orange-100 bg-orange-50/50 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <h3 className="font-semibold text-gray-900">{tool.name}</h3>
                          {tool.description ? (
                            <p className="mt-1 line-clamp-2 text-xs text-gray-600">
                              {tool.description}
                            </p>
                          ) : null}
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {activeSchemes.map((s) => {
                              const price = effectiveSchemePrice(s, now);
                              return (
                                <span
                                  key={s.id}
                                  className="rounded-full border border-orange-100 bg-white px-2 py-0.5 text-xs text-orange-950"
                                >
                                  {s.name} · {formatMYR(price.unit)}
                                  {price.isDiscount ? ` · ${promoLabel(price)}` : ''}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white"
                          onClick={() => setOpenBundleToolId(isOpen ? null : tool.id)}
                        >
                          {isOpen ? '收起' : '选择'}
                        </button>
                      </div>
                      {compactPreviewOptions.length > 0 ? (
                        <div
                          className={`mt-3 grid gap-2 ${
                            isOpen ? 'grid-cols-3' : 'grid-cols-4'
                          }`}
                        >
                          {compactPreviewOptions.map((option, index) => {
                            const soldOut = option.stock <= 0;
                            const showMore =
                              !isOpen &&
                              hiddenPreviewCount > 0 &&
                              index === compactPreviewOptions.length - 1;
                            return (
                              <div key={option.id} className="min-w-0">
                                <div className="relative aspect-square overflow-hidden rounded-xl bg-white ring-1 ring-orange-100">
                                  <img
                                    src={option.imageUrl}
                                    alt=""
                                    className={`h-full w-full object-cover ${
                                      soldOut ? 'opacity-60' : ''
                                    }`}
                                    loading="lazy"
                                  />
                                  {soldOut ? (
                                    <span className="absolute inset-x-0 bottom-0 bg-black/65 py-0.5 text-center text-[10px] font-medium text-white">
                                      已售罄
                                    </span>
                                  ) : null}
                                  {showMore ? (
                                    <span className="absolute right-1 top-1 rounded-full bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                                      +{hiddenPreviewCount}
                                    </span>
                                  ) : null}
                                </div>
                                <p className="mt-1 truncate text-center text-[10px] font-medium text-gray-600">
                                  {option.name}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                      {isOpen ? (
                        <div className="mt-3 space-y-3 border-t border-orange-100 pt-3">
                          <div>
                            <p className="mb-1 text-xs font-medium text-gray-700">选择套餐规格</p>
                            <div className="flex flex-wrap gap-2">
                              {activeSchemes.map((s) => {
                                const selected = draft.schemeId === s.id;
                                const price = effectiveSchemePrice(s, now);
                                return (
                                  <button
                                    key={s.id}
                                    type="button"
                                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                                      selected
                                        ? 'bg-gray-900 text-white'
                                        : 'border border-gray-200 bg-white text-gray-800'
                                    }`}
                                    onClick={() =>
                                      setBundleBuilder((prev) => ({
                                        ...prev,
                                        [tool.id]: {
                                          schemeId: s.id,
                                          selectedBySeries:
                                            prev[tool.id]?.selectedBySeries ?? {},
                                        },
                                      }))
                                    }
                                  >
                                    {s.name} · {formatMYR(price.unit)}
                                    {price.isDiscount ? ` · ${promoLabel(price)}` : ''}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                          {scheme ? (
                            tool.series.map((series) => {
                              const required = getSeriesRequiredCount(
                                scheme.requirements,
                                series
                              );
                              if (required <= 0) return null;
                              const selected = draft.selectedBySeries[series.id] ?? [];
                              return (
                                <div key={series.id}>
                                  <div className="mb-1 flex justify-between text-xs text-gray-700">
                                    <span className="font-medium">{series.name}</span>
                                    <span>
                                      选 {required} 项（已选 {selected.length}）
                                    </span>
                                  </div>
                                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                    {series.options
                                      .filter((o) => o.isActive)
                                      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
                                      .map((opt) => {
                                        const checked = selected.includes(opt.id);
                                        const soldOut = opt.stock <= 0;
                                        return (
                                          <button
                                            key={opt.id}
                                            type="button"
                                            disabled={soldOut}
                                            className={`rounded-xl border px-3 py-2 text-left text-xs ${
                                              soldOut
                                                ? 'border-gray-100 bg-gray-50 text-gray-400'
                                                : checked
                                                  ? 'border-orange-400 bg-white text-orange-950 ring-2 ring-orange-200'
                                                  : 'border-gray-200 bg-white text-gray-800'
                                            }`}
                                            onClick={() =>
                                              toggleBundleOption(tool, series.id, opt.id)
                                            }
                                          >
                                            {opt.imageUrl ? (
                                              <img
                                                src={opt.imageUrl}
                                                alt=""
                                                className={`mb-2 aspect-square w-full rounded-lg object-cover ${
                                                  soldOut ? 'opacity-60' : ''
                                                }`}
                                                loading="lazy"
                                              />
                                            ) : null}
                                            <div className="font-semibold">{opt.name}</div>
                                            {opt.note ? (
                                              <div className="mt-0.5 line-clamp-2 text-[11px] text-gray-500">
                                                {opt.note}
                                              </div>
                                            ) : null}
                                            <div className="mt-1 text-[11px]">
                                              {soldOut ? '已售罄' : `余 ${opt.stock}`}
                                            </div>
                                          </button>
                                        );
                                      })}
                                  </div>
                                </div>
                              );
                            })
                          ) : (
                            <p className="text-xs text-gray-500">请先选择套餐规格。</p>
                          )}
                          <button
                            type="button"
                            disabled={bundleAddDisabled}
                            className="h-10 w-full rounded-xl bg-orange-600 text-sm font-semibold text-white disabled:bg-gray-300"
                            onClick={() => addBundleToCart(tool)}
                          >
                            加入购物车
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
            {bundleCart.length > 0 ? (
              <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50 p-3">
                <div className="mb-1 text-xs font-semibold text-emerald-900">已选套餐</div>
                <div className="space-y-1">
                  {bundleCart.map((x, idx) => (
                    <div
                      key={`${x.bundleToolId}-${x.schemeId}-${idx}`}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <span className="min-w-0 truncate text-emerald-900">{x.label}</span>
                      <span className="shrink-0 text-emerald-900">
                        x{x.quantity} · {formatMYR(x.quantity * x.unitPrice)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
          <section className="sticky bottom-0 -mx-1 rounded-t-2xl border border-orange-100 bg-white/95 p-3 shadow-lg backdrop-blur">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="text-gray-600">已选 {totalQty} 件</span>
              <span className="font-bold text-gray-900">{formatMYR(total)}</span>
            </div>
            <button
              type="button"
              disabled={orderLines.length === 0 || appendSubmitting || (isAppendMode && !appendTarget)}
              onClick={goOrder}
              className="h-11 w-full rounded-xl bg-orange-600 text-sm font-semibold text-white disabled:bg-gray-300"
            >
              {appendSubmitting
                ? '加购中…'
                : isAppendMode
                  ? '确认加购'
                  : '填写订单'}
            </button>
          </section>
        </div>
      ) : null}
      {wechatShareDebug ? (
        <pre className="fixed inset-x-2 bottom-2 z-[9999] max-h-[45vh] overflow-auto rounded-xl bg-black/90 p-3 text-[11px] leading-relaxed text-lime-100 shadow-2xl">
          {JSON.stringify(wechatShareDebug, null, 2)}
        </pre>
      ) : null}
    </PageShell>
  );
}
