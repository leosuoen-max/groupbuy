import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ShopHeader } from '../../components/customer/ShopHeader';
import { ShopProjectStatusCard } from '../../components/customer/ShopProjectStatusCard';
import { ShopContentBlocks } from '../../components/customer/ShopContentBlocks';
import { shopHomeAnnouncementHasVisibleBody } from '../../lib/shopDescriptionMixedLines';
import { ProductCard } from '../../components/customer/ProductCard';
import { ShopBottomBar } from '../../components/customer/ShopBottomBar';
import { ShopMoreMenuSheet } from '../../components/customer/ShopMoreMenuSheet';
import {
  getMockShopHome,
  type MockShopHome,
} from '../../data/mockShopHome';
import { isMockProductSellable } from '../../lib/productAvailability';
import { getEffectivePrice } from '../../lib/productPrice';
import { formatMYR } from '../../lib/formatMYR';
import { formatRemainingShort } from '../../lib/countdown';
import {
  loadShopHomeFromFirestore,
  shopHomeErrorMessage,
} from '../../lib/shopHomeService';
import { toLoadErrorMessage } from '../../lib/firebaseErrorMessage';
import { useAuthUser } from '../../hooks/useAuthUser';
import {
  customerAppendLinesToOrder,
  getOrderByNumber,
  listOrdersByCustomer,
  type OrderRow,
} from '../../lib/orderService';
import { getProjectPermissionForUser } from '../../lib/permissionService';
import { getShopBySlug } from '../../lib/shopService';
import { listCardTemplatesByShop } from '../../lib/cardService';
import { getOrCreateCustomerKey } from '../../lib/customerIdentity';
import type { BundleSelectionDraft, CartLocationState } from '../../types/orderDraft';

function getEffectiveSchemePrice(
  scheme: {
    price: number;
    discountPrice?: number;
    discountStart?: string;
    discountEnd?: string;
  },
  now: Date
): { unit: number; isDiscount: boolean; discountEndsAt?: string } {
  if (scheme.discountPrice != null) {
    if (scheme.discountEnd) {
      const within =
        now <= new Date(scheme.discountEnd) &&
        (!scheme.discountStart || now >= new Date(scheme.discountStart));
      if (within) {
        return { unit: scheme.discountPrice, isDiscount: true, discountEndsAt: scheme.discountEnd };
      }
      return { unit: scheme.price, isDiscount: false };
    }
    return { unit: scheme.discountPrice, isDiscount: true };
  }
  return { unit: scheme.price, isDiscount: false };
}

function getSeriesRequiredCount(
  requirements: Record<string, number> | undefined,
  series: { id: string; code?: string; name?: string }
): number {
  if (!requirements) return 0;
  const byId = Number(requirements[series.id] ?? 0);
  if (byId > 0) return byId;
  const code = (series.code ?? '').trim();
  if (code) {
    const byCode = Number(requirements[code] ?? 0);
    if (byCode > 0) return byCode;
  }
  const name = (series.name ?? '').trim();
  if (name) {
    const byName = Number(requirements[name] ?? 0);
    if (byName > 0) return byName;
  }
  return 0;
}

function useTick(ms: number) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

