import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ProjectStatus } from '../../data/mockShopHome';
import { formatMYR } from '../../lib/formatMYR';

type ShopBottomBarProps = {
  shopSlug: string;
  projectId: string;
  themeColor: string;
  projectStatus: ProjectStatus;
  totalQty: number;
  totalAmount: number;
  onSubmit: () => void;
};

export function ShopBottomBar({
  shopSlug,
  projectId,
  themeColor,
  projectStatus,
  totalQty,
  totalAmount,
  onSubmit,
}: ShopBottomBarProps) {
  const base = '/shop/' + encodeURIComponent(shopSlug) + '/' + encodeURIComponent(projectId);
  const closed = projectStatus === 'closed' || projectStatus === 'full';
  const canSubmit = !closed && totalQty > 0;
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  let primaryLabel = '请先选择商品';
  if (closed) primaryLabel = '已截止';
  else if (totalQty > 0) {
    primaryLabel = `点此提交 · ${totalQty} 件 · ${formatMYR(totalAmount)}`;
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1300);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))]">
      <div className="pointer-events-auto w-full max-w-lg px-3">
        <div className="rounded-2xl border border-gray-200 bg-white/95 p-3 shadow-lg backdrop-blur">
          <div className="flex gap-2">
            <Link
              to={`${base}/my-orders`}
              className="flex h-12 flex-[1.05] items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-sm font-medium text-gray-800 active:bg-gray-100"
            >
              我的订单
            </Link>
            <button
              type="button"
              className="flex h-12 min-w-[3.25rem] items-center justify-center rounded-xl border border-gray-200 bg-white text-sm font-semibold text-gray-800 active:bg-gray-50"
              onClick={() => setMenuOpen(true)}
              aria-label="更多"
            >
              更多
            </button>
            <button
              type="button"
              className="flex h-12 flex-[1.25] items-center justify-center rounded-xl px-2 text-sm font-semibold text-white disabled:bg-gray-300 disabled:text-gray-100"
              style={{ backgroundColor: canSubmit ? themeColor : undefined }}
              disabled={!canSubmit}
              onClick={onSubmit}
            >
              {primaryLabel}
            </button>
          </div>
          <Link
            to="/register"
            className="mt-2 block text-center text-xs text-gray-500 underline-offset-2 hover:underline"
          >
            想拥有自己的店？立即免费创建 →
          </Link>
        </div>
      </div>

      {menuOpen ? (
        <div className="pointer-events-auto fixed inset-0 z-30 bg-black/25">
          <button
            type="button"
            className="absolute inset-0 h-full w-full"
            aria-label="关闭更多菜单"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-lg rounded-t-2xl bg-white p-4 shadow-2xl">
            <div className="mb-2 text-center text-sm font-semibold text-gray-900">
              更多
            </div>
            <div className="space-y-1 text-sm">
              <Link
                to={base}
                onClick={() => setMenuOpen(false)}
                className="block rounded-lg px-3 py-2 text-gray-800 hover:bg-gray-50"
              >
                🏠 商户首页
              </Link>
              <Link
                to={`${base}/my-orders`}
                onClick={() => setMenuOpen(false)}
                className="block rounded-lg px-3 py-2 text-gray-800 hover:bg-gray-50"
              >
                📋 我的订单
              </Link>
              <button
                type="button"
                onClick={handleCopy}
                className="block w-full rounded-lg px-3 py-2 text-left text-gray-800 hover:bg-gray-50"
              >
                🔗 复制链接 {copied ? '（已复制）' : ''}
              </button>
              <a
                href={`mailto:?subject=${encodeURIComponent('意见反馈')}&body=${encodeURIComponent(`页面：${window.location.href}`)}`}
                className="block rounded-lg px-3 py-2 text-gray-800 hover:bg-gray-50"
              >
                💬 意见反馈
              </a>
            </div>
            <div className="my-2 border-t border-gray-100" />
            <Link
              to="/register"
              onClick={() => setMenuOpen(false)}
              className="block rounded-lg px-3 py-2 font-medium text-emerald-700 hover:bg-emerald-50"
            >
              ✨ 想拥有自己的店？立即创建 →
            </Link>
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              className="mt-2 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700"
            >
              关闭
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
