import type { ProjectRow } from './projectService';

/** 变更此版本可整体刷新主页排版（仍按 projectId 稳定） */
export const FEITUAN_HOME_MOSAIC_VERSION = 'feituan-home-mosaic-v5';

export type MosaicHeight = 'h-24' | 'h-28' | 'h-32';

export type MosaicVariant =
  | 'single'
  | 'split-h'
  | 'split-v'
  | 'split-wide'
  | 'hero-left-2'
  | 'hero-top-2'
  | 'hero-right-2'
  | 'row-3'
  | 'hero-left-2x2'
  | 'hero-right-2x2'
  | 'grid-2x2'
  | 'hero-top-3'
  | 'hero-left-stack'
  | 'hero-right-stack'
  | 'top-banner-grid'
  | 'magazine-6';

/**
 * 主图放置方式（自动排版仅使用此集合；主图均为单格完整高度，不做上下分割）。
 *
 * | 放置 | 约占宽 | 适用 |
 * |------|--------|------|
 * | full | 100% | 仅 1 张图 |
 * | half-left | 50% | 2 张，左右对半 |
 * | narrow-left | 40% | 2 张，左窄右宽 |
 * | wide-left | 60% | 3 张+，主图左 + 副图侧栏 |
 * | wide-right | 60% | 3 张+，主图右 + 副图侧栏 |
 */
export type HeroPlacement =
  | 'full'
  | 'half-left'
  | 'narrow-left'
  | 'wide-left'
  | 'wide-right';

export const HERO_PLACEMENT_ORDER: HeroPlacement[] = [
  'full',
  'half-left',
  'narrow-left',
  'wide-left',
  'wide-right',
];

export type FeituanHomeMosaicPlan = {
  layoutId: string;
  variant: MosaicVariant;
  heroPlacement: HeroPlacement;
  heightClass: MosaicHeight;
  /** 按版式槽位顺序排列，images[0] 为主图；张数必须等于版式槽位数，且互不重复 */
  images: string[];
};

/** 每种版式固定槽位数 */
export const VARIANT_SLOT_COUNT: Record<MosaicVariant, number> = {
  single: 1,
  'split-h': 2,
  'split-v': 2,
  'split-wide': 2,
  'hero-left-2': 3,
  'hero-top-2': 3,
  'hero-right-2': 3,
  'row-3': 3,
  'hero-left-2x2': 4,
  'hero-right-2x2': 4,
  'grid-2x2': 4,
  'hero-top-3': 4,
  'hero-left-stack': 5,
  'hero-right-stack': 5,
  'top-banner-grid': 5,
  'magazine-6': 5,
};

const HEIGHTS: MosaicHeight[] = ['h-24', 'h-28', 'h-32'];

/** 主图禁止：全宽上下叠放 */
export const HERO_FORBIDS_FULL_WIDTH_VERTICAL_STACK: ReadonlySet<MosaicVariant> = new Set([
  'split-v',
  'hero-top-2',
  'hero-top-3',
  'top-banner-grid',
]);

/** 主图禁止：全宽横条等分（主图被压窄条） */
export const HERO_FORBIDS_FULL_WIDTH_HORIZONTAL_BAND: ReadonlySet<MosaicVariant> = new Set([
  'row-3',
]);

/** 副图侧栏最少可视高度 */
export const AUX_CELL_MIN_HEIGHT_CLASS = 'min-h-11';

/** 按张数分桶的候选版式（须已过滤禁用版式） */
const VARIANTS_BY_COUNT: Record<number, MosaicVariant[]> = {
  1: ['single'],
  2: ['split-h', 'split-wide', 'split-h'],
  3: ['hero-left-2', 'hero-right-2'],
  4: ['hero-left-2x2', 'hero-right-2x2'],
  5: ['hero-left-stack', 'hero-right-stack'],
  6: ['hero-left-stack', 'hero-right-stack', 'hero-left-2x2', 'hero-right-2x2'],
};

