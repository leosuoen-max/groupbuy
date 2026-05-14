import type { MockShopHome } from '../data/mockShopHome';
import type { ProjectDoc, ShopDoc } from '../types/firestore';
import type { WechatShareCard } from '../hooks/useWechatShareCard';
import { getProjectSharePageUrl, resolvePublicOrigin } from './shareLink';

function toAbsoluteUrl(raw: string | undefined | null): string {
  const v = (raw ?? '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith('//')) return `https:${v}`;
  const origin = resolvePublicOrigin();
  if (!origin) return v;
  return v.startsWith('/') ? `${origin}${v}` : `${origin}/${v}`;
}

function fallbackImageUrl(): string {
  return toAbsoluteUrl('/favicon.svg');
}

export function compactWechatShareText(raw: string | undefined, max = 80): string {
  const text = (raw ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1 ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1 ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function deadlineDesc(raw: string | Date | undefined | null): string {
  const date = raw instanceof Date ? raw : raw ? new Date(raw) : null;
  if (!date || Number.isNaN(date.getTime())) return '点击查看详情并下单。';
  return `截止时间：${date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })}`;
}

export function buildWechatShareCardFromShopHome(
  projectId: string,
  data: MockShopHome
): WechatShareCard {
  const image =
    toAbsoluteUrl(data.bannerUrl) ||
    toAbsoluteUrl(data.imageBlocks.find((b) => b.url.trim())?.url) ||
    toAbsoluteUrl([...data.products].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).find((p) => p.imageUrl?.trim())?.imageUrl) ||
    toAbsoluteUrl(data.shopLogoUrl) ||
    fallbackImageUrl();
  return {
    title: `${data.shopName} · ${data.projectTitle}`,
    desc: compactWechatShareText(data.textContent) || deadlineDesc(data.closesAt),
    link: getProjectSharePageUrl(projectId),
    imgUrl: image,
  };
}

export function buildWechatShareCardFromProject(
  projectId: string,
  project: ProjectDoc,
  shop: ShopDoc | null | undefined,
  opts?: { prefix?: string }
): WechatShareCard {
  const shopName = shop?.name?.trim() || '店铺';
  const title = opts?.prefix
    ? `${opts.prefix} · ${shopName} · ${project.title}`
    : `${shopName} · ${project.title}`;
  const image =
    toAbsoluteUrl(project.imageBlocks?.find((b) => b.isCoverImage)?.url) ||
    toAbsoluteUrl(project.imageBlocks?.find((b) => b.url.trim())?.url) ||
    toAbsoluteUrl([...project.products].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).find((p) => p.imageUrl?.trim())?.imageUrl) ||
    toAbsoluteUrl(shop?.bannerImage) ||
    toAbsoluteUrl(shop?.logoImage) ||
    fallbackImageUrl();
  return {
    title,
    desc:
      compactWechatShareText(project.textContent) ||
      deadlineDesc(project.closesAt?.toDate?.() ?? null),
    link: getProjectSharePageUrl(projectId),
    imgUrl: image,
  };
}

export function buildFeituanHomeShareCard(
  items: Array<{ project: ProjectDoc; shop: ShopDoc | null }>
): WechatShareCard {
  const now = new Date();
  const title = `大马饭团｜${now.getMonth() + 1}月${now.getDate()}日｜今日团`;
  const shopNames = [
    ...new Set(items.map((x) => x.shop?.name?.trim()).filter(Boolean) as string[]),
  ];
  const first = items[0] ?? null;
  const firstIntro = first ? compactWechatShareText(first.project.textContent, 42) : '';
  const descByShops = shopNames.join('、');
  const desc =
    descByShops.length >= 12
      ? descByShops
      : [descByShops, firstIntro].filter(Boolean).join('｜') ||
        '今日精选饭团，和朋友一起拼单下单。';
  const firstProductImg = first?.project.products
    ?.slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .find((p) => p.imageUrl?.trim())?.imageUrl;
  const image =
    toAbsoluteUrl(firstProductImg) ||
    toAbsoluteUrl(first?.project.imageBlocks?.find((b) => b.url.trim())?.url) ||
    toAbsoluteUrl(first?.shop?.bannerImage) ||
    toAbsoluteUrl(first?.shop?.logoImage) ||
    fallbackImageUrl();
  const origin = resolvePublicOrigin();
  return {
    title,
    desc,
    link: origin ? `${origin}/feituan` : '/feituan',
    imgUrl: image,
  };
}
