import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ShopShareSheet } from '../components/customer/ShopShareSheet';
import { FeituanHomeBottomNav } from '../components/feituan/FeituanHomeBottomNav';
import { FeituanHomePageHeader } from '../components/feituan/FeituanHomePageHeader';
import { useWechatNotifySession } from '../hooks/useWechatNotifySession';
import { useWechatShareCard } from '../hooks/useWechatShareCard';
import { resolveProjectDeliveryLabel } from '../lib/deliverySlot';
import { feituanPageBottomPaddingClass } from '../lib/feituanBottomNav';
import { FEITUAN_HOME } from '../lib/feituanHomeTheme';
import {
  buildRecurringConsumerNoticeTextForHome,
  getRecurringSchedule,
  isProjectRecurring,
} from '../lib/recurringDeliverySchedule';
import { listListedFeituanProjects } from '../lib/feituanService';
import type { ProjectRow } from '../lib/projectService';
import { getFeituanHomeShareUrl } from '../lib/shareLink';
import { getShopById, type ShopRow } from '../lib/shopService';
import { buildFeituanHomeMosaicPlans } from '../lib/feituanHomeMosaic';
import {
  buildFeituanHomeShareCard,
  compactWechatShareText,
} from '../lib/wechatShareMeta';
import { FeituanHomeProjectMosaic } from '../components/feituan/FeituanHomeProjectMosaic';

const C = FEITUAN_HOME;

function formatWechatShareSetupError(raw: string | null): string {
  const msg = (raw ?? '').trim();
  if (!msg) {
    return '请确认 WECHAT_APP_ID/SECRET、JS 安全域名 groupbuy-app-24c46.web.app、公众号 IP 白名单';
  }
  if (/40164|invalid ip|not in whitelist/i.test(msg)) {
    return '公众号 IP 白名单未包含 Cloud Functions 出口 IP（errcode 40164），请在 mp.weixin.qq.com → 基本配置 → IP 白名单添加';
  }
  if (/retCode":-1|retCode\":-1|retCode:-1/i.test(msg)) {
    return '微信未接受分享参数（retCode:-1），请重新部署后刷新；分享 link 已与签名 URL 对齐';
  }
  if (/WECHAT_APP_ID|not configured/i.test(msg)) {
    return 'Cloud Functions 未配置 WECHAT_APP_ID / WECHAT_APP_SECRET';
  }
  return msg.length > 120 ? `${msg.slice(0, 119)}…` : msg;
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
  const label = resolveProjectDeliveryLabel(p.data);
  return label || '待商户填写';
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
  const recurring = isProjectRecurring(project.data);
  const delivery = recurring ? '' : deliveryTimeLabel(project);
  if (!close && !delivery) return null;

  if (recurring) {
    if (!close) return null;
    return (
      <TimingBadgeBox>
        <p className="whitespace-nowrap">
          截单：
          <span style={{ color: C.brandViolet }}>{close}</span>
        </p>
      </TimingBadgeBox>
    );
  }

  return (
    <TimingBadgeBox>
      {close ? (
        <p>
          截单：
          <span style={{ color: C.brandViolet }}>{close}</span>
        </p>
      ) : null}
      <p>
        配送：
        <span style={{ color: C.brandViolet }}>{delivery}</span>
      </p>
    </TimingBadgeBox>
  );
}

function recurringHomeNotice(project: ProjectRow): string | null {
  const schedule = getRecurringSchedule(project.data);
  if (!schedule) return null;
  return buildRecurringConsumerNoticeTextForHome(schedule);
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
  const [shareSheetOpen, setShareSheetOpen] = useState(false);
  const [shareSheetCopied, setShareSheetCopied] = useState(false);
  const shareCard = useMemo(
    () =>
      buildFeituanHomeShareCard(
        rows.map((x) => ({ project: x.project.data, shop: x.shop?.data ?? null }))
      ),
    [rows]
  );
  const shouldDebugWechatShare =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('debugWechatShare') === '1';
  const { debug: wechatShareDebug } = useWechatShareCard(
    shouldDebugWechatShare ? shareCard : null
  );
  const shareUrl = shareCard?.link?.trim() || getFeituanHomeShareUrl();
  const shareHeadline = shareCard?.title?.trim() || '大马饭团 · 今日团';

  const handleShareSheetCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareSheetCopied(true);
      window.setTimeout(() => setShareSheetCopied(false), 1600);
    } catch {
      window.prompt('复制链接：', shareUrl);
    }
  }, [shareUrl]);

  const handleShareSheetSystemShare = useCallback(async () => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: shareHeadline,
          text: shareCard?.desc,
          url: shareUrl,
        });
        setShareSheetOpen(false);
      }
    } catch {
      /* 用户取消系统分享 */
    }
  }, [shareCard?.desc, shareHeadline, shareUrl]);

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
  const mosaicPlans = useMemo(
    () => buildFeituanHomeMosaicPlans(rows.map((r) => r.project)),
    [rows]
  );

  return (
    <main
      className={`min-h-svh ${feituanPageBottomPaddingClass}`}
      style={{ backgroundColor: C.primaryBg }}
    >
      <FeituanHomePageHeader onShare={() => setShareSheetOpen(true)} />
      <div className="px-4 pt-1">
        <h2 className="mb-3 text-base font-bold leading-tight" style={{ color: C.textMain }}>
          {listedText}
        </h2>

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
        {rows.map(({ project, shop }, cardIndex) => {
          const mosaicPlan = mosaicPlans[cardIndex] ?? null;
          const href = `/feituan/projects/${encodeURIComponent(project.id)}`;
          const intro =
            compactWechatShareText(project.data.textContent, 72) ||
            firstProductNames(project) ||
            '点击查看饭团详情。';
          const recurringNotice = recurringHomeNotice(project);
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
                <div className="mb-2 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
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
                  {recurringNotice ? (
                    <p
                      className="text-[11px] leading-snug"
                      style={{ color: C.textSub }}
                    >
                      {recurringNotice}
                    </p>
                  ) : null}
                </div>

                {mosaicPlan ? <FeituanHomeProjectMosaic plan={mosaicPlan} /> : null}

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
      <div aria-hidden className="mt-6 h-4 shrink-0" />
      {wechatShareDebug ? (
        <div className="fixed inset-x-2 bottom-2 z-[9999] max-h-[45vh] overflow-auto rounded-xl bg-black/90 p-3 text-[11px] leading-relaxed text-lime-100 shadow-2xl">
          {wechatShareDebug.error || wechatShareDebug.wxError ? (
            <p className="mb-2 rounded-lg bg-red-950/80 px-2 py-1.5 text-red-200">
              {formatWechatShareSetupError(wechatShareDebug.error || wechatShareDebug.wxError)}
            </p>
          ) : null}
          <pre className="whitespace-pre-wrap break-all">
            {JSON.stringify(wechatShareDebug, null, 2)}
          </pre>
        </div>
      ) : null}
      </div>
      <FeituanHomeBottomNav />
      <ShopShareSheet
        open={shareSheetOpen}
        onClose={() => setShareSheetOpen(false)}
        headline={shareHeadline}
        copied={shareSheetCopied}
        onCopyLink={() => void handleShareSheetCopyLink()}
        showSystemShare={typeof navigator !== 'undefined' && Boolean(navigator.share)}
        onSystemShare={() => void handleShareSheetSystemShare()}
      />
    </main>
  );
}