export default function ShopHome() {
  const { shopSlug = '', projectId = '' } = useParams<{
    shopSlug: string;
    projectId: string;
  }>();
  const { user, loading: authLoading } = useAuthUser();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const useMock = searchParams.get('mock') === '1';
  const appendOrderNumber = searchParams.get('appendOrder')?.trim() ?? '';
  const isAppendMode = appendOrderNumber.length > 0;
  const navigate = useNavigate();
  const now = useTick(30_000);

  const mockData = useMemo(
    () => (useMock ? getMockShopHome(shopSlug, projectId) : null),
    [useMock, shopSlug, projectId]
  );

  const [remote, setRemote] = useState<{
    loading: boolean;
    error?: string;
    data?: MockShopHome;
  }>(() => ({ loading: !useMock }));

  const [moreMenu, setMoreMenu] = useState<{
    showMyOrdersPrimary: boolean;
    showMyOrdersInMore: boolean;
    isShopOwner: boolean;
    invitedRole: 'normal_admin' | 'high_admin' | null;
  }>({
    showMyOrdersPrimary: true,
    showMyOrdersInMore: false,
    isShopOwner: false,
    invitedRole: null,
  });

  const [hasShopCards, setHasShopCards] = useState(false);

  const bottomBarMenu = useMemo(
    () =>
      useMock
        ? {
            showMyOrdersPrimary: true,
            showMyOrdersInMore: false,
            isShopOwner: false,
            invitedRole: null,
          }
        : moreMenu,
    [moreMenu, useMock]
  );

  useEffect(() => {
    if (useMock) return;
    let cancelled = false;
    void (async () => {
      try {
        const shop = await getShopBySlug(decodeURIComponent(shopSlug));
        if (!shop || cancelled) return;
        const tpls = await listCardTemplatesByShop(shop.id);
        if (!cancelled) setHasShopCards(tpls.length > 0);
      } catch {
        if (!cancelled) setHasShopCards(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shopSlug, useMock]);

  useEffect(() => {
    if (useMock) return;

    let cancelled = false;
    queueMicrotask(() => {
      setRemote((s) => ({ ...s, loading: true, error: undefined }));
      void loadShopHomeFromFirestore(shopSlug, projectId, new Date())
        .then((r) => {
          if (cancelled) return;
          if (r.ok) setRemote({ loading: false, data: r.data });
          else setRemote({ loading: false, error: shopHomeErrorMessage(r.code) });
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setRemote({ loading: false, error: toLoadErrorMessage(err, '加载失败，请重试。') });
        });
    });

    return () => {
      cancelled = true;
    };
  }, [useMock, shopSlug, projectId]);

  useEffect(() => {
    if (useMock) return;

    let cancelled = false;
    queueMicrotask(() => {
      void (async () => {
        if (authLoading) return;
        const slug = decodeURIComponent(shopSlug);
        const pid = decodeURIComponent(projectId);

        if (!user) {
          try {
            const customerKey = getOrCreateCustomerKey();
            const hasOrders =
              customerKey &&
              (await listOrdersByCustomer(pid, customerKey)).some(
                (row) => row.data.shopSlug === slug
              );
            if (!cancelled) {
              setMoreMenu({
                showMyOrdersPrimary: false,
                showMyOrdersInMore: Boolean(hasOrders),
                isShopOwner: false,
                invitedRole: null,
              });
            }
          } catch {
            if (!cancelled) {
              setMoreMenu({
                showMyOrdersPrimary: false,
                showMyOrdersInMore: false,
                isShopOwner: false,
                invitedRole: null,
              });
            }
          }
          return;
        }

        try {
          const shop = await getShopBySlug(slug);
          const owner = shop?.data.ownerId === user.uid;
          const perm = await getProjectPermissionForUser(user.uid, pid);
          const invited =
            perm?.data.projectId === pid
              ? perm.data.role === 'high_admin'
                ? 'high_admin'
                : perm.data.role === 'normal_admin'
                  ? 'normal_admin'
                  : null
              : null;

          if (!cancelled) {
            setMoreMenu({
              showMyOrdersPrimary: true,
              showMyOrdersInMore: false,
              isShopOwner: owner,
              invitedRole: invited,
            });
          }
        } catch {
          if (!cancelled) {
            setMoreMenu({
              showMyOrdersPrimary: false,
              showMyOrdersInMore: false,
              isShopOwner: false,
              invitedRole: null,
            });
          }
        }
      })();
    });

    return () => {
      cancelled = true;
    };
  }, [authLoading, projectId, shopSlug, useMock, user]);

  const data: MockShopHome | null = useMock ? mockData : remote.data ?? null;
  const loading = !useMock && remote.loading;
  const errorText = !useMock ? remote.error : undefined;

  const [cart, setCart] = useState<Record<string, number>>({});
  const [bundleBuilder, setBundleBuilder] = useState<
    Record<string, { schemeId: string; selectedBySeries: Record<string, string[]> }>
  >({});
  const [bundleCart, setBundleCart] = useState<BundleSelectionDraft[]>([]);
  const [openBundleToolId, setOpenBundleToolId] = useState<string | null>(null);
  const [bundleImagePreview, setBundleImagePreview] = useState<{
    url: string;
    name?: string;
  } | null>(null);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [menuCopied, setMenuCopied] = useState(false);
  const [appendTarget, setAppendTarget] = useState<OrderRow | null>(null);
  const [appendError, setAppendError] = useState<string | null>(null);
  const [appendSubmitting, setAppendSubmitting] = useState(false);
  const incoming = (location.state ?? {}) as CartLocationState;

  useEffect(() => {
    const draft = incoming.cartDraft;
    if (!draft) return;
    queueMicrotask(() => {
      setCart((prev) => {
        const hasChanged = Object.keys(draft).some(
          (k) => (prev[k] ?? 0) !== (draft[k] ?? 0)
        );
        return hasChanged ? { ...draft } : prev;
      });
    });
  }, [incoming.cartDraft]);

  useEffect(() => {
    if (!isAppendMode) {
      queueMicrotask(() => {
        setAppendTarget(null);
        setAppendError(null);
      });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const row = await getOrderByNumber(
          decodeURIComponent(projectId),
          decodeURIComponent(appendOrderNumber)
        );
        if (!row) throw new Error('找不到要加购的订单');
        if (row.data.shopSlug !== decodeURIComponent(shopSlug)) {
          throw new Error('订单与当前店铺不匹配');
        }
        if (row.data.customerKey !== getOrCreateCustomerKey()) {
          throw new Error('仅下单本人可加购（请使用同一浏览器）');
        }
        if (
          row.data.status !== 'unpaid' &&
          row.data.status !== 'pending' &&
          row.data.status !== 'confirmed' &&
          row.data.status !== 'partial_paid'
        ) {
          throw new Error('当前订单状态不可加购');
        }
        if (!cancelled) {
          setAppendTarget(row);
          setAppendError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setAppendTarget(null);
          setAppendError(e instanceof Error ? e.message : '加购订单校验失败');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAppendMode, projectId, appendOrderNumber, shopSlug]);

  const activeProducts = useMemo(
    () => (data ? data.products.filter((p) => isMockProductSellable(p, now)) : []),
    [data, now]
  );

  const setQty = useCallback((productId: string, next: number) => {
    setCart((prev) => {
      const copy = { ...prev };
      if (next <= 0) delete copy[productId];
      else copy[productId] = next;
      return copy;
    });
  }, []);

  const { totalQty, totalAmount } = useMemo(() => {
    let qty = 0;
    let amount = 0;
    for (const p of activeProducts) {
      const q = cart[p.id] ?? 0;
      if (q <= 0) continue;
      const { unit } = getEffectivePrice(p, now);
      qty += q;
      amount += unit * q;
    }
    for (const b of bundleCart) {
      qty += b.quantity;
      amount += b.quantity * b.unitPrice;
    }
    return { totalQty: qty, totalAmount: amount };
  }, [activeProducts, cart, now, bundleCart]);

  const basePath = `/shop/${encodeURIComponent(shopSlug)}/${encodeURIComponent(projectId)}`;

  const handleSharePage = useCallback(async () => {
    if (!data) return;
    const url = window.location.href;
    const title = `${data.shopName} · ${data.projectTitle}`;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
    } catch {
      /* 用户取消分享 */
    }
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt('复制链接：', url);
    }
  }, [data]);

  const handleCopyMenuLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setMenuCopied(true);
      window.setTimeout(() => setMenuCopied(false), 1300);
    } catch {
      setMenuCopied(false);
    }
  }, []);

  const hasProjectDescription = useMemo(() => {
    if (!data) return false;
    return shopHomeAnnouncementHasVisibleBody(data);
  }, [data]);

  const activeBundleTools = useMemo(
    () =>
      (data?.bundleTools ?? [])
        .filter((x) => isMockProductSellable(x, now))
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [data?.bundleTools, now]
  );

  const mixedItems = useMemo(() => {
    const products = activeProducts.map((p) => ({
      kind: 'product' as const,
      key: `p:${p.id}`,
      sortOrder: p.sortOrder ?? 0,
      product: p,
    }));
    const bundles = activeBundleTools.map((tool) => ({
      kind: 'bundle' as const,
      key: `b:${tool.id}`,
      sortOrder: tool.sortOrder ?? 0,
      tool,
    }));
    return [...products, ...bundles].sort((a, b) => a.sortOrder - b.sortOrder);
  }, [activeProducts, activeBundleTools]);

  const getCurrentScheme = (toolId: string) => {
    const draft = bundleBuilder[toolId];
    if (!draft?.schemeId) return null;
    const tool = activeBundleTools.find((x) => x.id === toolId);
    if (!tool) return null;
    return tool.schemes.find((s) => s.id === draft.schemeId && s.isActive) ?? null;
  };

  const toggleBundleOption = (toolId: string, seriesId: string, optionId: string) => {
    setBundleBuilder((prev) => {
      const cur = prev[toolId] ?? { schemeId: '', selectedBySeries: {} };
      const tool = activeBundleTools.find((x) => x.id === toolId);
      if (!tool) return prev;
      const scheme = tool.schemes.find((x) => x.id === cur.schemeId);
      if (!scheme) return prev;
      const required = Number(scheme.requirements?.[seriesId] ?? 0);
      if (required <= 0) return prev;
      const selected = cur.selectedBySeries[seriesId] ?? [];
      const has = selected.includes(optionId);
      if (!has && selected.length >= required) return prev;
      const nextSelected = has
        ? selected.filter((x) => x !== optionId)
        : [...selected, optionId];
      return {
        ...prev,
        [toolId]: {
          ...cur,
          selectedBySeries: {
            ...cur.selectedBySeries,
            [seriesId]: nextSelected,
          },
        },
      };
    });
  };

  const addBundleToCart = (toolId: string) => {
    const tool = activeBundleTools.find((x) => x.id === toolId);
    if (!tool) return;
    const draft = bundleBuilder[toolId];
    if (!draft?.schemeId) return;
    const scheme = tool.schemes.find((x) => x.id === draft.schemeId && x.isActive);
    if (!scheme) return;
    const effective = getEffectiveSchemePrice(scheme, now);

    for (const s of tool.series) {
      const required = getSeriesRequiredCount(scheme.requirements, s);
      const picked = draft.selectedBySeries[s.id] ?? [];
      if (picked.length !== required) return;
    }

    const labelParts: string[] = [];
    for (const s of tool.series) {
      const picked = draft.selectedBySeries[s.id] ?? [];
      if (picked.length === 0) continue;
      const names = picked
        .map((id) => s.options.find((o) => o.id === id)?.name)
        .filter(Boolean)
        .join('、');
      labelParts.push(`${s.name}:${names}`);
    }
    const label = `${tool.name}（${scheme.name}） ${labelParts.join('；')}`;

    const key = `${toolId}:${scheme.id}:${tool.series
      .map((s) => `${s.id}:${(draft.selectedBySeries[s.id] ?? []).join('+')}`)
      .join('|')}`;
    setBundleCart((prev) => {
      const idx = prev.findIndex(
        (x) =>
          x.bundleToolId === toolId &&
          x.schemeId === scheme.id &&
          JSON.stringify(x.selectedOptionIdsBySeries) ===
            JSON.stringify(draft.selectedBySeries)
      );
      if (idx < 0) {
        return [
          ...prev,
          {
            bundleToolId: toolId,
            schemeId: scheme.id,
            selectedOptionIdsBySeries: draft.selectedBySeries,
            quantity: 1,
            unitPrice: effective.unit,
            isDiscount: effective.isDiscount,
            discountEndsAt: effective.discountEndsAt,
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
      [toolId]: {
        schemeId: prev[toolId]?.schemeId ?? '',
        selectedBySeries: {},
      },
    }));

    void key;
  };

  const handleSubmit = () => {
    if (!data || data.status !== 'open' || totalQty <= 0) return;
    if (isAppendMode && (!appendTarget || appendSubmitting)) return;
    const normalLines = activeProducts
      .map((p) => {
        const q = cart[p.id] ?? 0;
        if (q <= 0) return null;
        const { unit, isDiscount, discountEndsAt } = getEffectivePrice(p, now);
        return {
          productId: p.id,
          name: p.name,
          quantity: q,
          unitPrice: unit,
          isDiscount,
          discountEndsAt: discountEndsAt ?? undefined,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    const bundleLines = bundleCart.map((x, idx) => ({
      productId: `bundle:${x.bundleToolId}:${x.schemeId}:${idx}`,
      name: x.label,
      quantity: x.quantity,
      unitPrice: x.unitPrice,
      isDiscount: x.isDiscount ?? false,
      discountEndsAt: x.discountEndsAt,
    }));
    const lines = [...normalLines, ...bundleLines];
    if (isAppendMode && appendTarget) {
      setAppendSubmitting(true);
      void customerAppendLinesToOrder({
        orderFirestoreId: appendTarget.id,
        projectId: decodeURIComponent(projectId),
        orderNumber: appendTarget.data.orderNumber,
        customerKey: getOrCreateCustomerKey(),
        additionalLines: lines,
        bundleSelections: bundleCart,
      })
        .then(() => {
          navigate(
            `${basePath}/orders/${encodeURIComponent(appendTarget.data.orderNumber)}`,
            { replace: true }
          );
        })
        .catch((e) => {
          setAppendError(e instanceof Error ? e.message : '提交加购失败');
        })
        .finally(() => setAppendSubmitting(false));
      return;
    }
    navigate(`${basePath}/order`, {
      state: {
        lines,
        bundleSelections: bundleCart,
        projectTitle: data.projectTitle,
        cartDraft: cart,
      },
    });
  };

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center px-6 text-center text-sm text-gray-600">
        加载店铺与项目…
      </div>
    );
  }

  if (errorText) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-gray-800">{errorText}</p>
        <button
          type="button"
          className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-2 text-sm font-medium text-gray-900 active:bg-gray-100"
          onClick={() => window.location.reload()}
        >
          重试
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-svh items-center justify-center px-6 text-center text-sm text-gray-600">
        暂无数据
      </div>
    );
  }

  return (
    <div className="pb-36">
        <ShopHeader
          data={data}
          onShare={handleSharePage}
          onOpenMore={() => setMoreMenuOpen(true)}
        />

        <ShopProjectStatusCard data={data} now={now} />

        {hasProjectDescription ? (
          <>
            <hr className="h-px w-full border-0 bg-[#e5e7eb]" aria-hidden />
            <section className="px-4 pb-2.5 pt-3.5" aria-label="公告">
              <div className="rounded-[10px] border border-[#e5e7eb] bg-white px-3.5 py-3">
                <ShopContentBlocks
                  data={data}
                  embeddedInCard
                  dedupeTitleWithProject={data.projectTitle}
                />
              </div>
            </section>
          </>
        ) : null}

      {isAppendMode ? (
        <section className="px-4 pb-2 pt-1">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-900">
            <p className="font-semibold">
              加购模式 · 订单 #{appendTarget?.data.orderNumber ?? appendOrderNumber}
            </p>
            <p className="mt-0.5">
              本次提交将作为加购补单写回原订单，不会新建订单。
            </p>
            {appendError ? <p className="mt-1 text-red-700">{appendError}</p> : null}
          </div>
        </section>
      ) : null}

      <section className="px-4 pb-6 pt-1.5" aria-label="商品清单">
        <div className="mb-2 flex items-baseline justify-between px-0 pt-1">
          <h2 className="text-[15px] font-bold tracking-tight text-slate-900">商品清单</h2>
          <span className="text-[11px] text-slate-400">
            {useMock ? '演示数据' : '截单与库存以页面状态为准'}
          </span>
        </div>
        <div>
          {mixedItems.map((item) => {
            if (item.kind === 'product') {
              const p = item.product;
              return (
                <ProductCard
                  key={item.key}
                  product={p}
                  quantity={cart[p.id] ?? 0}
                  now={now}
                  themeColor={data.themeColor}
                  onInc={() => {
                    const cur = cart[p.id] ?? 0;
                    if (cur >= p.stock) return;
                    setQty(p.id, cur + 1);
                  }}
                  onDec={() => {
                    const cur = cart[p.id] ?? 0;
                    if (cur <= 0) return;
                    setQty(p.id, cur - 1);
                  }}
                />
              );
            }
            const tool = item.tool;
            const draft = bundleBuilder[tool.id] ?? { schemeId: '', selectedBySeries: {} };
            const scheme = getCurrentScheme(tool.id);
            const previewOptions = tool.series
              .flatMap((s) => s.options)
              .filter((o) => o.isActive && o.imageUrl);
            const activeSchemes = tool.schemes.filter((x) => x.isActive);
            const compactPreviewOptions = previewOptions.slice(0, 4);
            const hiddenPreviewCount = Math.max(
              0,
              previewOptions.length - compactPreviewOptions.length
            );
            return (
              <article key={item.key} className="py-3.5">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
                      <span className="shrink-0 text-[17px] font-semibold leading-tight text-slate-900">
                        {tool.name}
                      </span>
                      {activeSchemes.map((s) => {
                        const ep = getEffectiveSchemePrice(s, now);
                        const isEarlyBird = Boolean(ep.discountEndsAt);
                        return (
                          <span
                            key={s.id}
                            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[12px] text-slate-700"
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
                  </div>
                  <button
                    type="button"
                    className={
                      openBundleToolId === tool.id
                        ? 'shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700'
                        : 'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[22px] font-light leading-none text-white shadow-sm transition active:scale-95'
                    }
                    style={
                      openBundleToolId !== tool.id
                        ? { backgroundColor: data.themeColor }
                        : undefined
                    }
                    onClick={() =>
                      setOpenBundleToolId((prev) => (prev === tool.id ? null : tool.id))
                    }
                    aria-label={openBundleToolId === tool.id ? '折叠套餐' : '展开套餐'}
                  >
                    {openBundleToolId === tool.id ? '折叠' : '+'}
                  </button>
                </div>
                  {tool.description?.trim() ? (
                    <p className="mt-1 truncate text-[12px] leading-snug text-slate-500">
                      {tool.description.trim()}
                    </p>
                  ) : null}
                  {(() => {
                    const promoNotes: string[] = [];
                    let hasSpecial = false;
                    let earliestEarlyBird: Date | null = null;
                    for (const s of tool.schemes) {
                      if (!s.isActive) continue;
                      const ep = getEffectiveSchemePrice(s, now);
                      if (!ep.isDiscount) continue;
                      if (ep.discountEndsAt) {
                        const d = new Date(ep.discountEndsAt);
                        if (!earliestEarlyBird || d < earliestEarlyBird) {
                          earliestEarlyBird = d;
                        }
                      } else {
                        hasSpecial = true;
                      }
                    }
                    if (earliestEarlyBird) {
                      const left = formatRemainingShort(earliestEarlyBird.toISOString(), now);
                      const ts = earliestEarlyBird.toLocaleString('zh-CN', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false,
                      });
                      promoNotes.push(
                        left ? `早鸟截止 ${ts} · 还剩 ${left}` : `早鸟截止 ${ts}`
                      );
                    }
                    if (promoNotes.length === 0 && hasSpecial) {
                      promoNotes.push('部分方案特惠进行中');
                    }
                    const bundlePromoEl =
                      promoNotes.length > 0 ? (
                        <p
                          className={`text-[11px] font-medium leading-none ${
                            earliestEarlyBird ? 'text-amber-700' : 'text-rose-600'
                          }`}
                        >
                          {promoNotes.join(' · ')}
                        </p>
                      ) : null;

                    const offIso = tool.scheduledOffAt;
                    const scheduleRemaining =
                      offIso && new Date(offIso).getTime() > now.getTime()
                        ? formatRemainingShort(offIso, now)
                        : null;
                    const scheduleEndShort =
                      scheduleRemaining && offIso
                        ? new Date(offIso).toLocaleString('zh-CN', {
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: false,
                          })
                        : null;
                    const bundleScheduleEl =
                      scheduleRemaining && scheduleEndShort ? (
                        <p className="text-[11px] leading-none text-amber-700">
                          下架截止 {scheduleEndShort} · 还剩 {scheduleRemaining}
                        </p>
                      ) : null;

                    if (!bundlePromoEl && !bundleScheduleEl) return null;
                    return (
                      <div className="mt-1 flex flex-col gap-0.5">
                        {bundlePromoEl}
                        {bundleScheduleEl}
                      </div>
                    );
                  })()}
                  {previewOptions.length > 0 ? (
                    <div
                      className={`${
                        openBundleToolId === tool.id
                          ? 'mt-3 grid grid-cols-3 gap-2'
                          : 'mt-2 grid grid-cols-4 gap-1.5'
                      }`}
                    >
                      {(openBundleToolId === tool.id ? previewOptions : compactPreviewOptions).map(
                        (o, idx) => {
                        const oSoldOut = o.stock <= 0;
                        const isLast =
                          idx ===
                          (openBundleToolId === tool.id
                            ? previewOptions.length - 1
                            : compactPreviewOptions.length - 1);
                        const showMoreOnThisTile =
                          openBundleToolId !== tool.id && isLast && hiddenPreviewCount > 0;
                        return (
                          <div key={o.id} className="flex flex-col gap-1">
                            <button
                              type="button"
                              className={`relative aspect-square overflow-hidden bg-slate-50 ring-1 ring-slate-100 ${
                                openBundleToolId === tool.id ? 'rounded-2xl' : 'rounded-xl'
                              }`}
                              onClick={() =>
                                setBundleImagePreview({ url: o.imageUrl as string, name: o.name })
                              }
                              aria-label="查看大图"
                            >
                              <img
                                src={o.imageUrl}
                                alt=""
                                loading="lazy"
                                className={`h-full w-full object-cover ${oSoldOut ? 'opacity-60' : ''}`}
                              />
                              {oSoldOut ? (
                                <span className="absolute inset-x-0 bottom-0 bg-slate-900/70 py-0.5 text-center text-[11px] font-medium text-white">
                                  已售罄
                                </span>
                              ) : null}
                              {showMoreOnThisTile ? (
                                <span className="absolute right-1 top-1 rounded-full bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                                  +{hiddenPreviewCount}
                                </span>
                              ) : null}
                            </button>
                            <div
                              className={`truncate px-0.5 text-center font-medium text-slate-700 ${
                                openBundleToolId === tool.id ? 'text-[12px]' : 'text-[10px]'
                              }`}
                            >
                              {o.name}
                            </div>
                          </div>
                        );
                      }
                      )}
                    </div>
                  ) : null}
                  {openBundleToolId === tool.id ? (
                    <div className="mt-3">
                      <div className="border-y border-dashed border-slate-200 py-3">
                        <div className="mb-2 text-[12px] font-medium text-slate-700">
                          选择一个组合
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {tool.schemes
                            .filter((x) => x.isActive)
                            .map((s) => {
                              const ep = getEffectiveSchemePrice(s, now);
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
                                      selectedBySeries: prev[tool.id]?.selectedBySeries ?? {},
                                    },
                                  }))
                                }
                              >
                                <span>{s.name}</span>
                                {ep.isDiscount ? (
                                  <span className={`text-[11px] line-through ${selectedScheme ? 'opacity-70' : 'opacity-60'}`}>
                                    RM {s.price.toFixed(2)}
                                  </span>
                                ) : null}
                                <span>RM {ep.unit.toFixed(2)}</span>
                                {ep.isDiscount ? (
                                  <span
                                    className={`inline-flex items-center gap-1 text-[11px] leading-none ${
                                      isEarlyBird
                                        ? 'text-amber-800'
                                        : 'rounded-md bg-rose-200 px-1.5 py-0.5 font-semibold text-rose-800'
                                    }`}
                                  >
                                    <span
                                      className={
                                        isEarlyBird
                                          ? 'rounded-md bg-amber-200 px-1.5 py-0.5 font-semibold text-amber-900'
                                          : ''
                                      }
                                    >
                                      {isEarlyBird ? '早鸟价' : '特惠'}
                                    </span>
                                    {isEarlyBird && ep.discountEndsAt ? (
                                      <span className="font-medium text-amber-700">
                                        截止 {new Date(ep.discountEndsAt).toLocaleString('zh-CN', {
                                          month: '2-digit',
                                          day: '2-digit',
                                          hour: '2-digit',
                                          minute: '2-digit',
                                          hour12: false,
                                        })}
                                      </span>
                                    ) : null}
                                  </span>
                                ) : null}
                              </button>
                            );})}
                        </div>
                        {(() => {
                          if (!scheme) return null;
                          const ep = getEffectiveSchemePrice(scheme, now);
                          if (!ep.isDiscount) return null;
                          const isEarlyBird = Boolean(ep.discountEndsAt);
                          if (isEarlyBird && ep.discountEndsAt) {
                            const ts = new Date(ep.discountEndsAt).toLocaleString('zh-CN', {
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                              hour12: false,
                            });
                            const left = formatRemainingShort(ep.discountEndsAt, now);
                            return (
                              <p className="mt-2 text-[11px] font-medium leading-none text-amber-700">
                                {left ? `早鸟截止 ${ts} · 还剩 ${left}` : `早鸟截止 ${ts}`}
                              </p>
                            );
                          }
                          return (
                            <p className="mt-2 text-[11px] font-medium leading-none text-rose-600">
                              特惠进行中
                            </p>
                          );
                        })()}
                      </div>
                      {scheme ? (
                        <div className="space-y-3 pt-3">
                          {tool.series.map((series, sIdx) => {
                            const required = getSeriesRequiredCount(
                              scheme.requirements,
                              series
                            );
                            if (required <= 0) return null;
                            const selected = draft.selectedBySeries[series.id] ?? [];
                            const filled = selected.length === required;
                            return (
                              <div
                                key={series.id}
                                className={
                                  sIdx === 0
                                    ? ''
                                    : 'border-t border-dashed border-slate-200 pt-3'
                                }
                              >
                                <div className="mb-1.5 flex items-baseline justify-between">
                                  <span className="text-[13px] font-medium text-slate-800">
                                    {series.name}
                                  </span>
                                  <span
                                    className={`text-[11px] ${
                                      filled ? 'text-emerald-600' : 'text-slate-500'
                                    }`}
                                  >
                                    请选 {required} 项（已选 {selected.length}）
                                  </span>
                                </div>
                                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                  {series.options
                                    .filter((o) => o.isActive)
                                    .map((opt) => {
                                      const checked = selected.includes(opt.id);
                                      const soldOut = opt.stock <= 0;
                                      const lowStock = !soldOut && opt.stock <= 5;
                                      const baseClass = soldOut
                                        ? 'cursor-not-allowed bg-slate-50 text-slate-400 ring-1 ring-slate-200'
                                        : checked
                                          ? 'bg-white text-slate-900 ring-2 ring-offset-0 shadow-sm'
                                          : 'bg-white text-slate-800 ring-1 ring-slate-200';
                                      const ringStyle = checked && !soldOut
                                        ? { boxShadow: `0 0 0 2px ${data.themeColor}` }
                                        : undefined;
                                      return (
                                        <button
                                          key={opt.id}
                                          type="button"
                                          disabled={soldOut}
                                          className={`relative flex h-full flex-col gap-1 rounded-2xl px-3 py-2.5 text-left transition active:scale-[0.99] ${baseClass}`}
                                          style={ringStyle}
                                          onClick={() => toggleBundleOption(tool.id, series.id, opt.id)}
                                        >
                                          {checked && !soldOut ? (
                                            <span
                                              className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-[12px] font-bold leading-none text-white"
                                              style={{ backgroundColor: data.themeColor }}
                                            >
                                              ✓
                                            </span>
                                          ) : null}
                                          <div className="truncate pr-5 text-[13px] font-semibold leading-tight">
                                            {opt.name}
                                          </div>
                                          {opt.note ? (
                                            <div className="line-clamp-2 text-[11px] leading-snug text-slate-500">
                                              {opt.note}
                                            </div>
                                          ) : null}
                                          <span
                                            className={`mt-auto inline-block w-fit rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-none ${
                                              soldOut
                                                ? 'bg-slate-100 text-slate-500'
                                                : lowStock
                                                  ? 'bg-orange-50 text-orange-700'
                                                  : 'bg-emerald-50 text-emerald-700'
                                            }`}
                                          >
                                            {soldOut ? '已售罄' : `余 ${opt.stock}`}
                                          </span>
                                        </button>
                                      );
                                    })}
                                </div>
                              </div>
                            );
                          })}
                          <div className="border-t border-dashed border-slate-200 pt-3">
                            <button
                              type="button"
                              className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:bg-gray-300"
                              disabled={tool.series.some((series) => {
                                const required = getSeriesRequiredCount(
                                  scheme.requirements,
                                  series
                                );
                                if (required <= 0) return false;
                                const selected = draft.selectedBySeries[series.id] ?? [];
                                return selected.length !== required;
                              })}
                              onClick={() => addBundleToCart(tool.id)}
                            >
                              加入套餐
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="pt-3 text-xs text-gray-500">请先选择套餐方案（价格）</p>
                      )}
                    </div>
                  ) : null}
              </article>
            );
          })}
        </div>
        {bundleCart.length > 0 ? (
          <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50 p-3">
            <div className="mb-1 text-xs font-semibold text-emerald-900">已选套餐</div>
            <div className="space-y-1">
              {bundleCart.map((x, idx) => (
                <div key={`${x.bundleToolId}-${idx}`} className="flex items-center justify-between text-xs">
                  <span className="truncate pr-2 text-emerald-900">{x.label}</span>
                  <span className="shrink-0 text-emerald-900">
                    x{x.quantity} · RM {(x.quantity * x.unitPrice).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      {bundleImagePreview ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setBundleImagePreview(null)}
        >
          <div
            className="relative max-h-[90vh] max-w-[90vw]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="absolute -right-2 -top-2 h-8 w-8 rounded-full bg-white text-lg leading-none text-gray-800 shadow"
              onClick={() => setBundleImagePreview(null)}
              aria-label="关闭预览"
            >
              ×
            </button>
            <img
              src={bundleImagePreview.url}
              alt={bundleImagePreview.name ?? ''}
              className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
            />
          </div>
        </div>
      ) : null}

      <ShopBottomBar
        shopSlug={shopSlug}
        projectId={projectId}
        themeColor={data.themeColor}
        projectStatus={data.status}
        totalQty={totalQty}
        totalAmount={totalAmount}
        onSubmit={handleSubmit}
        variant="dual"
        submitLabelOverride={
          isAppendMode
            ? appendSubmitting
              ? '提交加购中…'
              : totalQty > 0
                ? `确认加购 · ${totalQty} 件 · ${formatMYR(totalAmount)}`
                : '请选择加购商品'
            : undefined
        }
        forceDisableSubmit={
          isAppendMode && (!!appendError || !appendTarget || appendSubmitting)
        }
        showMyOrdersPrimary={bottomBarMenu.showMyOrdersPrimary}
        showMyOrdersInMore={bottomBarMenu.showMyOrdersInMore}
        isShopOwner={bottomBarMenu.isShopOwner}
        invitedRole={bottomBarMenu.invitedRole}
      />

      <ShopMoreMenuSheet
        open={moreMenuOpen}
        onClose={() => setMoreMenuOpen(false)}
        shopSlug={shopSlug}
        projectId={projectId}
        showMyOrdersInMore={bottomBarMenu.showMyOrdersInMore}
        isShopOwner={bottomBarMenu.isShopOwner}
        invitedRole={bottomBarMenu.invitedRole}
        copied={menuCopied}
        onCopyLink={handleCopyMenuLink}
        showCardsEntry={hasShopCards}
      />
    </div>
  );
}
