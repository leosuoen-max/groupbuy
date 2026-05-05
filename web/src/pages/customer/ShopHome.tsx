import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ShopHeader } from '../../components/customer/ShopHeader';
import { ShopContentBlocks } from '../../components/customer/ShopContentBlocks';
import { ProductCard } from '../../components/customer/ProductCard';
import { ShopBottomBar } from '../../components/customer/ShopBottomBar';
import {
  getMockShopHome,
  type MockShopHome,
} from '../../data/mockShopHome';
import { getEffectivePrice } from '../../lib/productPrice';
import {
  loadShopHomeFromFirestore,
  shopHomeErrorMessage,
} from '../../lib/shopHomeService';
import { toLoadErrorMessage } from '../../lib/firebaseErrorMessage';
import { useAuthUser } from '../../hooks/useAuthUser';
import { listOrdersByCustomer } from '../../lib/orderService';
import { getProjectPermissionForUser } from '../../lib/permissionService';
import { getShopBySlug } from '../../lib/shopService';
import { getOrCreateCustomerKey } from '../../lib/customerIdentity';
import type { CartLocationState } from '../../types/orderDraft';

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
    queueMicrotask(() => {
      setRemote((s) => ({ ...s, loading: true, error: undefined }));
      void loadShopHomeFromFirestore(shopSlug, projectId, now)
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
  }, [useMock, shopSlug, projectId, now]);

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

  const activeProducts = useMemo(
    () => (data ? data.products.filter((p) => p.isActive) : []),
    [data]
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
    return { totalQty: qty, totalAmount: amount };
  }, [activeProducts, cart, now]);

  const basePath = `/shop/${encodeURIComponent(shopSlug)}/${encodeURIComponent(projectId)}`;

  const handleSubmit = () => {
    if (!data || data.status !== 'open' || totalQty <= 0) return;
    const lines = activeProducts
      .map((p) => {
        const q = cart[p.id] ?? 0;
        if (q <= 0) return null;
        const { unit, isDiscount } = getEffectivePrice(p, now);
        return {
          productId: p.id,
          name: p.name,
          quantity: q,
          unitPrice: unit,
          isDiscount,
        };
      })
      .filter(Boolean);
    navigate(`${basePath}/order`, {
      state: { lines, projectTitle: data.projectTitle, cartDraft: cart },
    });
  };

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-white px-6 text-center text-sm text-gray-600">
        加载店铺与项目…
      </div>
    );
  }

  if (errorText) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-3 bg-white px-6 text-center">
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
      <div className="flex min-h-svh items-center justify-center bg-white px-6 text-center text-sm text-gray-600">
        暂无数据
      </div>
    );
  }

  return (
    <div className="min-h-svh bg-white pb-36">
      <ShopHeader data={data} now={now} />

      <ShopContentBlocks data={data} />

      <section className="px-4 pb-2">
        <h2 className="mb-1 text-sm font-semibold text-gray-900">商品清单</h2>
        <p className="mb-3 text-xs text-gray-500">
          {useMock
            ? '当前为演示数据（?mock=1）。'
            : '数据来自已发布项目；截单与库存以页面状态为准。'}
        </p>
        <div className="divide-y divide-gray-100 rounded-2xl border border-gray-100 px-3">
          {activeProducts.map((p) => (
            <ProductCard
              key={p.id}
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
          ))}
        </div>
      </section>

      <ShopBottomBar
        shopSlug={shopSlug}
        projectId={projectId}
        themeColor={data.themeColor}
        projectStatus={data.status}
        totalQty={totalQty}
        totalAmount={totalAmount}
        onSubmit={handleSubmit}
        showMyOrdersPrimary={bottomBarMenu.showMyOrdersPrimary}
        showMyOrdersInMore={bottomBarMenu.showMyOrdersInMore}
        isShopOwner={bottomBarMenu.isShopOwner}
        invitedRole={bottomBarMenu.invitedRole}
      />
    </div>
  );
}
