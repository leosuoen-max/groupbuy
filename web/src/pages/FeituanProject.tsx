import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PageShell } from '../components/PageShell';
import { ProductCard } from '../components/customer/ProductCard';
import { ShopContentBlocks } from '../components/customer/ShopContentBlocks';
import { ShopHeader } from '../components/customer/ShopHeader';
import { ShopProjectStatusCard } from '../components/customer/ShopProjectStatusCard';
import { useAuthUser } from '../hooks/useAuthUser';
import { useWechatNotifySession } from '../hooks/useWechatNotifySession';
import { useWechatShareCard } from '../hooks/useWechatShareCard';
import { shopHomeAnnouncementHasVisibleBody } from '../lib/shopDescriptionMixedLines';
import { isFeituanAdmin } from '../lib/feituanService';
import { getProject, type ProjectRow } from '../lib/projectService';
import { getShopById, type ShopRow } from '../lib/shopService';
import { buildWechatShareCardFromProject } from '../lib/wechatShareMeta';
import { formatMYR } from '../lib/formatMYR';
import { formatRemainingShort } from '../lib/countdown';
import { FEITUAN_TW } from '../lib/feituanHomeTheme';
import { DESIGN_BORDER, H5_COLUMN_CLASS } from '../lib/shopTheme';
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
import type { MockProduct, MockShopHome, ProjectStatus } from '../data/mockShopHome';

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

type Props = {
  mode?: 'customer' | 'adminPreview';
};

const FEITUAN_THEME_COLOR = '#08c279';

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

function tsToIso(t: { toDate?: () => Date } | null | undefined): string | undefined {
  return t?.toDate ? t.toDate().toISOString() : undefined;
}

function mapProjectProductToMock(p: ProjectProduct): MockProduct {
  const scheduledIso = tsToIso(p.scheduledOffAt);
  return {
    id: p.id,
    name: p.name,
    note: p.description,
    sortOrder: p.sortOrder ?? 0,
    price: Number(p.price) || 0,
    discountPrice: p.discountPrice,
    discountStart: tsToIso(p.discountStart),
    discountEnd: tsToIso(p.discountEnd),
    stock: p.stock,
    imageUrl: p.imageUrl,
    isActive: p.isActive,
    ...(scheduledIso ? { scheduledOffAt: scheduledIso } : {}),
  };
}

