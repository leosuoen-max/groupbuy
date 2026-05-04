import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ShopHeader } from '../../components/customer/ShopHeader';
import { ShopContentBlocks } from '../../components/customer/ShopContentBlocks';
import { ProductCard } from '../../components/customer/ProductCard';
import { ShopBottomBar } from '../../components/customer/ShopBottomBar';
import { getMockShopHome } from '../../data/mockShopHome';
import { getEffectivePrice } from '../../lib/productPrice';

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
  const navigate = useNavigate();
  const now = useTick(30_000);

  const data = useMemo(
    () => getMockShopHome(shopSlug, projectId),
    [shopSlug, projectId]
  );

  const [cart, setCart] = useState<Record<string, number>>({});

  const activeProducts = useMemo(
    () => data.products.filter((p) => p.isActive),
    [data.products]
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
    if (data.status !== 'open' || totalQty <= 0) return;
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
    navigate(`${basePath}/order`, { state: { lines } });
  };

  return (
    <div className="min-h-svh bg-white pb-36">
      <ShopHeader data={data} now={now} />

      <ShopContentBlocks data={data} />

      <section className="px-4 pb-2">
        <h2 className="mb-1 text-sm font-semibold text-gray-900">商品清单</h2>
        <p className="mb-3 text-xs text-gray-500">以下为 mock 数据，后续接 Firestore。</p>
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
      />
    </div>
  );
}
