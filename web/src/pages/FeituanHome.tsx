import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useWechatNotifySession } from '../hooks/useWechatNotifySession';
import { useWechatShareCard } from '../hooks/useWechatShareCard';
import { FEITUAN_HOME } from '../lib/feituanHomeTheme';
import { listListedFeituanProjects } from '../lib/feituanService';
import type { ProjectRow } from '../lib/projectService';
import { getShopById, type ShopRow } from '../lib/shopService';
import {
  buildFeituanHomeShareCard,
  compactWechatShareText,
} from '../lib/wechatShareMeta';

const C = FEITUAN_HOME;

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
  return urls.slice(0, 6);
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
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const datePart = d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour12: false,
  });
  const timePart = d.toLocaleString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${datePart} ${weekdays[d.getDay()]} ${timePart}`;
}

function deliveryTimeLabel(p: ProjectRow): string {
  const text = p.data.deliveryTimeText?.trim();
  return text || '待商户填写';
}

function TimingBadgeBox({ children }: { children: ReactNode }) {
  return (
    <div
      className="shrink-0 rounded-[14px] border px-2.5 py-1.5 text-right text-[11px] font-semibold leading-snug"
      style={{
        backgroundColor: C.timingBg,
        borderColor: C.timingBorder,
        color: C.primary,
      }}
    >
      {children}
    </div>
  );
}

function ProjectTimingBadge({ project }: { project: ProjectRow }) {
  const close = fmtCloseTime(project);
  const delivery = deliveryTimeLabel(project);
  if (!close && !delivery) return null;
  return (
    <TimingBadgeBox>
      {close ? (
        <p>
          截单：
          <span style={{ color: C.warning }}>{close}</span>
        </p>
      ) : null}
      <p>
        送达：
        <span style={{ color: C.warning }}>{delivery}</span>
      </p>
    </TimingBadgeBox>
  );
}

async function loadShopsById(projects: ProjectRow[]): Promise<Map<string, ShopRow | null>> {
  const shopIds = [...new Set(projects.map((project) => project.data.shopId))];
  const entries = await Promise.all(
    shopIds.map(async (shopId) => [shopId, await getShopById(shopId)] as const)
  );
  return new Map(entries);
}

function FeituanBottomNav() {
  const { pathname } = useLocation();
  const items = [
    { to: '/feituan/wallet', label: '饭团钱包', match: (p: string) => p.startsWith('/feituan/wallet') },
    { to: '/feituan/my-orders', label: '我的订单', match: (p: string) => p.startsWith('/feituan/my-orders') },
    {
      to: '/feituan/account',
      label: '账号中心',
      match: (p: string) => p === '/feituan/account' || p.startsWith('/feituan/account/'),
    },
  ] as const;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-white/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur"
      style={{ borderColor: C.primaryBorder, boxShadow: C.navShadow }}
    >
      <div
        className="mx-auto grid max-w-xl grid-cols-3 overflow-hidden rounded-2xl border bg-white"
        style={{ borderColor: C.primaryBorder }}
      >
        {items.map((item, index) => {
          const active = item.match(pathname);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`py-2.5 text-center text-xs ${index < items.length - 1 ? 'border-r' : ''}`}
              style={{
                borderColor: C.primaryBorder,
                color: active ? C.primary : C.textMain,
                fontWeight: active ? 700 : 600,
                backgroundColor: active ? C.primaryLight : C.card,
                borderTopWidth: active ? 3 : 0,
                borderTopStyle: 'solid',
                borderTopColor: active ? C.primary : 'transparent',
              }}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
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
    <main className="min-h-svh px-4 pb-28 pt-5" style={{ backgroundColor: C.primaryBg }}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-bold" style={{ color: C.textMain }}>
          {listedText}
        </h2>
        <span className="text-xs font-bold" style={{ color: C.primary }}>
          点卡片进入下单
        </span>
      </div>

      {loading ? <p className="text-sm" style={{ color: C.textSub }}>加载中…</p> : null}
      {err ? <p className="mb-3 text-sm text-red-600">{err}</p> : null}
      {!loading && rows.length === 0 ? (
        <div
          className="rounded-3xl border border-dashed px-4 py-10 text-center text-sm"
          style={{
            borderColor: C.primaryBorder,
            backgroundColor: C.card,
            color: C.textSub,
          }}
        >
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
          return (
            <Link
              key={project.id}
              to={href}
              className="block overflow-hidden rounded-3xl border bg-white transition active:scale-[0.99]"
              style={{
                borderColor: C.primaryBorder,
                boxShadow: C.cardShadow,
              }}
            >
              <div className="px-3.5 pb-3.5 pt-3">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium" style={{ color: C.primary }}>
                      {shop?.data.name ?? '店铺'}
                    </p>
                    <h3
                      className="mt-0.5 line-clamp-1 text-[17px] font-extrabold leading-tight"
                      style={{ color: C.textMain }}
                    >
                      {project.data.title || '未命名项目'}
                    </h3>
                  </div>
                  <ProjectTimingBadge project={project} />
                </div>

                {images.length > 0 ? <ProjectImageMosaic images={images} /> : null}

                <p className="line-clamp-2 text-[13px] leading-relaxed" style={{ color: C.textSub }}>
                  {intro}
                </p>
                <p
                  className="mt-2 inline-flex rounded-full border px-3 py-1.5 text-xs font-bold"
                  style={{
                    backgroundColor: C.primaryLight,
                    borderColor: C.timingBorder,
                    color: C.primary,
                  }}
                >
                  进入饭团项目 →
                </p>
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
      <FeituanBottomNav />
    </main>
  );
}

function ProjectImageMosaic({ images }: { images: string[] }) {
  const mosaicBg = { backgroundColor: C.primaryBg };
  const count = images.length;
  if (count === 1) {
    return (
      <div className="mb-2 overflow-hidden rounded-2xl" style={mosaicBg}>
        <img src={images[0]} alt="" className="h-28 w-full object-cover" loading="lazy" />
      </div>
    );
  }

  if (count === 2) {
    return (
      <div className="mb-2 grid h-28 grid-cols-2 gap-1.5 overflow-hidden rounded-2xl" style={mosaicBg}>
        {images.map((img) => (
          <img key={img} src={img} alt="" className="h-28 w-full object-cover" loading="lazy" />
        ))}
      </div>
    );
  }

  if (count === 3) {
    return (
      <div className="mb-2 grid h-28 grid-cols-5 gap-1.5 overflow-hidden rounded-2xl" style={mosaicBg}>
        <img src={images[0]} alt="" className="col-span-3 h-28 w-full object-cover" loading="lazy" />
        <div className="col-span-2 grid h-28 grid-rows-2 gap-1.5">
          {images.slice(1, 3).map((img) => (
            <img key={img} src={img} alt="" className="h-full min-h-0 w-full object-cover" loading="lazy" />
          ))}
        </div>
      </div>
    );
  }

  if (count === 4) {
    return (
      <div className="mb-2 grid h-28 grid-cols-5 gap-1.5 overflow-hidden rounded-2xl" style={mosaicBg}>
        <img src={images[0]} alt="" className="col-span-3 h-28 w-full object-cover" loading="lazy" />
        <div className="col-span-2 grid h-28 grid-cols-2 grid-rows-2 gap-1.5">
          {images.slice(1, 4).map((img, idx) => (
            <img
              key={img}
              src={img}
              alt=""
              className={`${idx === 0 ? 'col-span-2' : ''} h-full min-h-0 w-full object-cover`}
              loading="lazy"
            />
          ))}
        </div>
      </div>
    );
  }

  const smallImages = images.slice(1, count >= 6 ? 6 : 5);
  return (
    <div className="mb-2 grid h-28 grid-cols-5 gap-1.5 overflow-hidden rounded-2xl" style={mosaicBg}>
      <img
        src={images[0]}
        alt=""
        className="col-span-3 h-28 w-full object-cover"
        loading="lazy"
      />
      <div className="col-span-2 grid h-28 grid-cols-2 gap-1.5">
        {smallImages.map((img, idx) => (
          <img
            key={img}
            src={img}
            alt=""
            className={`${smallImages.length === 5 && idx === 0 ? 'row-span-2' : ''} h-full min-h-0 w-full object-cover`}
            loading="lazy"
          />
        ))}
      </div>
    </div>
  );
}
