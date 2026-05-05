import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ProductCard } from '../../components/customer/ProductCard';
import { PageShell } from '../../components/PageShell';
import { toLoadErrorMessage } from '../../lib/firebaseErrorMessage';
import { formatMYR } from '../../lib/formatMYR';
import { getOrCreateCustomerKey } from '../../lib/customerIdentity';
import {
  customerAppendLinesToOrder,
  getOrderByNumber,
  type OrderRow,
} from '../../lib/orderService';
import { getEffectivePrice } from '../../lib/productPrice';
import { loadShopHomeFromFirestore } from '../../lib/shopHomeService';
import type { MockShopHome } from '../../data/mockShopHome';
import type { OrderLine } from '../../types/orderDraft';

function useTick(ms: number) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

export default function OrderAppend() {
  const { shopSlug = '', projectId = '', orderId = '' } = useParams<{
    shopSlug: string;
    projectId: string;
    orderId: string;
  }>();
  const navigate = useNavigate();
  const base = `/shop/${encodeURIComponent(shopSlug)}/${encodeURIComponent(projectId)}`;
  const orderNumber = decodeURIComponent(orderId);
  const now = useTick(30_000);

  const [bootErr, setBootErr] = useState<string | null>(null);
  const [homeData, setHomeData] = useState<MockShopHome | null>(null);
  const [orderRow, setOrderRow] = useState<OrderRow | null>(null);
  const [booting, setBooting] = useState(true);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBootErr(null);
    setBooting(true);
    try {
      const home = await loadShopHomeFromFirestore(
        decodeURIComponent(shopSlug),
        decodeURIComponent(projectId)
      );
      if (!home.ok) {
        setBootErr(
          home.code === 'PROJECT_DRAFT'
            ? '该项目尚未发布，无法加菜。'
            : '无法加载项目（请检查链接或是否已截单）。'
        );
        setHomeData(null);
        setOrderRow(null);
        return;
      }
      const row = await getOrderByNumber(
        decodeURIComponent(projectId),
        orderNumber
      );
      if (!row || row.data.shopSlug !== shopSlug) {
        setBootErr('找不到订单或店铺不匹配。');
        setOrderRow(null);
        setHomeData(null);
        return;
      }
      const key = getOrCreateCustomerKey();
      if (row.data.customerKey !== key) {
        setBootErr('仅下单本人可加菜（请使用同一浏览器）。');
        setOrderRow(null);
        setHomeData(null);
        return;
      }
      setHomeData(home.data);
      setOrderRow(row);
    } catch (e) {
      setBootErr(toLoadErrorMessage(e, '加载失败，请重试。'));
      setHomeData(null);
      setOrderRow(null);
    } finally {
      setBooting(false);
    }
  }, [orderNumber, projectId, shopSlug]);

  useEffect(() => {
    queueMicrotask(() => {
      void refresh();
    });
  }, [refresh]);

  const activeProducts = useMemo(
    () => homeData?.products.filter((p) => p.isActive && p.stock > 0) ?? [],
    [homeData]
  );

  const { totalQty, addAmount } = useMemo(() => {
    let qty = 0;
    let amount = 0;
    for (const p of activeProducts) {
      const q = cart[p.id] ?? 0;
      if (q <= 0) continue;
      const { unit } = getEffectivePrice(p, now);
      qty += q;
      amount += unit * q;
    }
    return { totalQty: qty, addAmount: amount };
  }, [activeProducts, cart, now]);

  const setQty = (productId: string, q: number) => {
    setCart((prev) => ({ ...prev, [productId]: q }));
  };

  const handleSubmit = async () => {
    if (!orderRow || !homeData || totalQty <= 0 || submitting) return;
    setSubmitErr(null);
    const lines: OrderLine[] = [];
    for (const p of activeProducts) {
      const q = cart[p.id] ?? 0;
      if (q <= 0) continue;
      const { unit, isDiscount } = getEffectivePrice(p, now);
      if (q > p.stock) {
        setSubmitErr(`${p.name} 库存不足`);
        return;
      }
      lines.push({
        productId: p.id,
        name: p.name,
        quantity: q,
        unitPrice: unit,
        isDiscount,
      });
    }
    if (!lines.length) return;
    setSubmitting(true);
    try {
      await customerAppendLinesToOrder({
        orderFirestoreId: orderRow.id,
        projectId: decodeURIComponent(projectId),
        orderNumber: orderRow.data.orderNumber,
        customerKey: getOrCreateCustomerKey(),
        additionalLines: lines,
      });
      navigate(`${base}/orders/${encodeURIComponent(orderNumber)}`, {
        replace: true,
      });
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (booting) {
    return (
      <PageShell title="加菜" subtitle="加载中…">
        <p className="text-sm text-gray-600">请稍候…</p>
      </PageShell>
    );
  }

  if (bootErr || !homeData || !orderRow) {
    return (
      <PageShell title="加菜" subtitle="无法打开">
        <p className="text-sm text-red-700">{bootErr ?? '未知错误'}</p>
        <Link
          className="mt-4 inline-block text-indigo-600 underline-offset-2 hover:underline"
          to={base}
        >
          返回项目首页
        </Link>
      </PageShell>
    );
  }

  const o = orderRow.data;
  const canAppend =
    o.status === 'unpaid' ||
    o.status === 'pending' ||
    o.status === 'confirmed' ||
    o.status === 'partial_paid';

  if (!canAppend) {
    return (
      <PageShell title="加菜" subtitle="不可操作">
        <p className="text-sm text-gray-700">当前订单状态不可加菜。</p>
        <Link
          className="mt-4 inline-block text-indigo-600 underline-offset-2 hover:underline"
          to={`${base}/orders/${encodeURIComponent(orderNumber)}`}
        >
          返回订单详情
        </Link>
      </PageShell>
    );
  }

  return (
    <PageShell title="加菜补单" subtitle={`订单 #${o.orderNumber}`}>
      <p className="mb-3 text-xs leading-relaxed text-gray-600">
        以下为<strong>本次加购</strong>；提交后会更新原订单与应付。若当前待确认加购尚未上传付款截图，本次会与其合并为同一档；若已上传，则成为新一档待确认。仅可增加数量，不能在线减菜（需减请取消整单重下或联系商户）。
      </p>

      <div className="mb-4 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-700">
        <p className="font-medium text-gray-900">当前订单原明细（节选）</p>
        <ul className="mt-1 space-y-0.5">
          {o.lines.slice(0, 5).map((l, i) => (
            <li key={`${l.productId}-${i}`}>
              {l.name} ×{l.quantity} · {formatMYR(l.subtotal)}
            </li>
          ))}
          {o.lines.length > 5 ? (
            <li className="text-gray-500">…共 {o.lines.length} 行</li>
          ) : null}
        </ul>
        <p className="mt-2">
          当前应付合计 <strong>{formatMYR(o.totalAmount)}</strong>
          {o.pendingAmount > 0 ? (
            <>
              ，其中待付 <strong>{formatMYR(o.pendingAmount)}</strong>
            </>
          ) : null}
        </p>
      </div>

      <h2 className="mb-2 text-sm font-semibold text-gray-900">选择加购商品</h2>
      <div className="divide-y divide-gray-100 rounded-2xl border border-gray-100 px-3">
        {activeProducts.map((p) => (
          <ProductCard
            key={p.id}
            product={p}
            quantity={cart[p.id] ?? 0}
            now={now}
            themeColor={homeData.themeColor}
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

      {submitErr ? (
        <p className="mt-3 text-sm text-red-600">{submitErr}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
        <div className="text-sm text-gray-800">
          本次加购：<span className="font-semibold">{formatMYR(addAmount)}</span>
          {totalQty > 0 ? (
            <span className="text-gray-500">（{totalQty} 件）</span>
          ) : null}
        </div>
        <button
          type="button"
          disabled={totalQty <= 0 || submitting}
          onClick={() => void handleSubmit()}
          className="inline-flex h-11 min-w-[8rem] items-center justify-center rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white disabled:bg-gray-300"
        >
          {submitting ? '提交中…' : '确认加菜'}
        </button>
      </div>

      <div className="mt-6">
        <Link
          className="text-sm text-indigo-600 underline-offset-2 hover:underline"
          to={`${base}/orders/${encodeURIComponent(orderNumber)}`}
        >
          ← 返回订单详情
        </Link>
      </div>
    </PageShell>
  );
}