function resolveProjectStatus(project: ProjectRow['data'], now: Date): ProjectStatus {
  if (project.status === 'closed') return 'closed';
  const closes = project.closesAt?.toDate?.() ?? null;
  if (closes && now.getTime() > closes.getTime()) return 'closed';
  const max = project.maxParticipants;
  if (max != null && max > 0 && (project.stats?.totalOrders ?? 0) >= max) {
    return 'full';
  }
  return 'open';
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

export default function FeituanProject({ mode = 'customer' }: Props) {
  useWechatNotifySession();
  const isAdminPreview = mode === 'adminPreview';
  const { user, loading: authLoading } = useAuthUser();
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
  const { debug: wechatShareDebug } = useWechatShareCard(wechatShareCard);

  useEffect(() => {
    let cancelled = false;
    if (isAdminPreview && authLoading) return;
    void (async () => {
      setLoading(true);
      setErr(null);
      try {
        const row = await getProject(decodeURIComponent(projectId));
        if (!row) {
          if (!cancelled) setErr('饭团项目不存在。');
          return;
        }
        if (isAdminPreview) {
          const ok = user ? await isFeituanAdmin(user.uid) : false;
          if (!ok) {
            if (!cancelled) setErr('当前账号无饭团管理员权限。');
            return;
          }
        } else if (row.data.feituanStatus !== 'listed') {
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
  }, [authLoading, isAdminPreview, projectId, user]);

  useEffect(() => {
    let cancelled = false;
    if (!isAppendMode) {
      queueMicrotask(() => {
        if (cancelled) return;
        setAppendTarget(null);
        setAppendErr(null);
      });
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
        .filter((p) => isProjectProductSellable(p, now))
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

  const shopHomeData = useMemo<MockShopHome | null>(() => {
    if (!project) return null;
    const p = project.data;
    const cover = p.imageBlocks?.find((b) => b.isCoverImage)?.url?.trim();
    return {
      shopName: shop?.data.name ?? '店铺',
      shopLogoUrl: shop?.data.logoImage?.trim() || undefined,
      projectTitle: p.title || '未命名项目',
      bannerUrl: cover || shop?.data.bannerImage?.trim() || undefined,
      themeColor: FEITUAN_THEME_COLOR,
      status: resolveProjectStatus(p, now),
      closesAt: p.closesAt?.toDate?.()?.toISOString() ?? new Date().toISOString(),
      orderCount: p.stats?.totalOrders ?? 0,
      deliveryLabel: '按配送点',
      textContent: p.textContent?.trim() || undefined,
      imageBlocks:
        p.imageBlocks
          ?.filter((b) => !b.isCoverImage)
          .map((b) => ({ url: b.url, caption: b.caption })) ?? [],
      products: sellableProducts.map(mapProjectProductToMock),
      bundleTools: [],
    };
  }, [now, project, sellableProducts, shop?.data]);

  const hasProjectDescription = useMemo(
    () => (shopHomeData ? shopHomeAnnouncementHasVisibleBody(shopHomeData) : false),
    [shopHomeData]
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
    return [...products, ...bundles].sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      if (a.kind !== b.kind) return a.kind === 'product' ? -1 : 1;
      return a.key.localeCompare(b.key);
    });
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
    if (isAdminPreview || !project || orderLines.length === 0) return;
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

  if (!isAdminPreview) {
    return (
      <div className="pb-36">
        {shopHomeData ? (
          <>
            <ShopHeader
              data={shopHomeData}
              onShare={() => undefined}
              onOpenMore={() => undefined}
              hideActions
            />
            <ShopProjectStatusCard
              data={shopHomeData}
              now={now}
              accentColor={shopHomeData.themeColor}
            />

            {hasProjectDescription ? (
              <>
                <hr className="h-px w-full border-0 bg-[#e5e7eb]" aria-hidden />
                <section className="px-4 pb-2.5 pt-3.5" aria-label="公告">
                  <div className="rounded-[10px] border border-[#e5e7eb] bg-white px-3.5 py-3">
                    <ShopContentBlocks
                      data={shopHomeData}
                      embeddedInCard
                      dedupeTitleWithProject={shopHomeData.projectTitle}
                    />
                  </div>
                </section>
              </>
            ) : null}

            {isAppendMode ? (
              <section className="px-4 pb-2 pt-1">
                <div className={`rounded-2xl border px-3 py-2 text-xs ${FEITUAN_TW.panelLoose}`}>
                  <p className="font-semibold">
                    加购模式 · 订单 #{appendTarget?.data.orderNumber ?? appendOrderNumber}
                  </p>
                  <p className="mt-0.5">
                    本次提交将作为加购补单写回原订单，不会新建订单。
                  </p>
                  {appendErr ? <p className="mt-1 text-red-700">{appendErr}</p> : null}
                </div>
              </section>
            ) : null}

            <section className="px-4 pb-6 pt-1.5" aria-label="商品清单">
              <div className="mb-2 flex items-baseline justify-between px-0 pt-1">
                <h2 className="text-[15px] font-bold tracking-tight text-slate-900">
                  商品清单
                </h2>
                <span className="text-[11px] text-slate-400">
                  截单与库存以页面状态为准
                </span>
              </div>
              <div>
                {mixedItems.map((item) => {
                  if (item.kind === 'product') {
                    const p = item.product;
                    const mockProduct = mapProjectProductToMock(p);
                    const cur = qty[p.id] ?? 0;
                    return (
                      <ProductCard
                        key={item.key}
                        product={mockProduct}
                        quantity={cur}
                        now={now}
                        themeColor={shopHomeData.themeColor}
                        accentColor={shopHomeData.themeColor}
                        onInc={() => {
                          if (cur >= p.stock) return;
                          setQty((prev) => ({ ...prev, [p.id]: cur + 1 }));
                        }}
                        onDec={() => {
                          if (cur <= 0) return;
                          setQty((prev) => ({ ...prev, [p.id]: cur - 1 }));
                        }}
                      />
                    );
                  }

                  const tool = item.tool;
                  const draft = bundleBuilder[tool.id] ?? {
                    schemeId: '',
                    selectedBySeries: {},
                  };
                  const scheme = getCurrentScheme(tool);
                  const isOpen = openBundleToolId === tool.id;
                  const previewOptions = tool.series
                    .flatMap((series) => series.options)
                    .filter((option) => option.isActive && option.imageUrl)
                    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
                  const activeSchemes = tool.schemes
                    .filter((x) => x.isActive)
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
                    <article key={item.key} className="py-3.5">
                      <div>
                        <button
                          type="button"
                          className="float-right ml-2 rounded-lg px-4 py-2 text-xs font-semibold text-white shadow-sm transition active:scale-95"
                          style={{ backgroundColor: shopHomeData.themeColor }}
                          onClick={() => setOpenBundleToolId(isOpen ? null : tool.id)}
                        >
                          {isOpen ? '收起' : '选择'}
                        </button>
                        <div className="leading-[2.05rem]">
                          <span className="mr-2 align-middle text-[17px] font-semibold leading-tight text-slate-900">
                            {tool.name}
                          </span>
                          {activeSchemes.map((s) => {
                            const ep = effectiveSchemePrice(s, now);
                            const isEarlyBird = Boolean(ep.discountEndsAt);
                            return (
                              <span
                                key={s.id}
                                className="mb-1.5 mr-1.5 inline-flex max-w-full align-middle items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[12px] leading-tight text-slate-700"
                              >
                                <span className="font-medium">{s.name}</span>
                                <span>· RM {ep.unit.toFixed(2)}</span>
                                {ep.isDiscount ? (
                                  <span
                                    className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold leading-none ${
                                      isEarlyBird
                                        ? 'bg-amber-100 text-amber-800'
                                        : 'bg-rose-100 text-rose-700'
                                    }`}
                                  >
                                    {isEarlyBird ? '早鸟价' : '特惠'}
                                  </span>
                                ) : null}
                              </span>
                            );
                          })}
                        </div>
                        <div className="clear-both" />
                      </div>

                      {tool.description?.trim() ? (
                        <p className="mt-1 truncate text-[12px] leading-snug text-slate-500">
                          {tool.description.trim()}
                        </p>
                      ) : null}

                      {previewOptions.length > 0 ? (
                        <div
                          className={`${
                            isOpen ? 'mt-3 grid grid-cols-3 gap-2' : 'mt-2 grid grid-cols-4 gap-1.5'
                          }`}
                        >
                          {compactPreviewOptions.map((option, idx) => {
                            const soldOut = option.stock <= 0;
                            const showMore =
                              !isOpen &&
                              hiddenPreviewCount > 0 &&
                              idx === compactPreviewOptions.length - 1;
                            return (
                              <div key={option.id} className="flex min-w-0 flex-col gap-1">
                                <div
                                  className={`relative aspect-square overflow-hidden bg-slate-50 ring-1 ring-slate-100 ${
                                    isOpen ? 'rounded-2xl' : 'rounded-xl'
                                  }`}
                                >
                                  <img
                                    src={option.imageUrl}
                                    alt=""
                                    loading="lazy"
                                    className={`h-full w-full object-cover ${
                                      soldOut ? 'opacity-60' : ''
                                    }`}
                                  />
                                  {soldOut ? (
                                    <span className="absolute inset-x-0 bottom-0 bg-slate-900/70 py-0.5 text-center text-[11px] font-medium text-white">
                                      已售罄
                                    </span>
                                  ) : null}
                                  {showMore ? (
                                    <span className="absolute right-1 top-1 rounded-full bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                                      +{hiddenPreviewCount}
                                    </span>
                                  ) : null}
                                </div>
                                <div
                                  className={`truncate px-0.5 text-center font-medium text-slate-700 ${
                                    isOpen ? 'text-[12px]' : 'text-[10px]'
                                  }`}
                                >
                                  {option.name}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}

                      {isOpen ? (
                        <div className="mt-3">
                          <div className="border-y border-dashed border-slate-200 py-3">
                            <div className="mb-2 text-[12px] font-medium text-slate-700">
                              选择一个组合
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {activeSchemes.map((s) => {
                                const ep = effectiveSchemePrice(s, now);
                                const isEarlyBird = Boolean(ep.discountEndsAt);
                                const selectedScheme = draft.schemeId === s.id;
                                return (
                                  <button
                                    key={s.id}
                                    type="button"
                                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                                      selectedScheme
                                        ? 'bg-gray-900 text-white'
                                        : 'border border-gray-200 bg-white text-gray-700'
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
                                    <span>{s.name}</span>
                                    {ep.isDiscount ? (
                                      <span
                                        className={`text-[11px] line-through ${
                                          selectedScheme ? 'opacity-70' : 'opacity-60'
                                        }`}
                                      >
                                        RM {s.price.toFixed(2)}
                                      </span>
                                    ) : null}
                                    <span>RM {ep.unit.toFixed(2)}</span>
                                    {ep.isDiscount ? (
                                      <span
                                        className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold leading-none ${
                                          isEarlyBird
                                            ? 'bg-amber-200 text-amber-900'
                                            : 'bg-rose-200 text-rose-800'
                                        }`}
                                      >
                                        {isEarlyBird ? '早鸟价' : '特惠'}
                                      </span>
                                    ) : null}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {scheme ? (
                            <div className="space-y-3 py-3">
                              {tool.series.map((series) => {
                                const required = getSeriesRequiredCount(
                                  scheme.requirements,
                                  series
                                );
                                if (required <= 0) return null;
                                const selected = draft.selectedBySeries[series.id] ?? [];
                                return (
                                  <div key={series.id}>
                                    <div className="mb-1.5 flex justify-between text-[12px] text-slate-700">
                                      <span className="font-medium">{series.name}</span>
                                      <span>
                                        选 {required} 项（已选 {selected.length}）
                                      </span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
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
                                              className={`rounded-xl border p-2 text-left text-xs ${
                                                soldOut
                                                  ? 'border-gray-100 bg-gray-50 text-gray-400'
                                                  : checked
                                                    ? FEITUAN_TW.selected
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
                                                  className={`mb-1.5 h-20 w-full rounded-lg object-cover ${
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
                                              <div className="mt-1 text-[11px] text-teal-700">
                                                {soldOut ? '已售罄' : `余 ${opt.stock}`}
                                              </div>
                                            </button>
                                          );
                                        })}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="py-3 text-xs text-gray-500">请先选择套餐规格。</p>
                          )}

                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={bundleAddDisabled}
                              className="h-10 flex-1 rounded-xl text-sm font-semibold text-white disabled:bg-gray-300"
                              style={{
                                backgroundColor: bundleAddDisabled
                                  ? undefined
                                  : shopHomeData.themeColor,
                              }}
                              onClick={() => addBundleToCart(tool)}
                            >
                              加入购物车
                            </button>
                            <button
                              type="button"
                              className="h-10 shrink-0 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700"
                              onClick={() => setOpenBundleToolId(null)}
                            >
                              收起
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>

            <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center border-t border-[#ececec] bg-white pb-[calc(10px+env(safe-area-inset-bottom,0px))] pt-2.5">
              <div className={`pointer-events-auto flex w-full gap-2.5 px-4 ${H5_COLUMN_CLASS}`}>
                <Link
                  to={`/feituan/projects/${encodeURIComponent(projectId)}/my-orders`}
                  className="inline-flex shrink-0 items-center justify-center rounded-full border bg-white px-[18px] py-2.5 text-sm font-semibold text-[#111] transition active:bg-gray-50"
                  style={{ borderColor: DESIGN_BORDER }}
                >
                  我的订单
                </Link>
                <button
                  type="button"
                  className="flex min-h-[46px] flex-1 items-center justify-center rounded-full px-4 py-3 text-[15px] font-semibold text-white shadow-[0_2px_10px_rgba(249,115,22,0.25)] transition disabled:bg-gray-300 disabled:text-gray-100 disabled:shadow-none"
                  style={{
                    backgroundColor:
                      shopHomeData.status === 'open' && totalQty > 0
                        ? shopHomeData.themeColor
                        : undefined,
                  }}
                  disabled={
                    shopHomeData.status !== 'open' ||
                    totalQty === 0 ||
                    appendSubmitting ||
                    (isAppendMode && !appendTarget)
                  }
                  onClick={goOrder}
                >
                  {appendSubmitting
                    ? '加购中…'
                    : isAppendMode
                      ? totalQty > 0
                        ? `确认加购 · ${totalQty} 件 · ${formatMYR(total)}`
                        : '请选择商品'
                      : totalQty > 0
                        ? `填写订单 · ${totalQty} 件 · ${formatMYR(total)}`
                        : '请选择商品'}
                </button>
              </div>
            </div>
          </>
        ) : (
          <main className="px-4 py-5">
            {loading ? <p className="text-sm text-gray-600">加载中…</p> : null}
            {err ? <p className="text-sm text-red-600">{err}</p> : null}
          </main>
        )}
      </div>
    );
  }

  return (
    <PageShell
      title={isAdminPreview ? '饭团项目预览' : '饭团项目'}
      subtitle={shop?.data.name ?? '大马饭团'}
    >
      <div className="mb-3 flex flex-wrap gap-2">
        {isAdminPreview ? (
          <>
            <Link to="/admin/feituan" className="text-sm text-indigo-600">
              ← 返回饭团管理
            </Link>
            <Link
              to={`/admin/feituan/costs/${encodeURIComponent(projectId)}`}
              className="text-sm font-medium text-orange-700"
            >
              成本确认/更新
            </Link>
            <Link
              to={`/admin/feituan/project-delivery/${encodeURIComponent(projectId)}`}
              className="text-sm font-medium text-orange-700"
            >
              配送设置
            </Link>
          </>
        ) : (
          <>
            <Link to="/feituan" className="text-sm text-indigo-600">
              ← 返回大马饭团
            </Link>
            <Link
              to={`/feituan/projects/${encodeURIComponent(projectId)}/my-orders`}
              className="text-sm font-medium text-orange-700"
            >
              我的订单
            </Link>
          </>
        )}
      </div>
      {loading ? <p className="text-sm text-gray-600">加载中…</p> : null}
      {err ? <p className="text-sm text-red-600">{err}</p> : null}
      {project ? (
        <div className="space-y-4">
          <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <p className="mb-1 text-xs text-gray-500">{shop?.data.name ?? '店铺'}</p>
            <h1 className="text-2xl font-bold text-gray-900">{project.data.title || '未命名项目'}</h1>
            {isAdminPreview ? (
              <p className="mt-3 rounded-xl border border-orange-100 bg-orange-50 px-3 py-2 text-sm text-orange-950">
                后台只读预览：用于审批前查看项目完整内容。商品、价格、文案仍以商户提交内容为准；成本和配送请通过上方入口维护。
              </p>
            ) : null}
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
                        {isAdminPreview ? (
                          <div className="shrink-0 rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
                            库存 {p.stock}
                          </div>
                        ) : (
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
                        )}
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
                          {isAdminPreview ? null : (
                            <button
                              type="button"
                              disabled={bundleAddDisabled}
                              className="h-10 w-full rounded-xl bg-orange-600 text-sm font-semibold text-white disabled:bg-gray-300"
                              onClick={() => addBundleToCart(tool)}
                            >
                              加入购物车
                            </button>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
            {bundleCart.length > 0 ? (
              <div className={`mt-3 rounded-xl border p-3 ${FEITUAN_TW.panel}`}>
                <div className={`mb-1 text-xs font-semibold ${FEITUAN_TW.text}`}>已选套餐</div>
                <div className="space-y-1">
                  {bundleCart.map((x, idx) => (
                    <div
                      key={`${x.bundleToolId}-${x.schemeId}-${idx}`}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <span className={`min-w-0 truncate ${FEITUAN_TW.text}`}>{x.label}</span>
                      <span className={`shrink-0 ${FEITUAN_TW.text}`}>
                        x{x.quantity} · {formatMYR(x.quantity * x.unitPrice)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
          {isAdminPreview ? null : (
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
          )}
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