const FALLBACK_BY_COUNT: Record<number, MosaicVariant> = {
  1: 'single',
  2: 'split-h',
  3: 'hero-left-2',
  4: 'hero-left-2x2',
  5: 'hero-left-stack',
  6: 'hero-left-stack',
};

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mixSeed(base: number, salt: number): number {
  return (Math.imul(base ^ salt, 2654435761) >>> 0) + salt;
}

export function mosaicSeed(
  projectId: string,
  cardIndex: number,
  version = FEITUAN_HOME_MOSAIC_VERSION
): number {
  return hashString(`${version}:${projectId}:${cardIndex}`);
}

export function heroPlacementOf(variant: MosaicVariant): HeroPlacement {
  switch (variant) {
    case 'single':
      return 'full';
    case 'split-h':
      return 'half-left';
    case 'split-wide':
      return 'narrow-left';
    case 'hero-left-2':
    case 'hero-left-2x2':
    case 'hero-left-stack':
      return 'wide-left';
    case 'hero-right-2':
    case 'hero-right-2x2':
    case 'hero-right-stack':
      return 'wide-right';
    default:
      return 'wide-left';
  }
}

function seededShuffle<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let s = seed || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = mixSeed(s, i);
    const j = s % (i + 1);
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/** 采集顺序：图块数组序 → 商品 sortOrder；首张为主图 */
export function collectProjectImagePool(project: ProjectRow): {
  hero: string | null;
  aux: string[];
} {
  const seen = new Set<string>();
  const ordered: string[] = [];

  const push = (raw: string | undefined | null) => {
    const url = raw?.trim();
    if (!url || seen.has(url)) return;
    seen.add(url);
    ordered.push(url);
  };

  for (const block of project.data.imageBlocks ?? []) {
    push(block.url);
  }
  for (const product of [...(project.data.products ?? [])].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
  )) {
    push(product.imageUrl);
  }

  if (ordered.length === 0) return { hero: null, aux: [] };
  return { hero: ordered[0]!, aux: ordered.slice(1) };
}

export function isHeroFullWidthVerticalStackVariant(variant: MosaicVariant): boolean {
  return HERO_FORBIDS_FULL_WIDTH_VERTICAL_STACK.has(variant);
}

export function isHeroFullWidthHorizontalBandVariant(variant: MosaicVariant): boolean {
  return HERO_FORBIDS_FULL_WIDTH_HORIZONTAL_BAND.has(variant);
}

export function isForbiddenHeroLayoutVariant(variant: MosaicVariant): boolean {
  return (
    isHeroFullWidthVerticalStackVariant(variant) ||
    isHeroFullWidthHorizontalBandVariant(variant)
  );
}

export function eligibleVariantsForCount(uniqueCount: number): MosaicVariant[] {
  if (uniqueCount < 1) return [];
  const bucket = Math.min(6, uniqueCount);
  const candidates = VARIANTS_BY_COUNT[bucket] ?? VARIANTS_BY_COUNT[6]!;
  return candidates.filter(
    (v) =>
      VARIANT_SLOT_COUNT[v] <= uniqueCount && !isForbiddenHeroLayoutVariant(v)
  );
}

/** 副图在 2×2 侧栏中的占位：3 张时末张横贯 */
export function auxCellClassName(index: number, auxCount: number): string {
  if (auxCount <= 0) return '';
  if (auxCount === 1) return 'col-span-2 row-span-2';
  if (auxCount === 2) return 'col-span-2';
  if (auxCount === 3) return index === 2 ? 'col-span-2' : '';
  return '';
}

function withoutVariant(
  variants: MosaicVariant[],
  avoid: MosaicVariant | null
): MosaicVariant[] {
  if (!avoid) return variants;
  const filtered = variants.filter((v) => v !== avoid);
  return filtered.length > 0 ? filtered : variants;
}

