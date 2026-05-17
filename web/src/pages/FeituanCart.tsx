import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FeituanHomeBottomNav } from '../components/feituan/FeituanHomeBottomNav';
import {
  notifyFeituanCartUpdated,
  useFeituanCartCount,
} from '../hooks/useFeituanCartCount';
import {
  buildLinesFromCartDraft,
  rebuildBundleSelectionsPrices,
  validateProjectRowForCart,
} from '../lib/feituanCartLines';
import {
  getFeituanCart,
  removeFeituanCartProject,
  setFeituanCart,
  updateFeituanCartProject,
} from '../lib/feituanCartStorage';
import { formatMYR } from '../lib/formatMYR';
import { FEITUAN_HOME } from '../lib/feituanHomeTheme';
import { formatEstimatedDeliveryHint, isProjectRecurring } from '../lib/recurringDeliverySchedule';
import { getProject } from '../lib/projectService';
import type { FeituanCart, FeituanCartProject } from '../types/feituanCart';
import type { ProjectDoc } from '../types/firestore';

type LoadedItem = {
  cart: FeituanCartProject;
  project: ProjectDoc | null;
  validation: ReturnType<typeof validateProjectRowForCart>;
  lines: FeituanCartProject['lines'];
  subtotal: number;
};

export default function FeituanCart() {
  const navigate = useNavigate();
  const cartCount = useFeituanCartCount();
  const [cart, setCart] = useState<FeituanCart>(() => getFeituanCart());
  const [items, setItems] = useState<LoadedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    const c = getFeituanCart();
    setCart(c);
    const loaded: LoadedItem[] = [];
    const now = new Date();
    for (const entry of c.projects) {
      const row = await getProject(entry.projectId);
      if (!row) {
        loaded.push({
          cart: entry,
          project: null,
          validation: { ok: false, reason: 'closed', message: '项目不存在' },
          lines: entry.lines,
          subtotal: 0,
        });
        continue;
      }
      const bundleSelections = rebuildBundleSelectionsPrices(
        row.data,
        entry.bundleSelections,
        now
      );
      const built = buildLinesFromCartDraft(
        row.data,
        entry.cartDraft,
        bundleSelections,
        now
      );
      const validation = validateProjectRowForCart(
        row,
        built.lines,
        built.bundleSelections,
        now
      );
      if (validation.ok) {
        updateFeituanCartProject(entry.projectId, {
          lines: built.lines,
          bundleSelections: built.bundleSelections,
          subtotal: built.subtotal,
        });
      }
      loaded.push({
        cart: {
          ...entry,
          lines: built.lines,
          bundleSelections: built.bundleSelections,
          subtotal: built.subtotal,
        },
        project: row.data,
        validation,
        lines: built.lines,
        subtotal: built.subtotal,
      });
    }
    setFeituanCart(getFeituanCart());
    setItems(loaded);
    setLoading(false);
    notifyFeituanCartUpdated();
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, cartCount]);

  const payableTotal = useMemo(
    () =>
      items
        .filter((x) => x.validation.ok)
        .reduce((s, x) => s + x.subtotal, 0),
    [items]
  );

  const payableCount = items.filter((x) => x.validation.ok).length;

  const setProductQty = (projectId: string, productId: string, nextQty: number) => {
    const entry = cart.projects.find((p) => p.projectId === projectId);
    if (!entry) return;
    const draft = { ...entry.cartDraft };
    if (nextQty <= 0) delete draft[productId];
    else draft[productId] = nextQty;
    const hasLines = Object.values(draft).some((q) => q > 0) || entry.bundleSelections.length > 0;
    if (!hasLines) {
      removeFeituanCartProject(projectId);
      notifyFeituanCartUpdated();
      void reload();
      return;
    }
    updateFeituanCartProject(projectId, { cartDraft: draft });
    notifyFeituanCartUpdated();
    void reload();
  };

  const removeItem = (projectId: string) => {
    removeFeituanCartProject(projectId);
    notifyFeituanCartUpdated();
    void reload();
  };

  return (
    <div className="min-h-svh bg-[#f6f7f8] pb-28">
      <header
        className="sticky top-0 z-30 border-b bg-white/95 px-4 py-3 backdrop-blur"
        style={{ borderColor: FEITUAN_HOME.primaryBorder }}
      >
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <Link to="/feituan" className="text-sm font-medium" style={{ color: FEITUAN_HOME.primary }}>
            ← 饭团
          </Link>
          <h1 className="flex-1 text-center text-base font-bold text-gray-900">
            饭团购物车 ({cart.projects.length})
          </h1>
          <span className="w-10" />
        </div>
      </header>

      <main className="mx-auto max-w-xl space-y-3 px-4 py-4">
        {msg ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{msg}</p>
        ) : null}
        {loading ? (
          <p className="text-sm text-gray-600">正在校验商品与库存…</p>
        ) : cart.projects.length === 0 ? (
          <div className="rounded-xl border bg-white p-6 text-center text-sm text-gray-600">
            <p>购物车是空的</p>
            <Link
              to="/feituan"
              className="mt-3 inline-block font-semibold"
              style={{ color: FEITUAN_HOME.primary }}
            >
              去饭团逛逛
            </Link>
          </div>
        ) : (
          items.map((item) => (
            <article
              key={item.cart.projectId}
              className={`rounded-xl border bg-white p-3 shadow-sm ${
                item.validation.ok ? 'border-gray-100' : 'border-red-200 bg-red-50/40'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="truncate font-semibold text-gray-900">
                    {item.cart.projectTitle}
                  </h2>
                  <p className="text-xs text-gray-500">{item.cart.shopName}</p>
                  {item.project && isProjectRecurring(item.project) ? (
                    <p className="mt-1 text-xs text-emerald-800">
                      {formatEstimatedDeliveryHint(item.project)}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="shrink-0 text-xs text-red-600"
                  onClick={() => removeItem(item.cart.projectId)}
                >
                  删除
                </button>
              </div>
              {!item.validation.ok ? (
                <p className="mt-2 text-xs font-medium text-red-700">{item.validation.message}</p>
              ) : null}
              <ul className="mt-2 space-y-2 text-sm">
                {item.lines
                  .filter((l) => !l.productId.startsWith('bundle:'))
                  .map((line) => (
                    <li
                      key={line.productId}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="min-w-0 flex-1 truncate">{line.name}</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="h-7 w-7 rounded-full border text-gray-700"
                          disabled={!item.validation.ok}
                          onClick={() =>
                            setProductQty(
                              item.cart.projectId,
                              line.productId,
                              line.quantity - 1
                            )
                          }
                        >
                          −
                        </button>
                        <span className="w-6 text-center tabular-nums">{line.quantity}</span>
                        <button
                          type="button"
                          className="h-7 w-7 rounded-full border text-gray-700"
                          disabled={!item.validation.ok}
                          onClick={() =>
                            setProductQty(
                              item.cart.projectId,
                              line.productId,
                              line.quantity + 1
                            )
                          }
                        >
                          +
                        </button>
                        <span className="w-16 text-right tabular-nums">
                          {formatMYR(line.quantity * line.unitPrice)}
                        </span>
                      </div>
                    </li>
                  ))}
                {item.lines
                  .filter((l) => l.productId.startsWith('bundle:'))
                  .map((line, idx) => (
                    <li key={`${line.productId}-${idx}`} className="flex justify-between gap-2">
                      <span className="min-w-0 flex-1 text-xs leading-snug">{line.name}</span>
                      <span className="shrink-0 tabular-nums">
                        x{line.quantity} · {formatMYR(line.quantity * line.unitPrice)}
                      </span>
                    </li>
                  ))}
              </ul>
              <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2">
                <Link
                  to={`/feituan/projects/${encodeURIComponent(item.cart.projectId)}`}
                  className="text-xs font-medium text-emerald-700 underline-offset-2 hover:underline"
                >
                  去项目页加购/改套餐
                </Link>
                <span className="font-semibold tabular-nums text-gray-900">
                  {formatMYR(item.subtotal)}
                </span>
              </div>
            </article>
          ))
        )}
      </main>

      {cart.projects.length > 0 ? (
        <div
          className="fixed inset-x-0 bottom-0 z-30 border-t bg-white pb-[calc(10px+env(safe-area-inset-bottom))] pt-3"
          style={{ borderColor: FEITUAN_HOME.primaryBorder }}
        >
          <div className="mx-auto flex max-w-xl items-center gap-3 px-4">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-gray-500">
                可结算 {payableCount} 个项目
              </p>
              <p className="text-lg font-bold tabular-nums text-gray-900">
                {formatMYR(payableTotal)}
              </p>
            </div>
            <button
              type="button"
              disabled={payableCount === 0}
              className="rounded-full px-5 py-3 text-sm font-semibold text-white disabled:bg-gray-300"
              style={
                payableCount > 0
                  ? { backgroundColor: FEITUAN_HOME.primary }
                  : undefined
              }
              onClick={() => {
                if (payableCount === 0) {
                  setMsg('没有可结算的项目，请移除已截止项或回项目页修改');
                  return;
                }
                navigate('/feituan/cart-checkout');
              }}
            >
              去结算
            </button>
          </div>
        </div>
      ) : null}

      <FeituanHomeBottomNav />
    </div>
  );
}
