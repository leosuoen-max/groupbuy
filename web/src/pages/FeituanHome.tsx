import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useWechatNotifySession } from '../hooks/useWechatNotifySession';
import { useWechatShareCard } from '../hooks/useWechatShareCard';
import { listListedFeituanProjects } from '../lib/feituanService';
import type { ProjectRow } from '../lib/projectService';
import { getShopById, type ShopRow } from '../lib/shopService';
import {
  buildFeituanHomeShareCard,
  compactWechatShareText,
} from '../lib/wechatShareMeta';

function projectImages(p: ProjectRow): string[] {
  const urls: string[] = [];
  const push = (raw: string | undefined | null) => {
    const url = raw?.trim();
    if (url && !urls.includes(url)) urls.push(url);
  };
  push(p.data.imageBlocks?.find((b) => b.isCoverImage)?.url);
  for (const block of p.data.imageBlocks ?? []) push(block.url);
  for (const product of [...(p.data.products ?? [])].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
  )) {
    push(product.imageUrl);
  }
  return urls.slice(0, 4);
}

function firstProductNames(p: ProjectRow): string {
  return [...(p.data.products ?? [])]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .slice(0, 3)
    .map((x) => x.name.trim())
    .filter(Boolean)
    .join('、');
}

function fmtCloseTime(p: ProjectRow): string {
  const d = p.data.closesAt?.toDate?.();
  if (!d) return '';
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

async function loadShopsById(projects: ProjectRow[]): Promise<Map<string, ShopRow | null>> {
  const shopIds = [...new Set(projects.map((project) => project.data.shopId))];
  const entries = await Promise.all(
    shopIds.map(async (shopId) => [shopId, await getShopById(shopId)] as const)
  );
  return new Map(entries);
}

export default function FeituanHome() {
  useWechatNotifySession();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<Array<{ project: ProjectRow; shop: ShopRow | null }>>([]);
  const shareCard = useMemo(
    () =>
      rows.length > 0
        ? buildFeituanHomeShareCard(rows.map((x) => ({ project: x.project.data, shop: x.shop?.data ?? null })))
        : null,
    [rows]
  );
  const wechatShareDebug = useWechatShareCard(shareCard);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setErr(null);
      try {
        const projects = await listListedFeituanProjects();
        const shopsById = await loadShopsById(projects);
        const items = projects.map((project) => ({
          project,
          shop: shopsById.get(project.data.shopId) ?? null,
        }));
        if (!cancelled) setRows(items);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : '加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const listedText = rows.length > 0 ? `正在开团 · ${rows.length} 个饭团项目` : '正在开团';

  return (
    <main className="min-h-svh bg-[#fffaf4] px-4 pb-24 pt-5">
      <header className="mb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-[24px] font-black tracking-tight text-gray-950">大马饭团</h1>
            <p className="mt-1 text-sm text-orange-900/70">今日团购饭菜，集中下单更省心</p>
          </div>
          <span className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-semibold text-orange-800">
            今日团
          </span>
        </div>
        <nav className="mt-4 grid grid-cols-3 gap-2">
          <Link
            to="/feituan/wallet"
            className="rounded-2xl border border-orange-100 bg-white px-2 py-3 text-center shadow-sm active:scale-[0.99]"
          >
            <span className="block text-lg">💳</span>
            <span className="mt-1 block text-xs font-semibold text-gray-900">饭团钱包</span>
          </Link>
          <Link
            to="/feituan/my-orders"
            className="rounded-2xl border border-orange-100 bg-white px-2 py-3 text-center shadow-sm active:scale-[0.99]"
          >
            <span className="block text-lg">🧾</span>
            <span className="mt-1 block text-xs font-semibold text-gray-900">我的订单</span>
          </Link>
          <Link
            to="/feituan/account"
            className="rounded-2xl border border-orange-100 bg-white px-2 py-3 text-center shadow-sm active:scale-[0.99]"
          >
            <span className="block text-lg">👤</span>
            <span className="mt-1 block text-xs font-semibold text-gray-900">账号中心</span>
          </Link>
        </nav>
      </header>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-bold text-gray-950">{listedText}</h2>
        <span className="text-xs text-orange-700">点卡片进入下单</span>
      </div>

      {loading ? <p className="text-sm text-gray-600">加载中…</p> : null}
      {err ? <p className="mb-3 text-sm text-red-600">{err}</p> : null}
      {!loading && rows.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-orange-200 bg-white px-4 py-10 text-center text-sm text-gray-600">
          今天暂无饭团项目，稍后再来看看。
        </div>
      ) : null}
      <div className="space-y-3">
        {rows.map(({ project, shop }) => {
          const images = projectImages(project);
          const href = `/feituan/projects/${encodeURIComponent(project.id)}`;
          const intro =
            compactWechatShareText(project.data.textContent, 72) ||
            firstProductNames(project) ||
            '点击查看饭团详情。';
          const close = fmtCloseTime(project);
          return (
            <Link
              key={project.id}
              to={href}
              className="block overflow-hidden rounded-3xl border border-orange-100 bg-white shadow-sm transition active:scale-[0.99]"
            >
              <div className="px-3.5 pb-3.5 pt-3">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-orange-800">
                      {shop?.data.name ?? '店铺'}
                    </p>
                    <h3 className="mt-0.5 line-clamp-1 text-[17px] font-black leading-tight text-gray-950">
                      {project.data.title || '未命名项目'}
                    </h3>
                  </div>
                  {close ? (
                    <span className="shrink-0 rounded-full bg-orange-50 px-2 py-1 text-[11px] font-semibold text-orange-700">
                      截止 {close}
                    </span>
                  ) : null}
                </div>

                {images.length > 0 ? (
                  <div className="mb-2 grid h-28 grid-cols-5 gap-1.5 overflow-hidden rounded-2xl bg-orange-50">
                    <img
                      src={images[0]}
                      alt=""
                      className={`${images.length > 1 ? 'col-span-3' : 'col-span-5'} h-28 w-full object-cover`}
                      loading="lazy"
                    />
                    {images.length > 1 ? (
                      <div className="col-span-2 grid h-28 grid-cols-2 gap-1.5">
                        {images.slice(1, 4).map((img, idx) => (
                          <img
                            key={img}
                            src={img}
                            alt=""
                            className={`${idx === 0 && images.length === 2 ? 'col-span-2 row-span-2' : ''} h-full min-h-0 w-full object-cover`}
                            loading="lazy"
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <p className="line-clamp-2 text-[13px] leading-relaxed text-gray-600">
                  {intro}
                </p>
                <p className="mt-2 text-xs font-bold text-orange-700">进入饭团项目 →</p>
              </div>
            </Link>
          );
        })}
      </div>
      {wechatShareDebug ? (
        <pre className="fixed inset-x-2 bottom-2 z-[9999] max-h-[45vh] overflow-auto rounded-xl bg-black/90 p-3 text-[11px] leading-relaxed text-lime-100 shadow-2xl">
          {JSON.stringify(wechatShareDebug, null, 2)}
        </pre>
      ) : null}
    </main>
  );
}