/** 稳定选版；尽量与上一张卡片的 variant 不同 */
export function pickVariant(
  uniqueCount: number,
  seed: number,
  avoidVariant: MosaicVariant | null
): MosaicVariant {
  const eligible = withoutVariant(eligibleVariantsForCount(uniqueCount), avoidVariant);
  if (eligible.length === 0) {
    return FALLBACK_BY_COUNT[Math.min(6, Math.max(1, uniqueCount))] ?? 'single';
  }
  const idx = mixSeed(seed, uniqueCount) % eligible.length;
  return eligible[idx]!;
}

/** 稳定选高；若版式不得不与上一张相同，则换高度 */
export function pickHeight(seed: number, avoidHeight: MosaicHeight | null): MosaicHeight {
  const pool = avoidHeight ? HEIGHTS.filter((h) => h !== avoidHeight) : HEIGHTS;
  const list = pool.length > 0 ? pool : HEIGHTS;
  return list[mixSeed(seed, 99) % list.length]!;
}

export function assignMosaicImages(
  hero: string,
  aux: string[],
  slots: number,
  seed: number
): string[] | null {
  if (slots < 1) return null;
  const shuffled = seededShuffle(aux, mixSeed(seed, 7));
  const out: string[] = [hero];
  for (const url of shuffled) {
    if (out.length >= slots) break;
    if (!out.includes(url)) out.push(url);
  }
  if (out.length !== slots) return null;
  return out;
}

export function isValidFeituanHomeMosaicPlan(plan: FeituanHomeMosaicPlan): boolean {
  const slots = VARIANT_SLOT_COUNT[plan.variant];
  if (plan.images.length !== slots) return false;
  if (new Set(plan.images).size !== plan.images.length) return false;
  if (isForbiddenHeroLayoutVariant(plan.variant)) return false;
  if (heroPlacementOf(plan.variant) !== plan.heroPlacement) return false;
  return plan.images.every((u) => u.trim().length > 0);
}

export function buildFeituanHomeMosaicPlan(
  project: ProjectRow,
  cardIndex: number,
  avoidVariant: MosaicVariant | null = null,
  avoidHeight: MosaicHeight | null = null
): FeituanHomeMosaicPlan | null {
  const pool = collectProjectImagePool(project);
  if (!pool.hero) return null;

  const uniqueCount = 1 + pool.aux.length;
  const seed = mosaicSeed(project.id, cardIndex);

  let variant = pickVariant(uniqueCount, seed, avoidVariant);
  let slots = VARIANT_SLOT_COUNT[variant];
  let images = assignMosaicImages(pool.hero, pool.aux, slots, mixSeed(seed, 13));

  if (!images) {
    const fb = FALLBACK_BY_COUNT[Math.min(6, uniqueCount)] ?? 'single';
    variant = withoutVariant([fb], avoidVariant)[0] ?? fb;
    slots = VARIANT_SLOT_COUNT[variant];
    images = assignMosaicImages(pool.hero, pool.aux, slots, mixSeed(seed, 17));
  }

  if (!images) {
    variant = 'single';
    slots = 1;
    images = [pool.hero];
  }

  const mustDifferLayout =
    avoidVariant !== null && variant === avoidVariant;
  const heightClass = pickHeight(
    mixSeed(seed, 42),
    mustDifferLayout ? avoidHeight : null
  );

  const heroPlacement = heroPlacementOf(variant);
  const plan: FeituanHomeMosaicPlan = {
    layoutId: `${variant}-${heightClass}`,
    variant,
    heroPlacement,
    heightClass,
    images,
  };

  return isValidFeituanHomeMosaicPlan(plan) ? plan : null;
}

export function buildFeituanHomeMosaicPlans(
  projects: ProjectRow[]
): (FeituanHomeMosaicPlan | null)[] {
  let prevVariant: MosaicVariant | null = null;
  let prevHeight: MosaicHeight | null = null;

  return projects.map((project, cardIndex) => {
    const plan = buildFeituanHomeMosaicPlan(
      project,
      cardIndex,
      prevVariant,
      prevHeight
    );
    if (plan) {
      prevVariant = plan.variant;
      prevHeight = plan.heightClass;
    }
    return plan;
  });
}
