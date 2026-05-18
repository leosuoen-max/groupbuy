import { describe, expect, it } from 'vitest';
import type { ProjectRow } from './projectService';
import {
  HERO_PLACEMENT_ORDER,
  VARIANT_SLOT_COUNT,
  assignMosaicImages,
  auxCellClassName,
  buildFeituanHomeMosaicPlan,
  buildFeituanHomeMosaicPlans,
  collectProjectImagePool,
  eligibleVariantsForCount,
  heroPlacementOf,
  isForbiddenHeroLayoutVariant,
  isValidFeituanHomeMosaicPlan,
  pickVariant,
} from './feituanHomeMosaic';

function mockProject(
  id: string,
  images: { url: string; cover?: boolean }[],
  products: { name: string; imageUrl?: string }[] = []
): ProjectRow {
  return {
    id,
    data: {
      shopId: 'shop1',
      title: `项目 ${id}`,
      imageBlocks: images.map((x) => ({
        url: x.url,
        isCoverImage: Boolean(x.cover),
      })),
      products: products.map((p, i) => ({
        name: p.name,
        imageUrl: p.imageUrl,
        sortOrder: i,
      })),
    },
  } as ProjectRow;
}

describe('feituanHomeMosaic', () => {
  it('defines five hero placements', () => {
    expect(HERO_PLACEMENT_ORDER).toHaveLength(5);
    expect(heroPlacementOf('single')).toBe('full');
    expect(heroPlacementOf('split-h')).toBe('half-left');
    expect(heroPlacementOf('split-wide')).toBe('narrow-left');
    expect(heroPlacementOf('hero-left-2')).toBe('wide-left');
    expect(heroPlacementOf('hero-right-2')).toBe('wide-right');
    expect(heroPlacementOf('hero-right-2x2')).toBe('wide-right');
  });

  it('uses first image in collection order as hero', () => {
    const pool = collectProjectImagePool(
      mockProject(
        'p1',
        [
          { url: 'https://a/first.jpg' },
          { url: 'https://a/cover.jpg', cover: true },
        ],
        [{ name: '菜', imageUrl: 'https://a/product.jpg' }]
      )
    );
    expect(pool.hero).toBe('https://a/first.jpg');
  });

  it('never duplicates images in a plan', () => {
    const plan = buildFeituanHomeMosaicPlan(
      mockProject('dup', [
        { url: 'https://x/1.jpg' },
        { url: 'https://x/2.jpg' },
      ]),
      0
    );
    expect(new Set(plan!.images).size).toBe(plan!.images.length);
  });

  it('plan image count matches variant slots and heroPlacement', () => {
    for (let n = 1; n <= 6; n++) {
      const urls = Array.from({ length: n }, (_, i) => ({
        url: `https://t/${n}-${i}.jpg`,
      }));
      const plan = buildFeituanHomeMosaicPlan(mockProject(`n${n}`, urls), 0);
      expect(plan).not.toBeNull();
      expect(isValidFeituanHomeMosaicPlan(plan!)).toBe(true);
      expect(plan!.images.length).toBe(VARIANT_SLOT_COUNT[plan!.variant]);
      expect(plan!.heroPlacement).toBe(heroPlacementOf(plan!.variant));
    }
  });

  it('never picks forbidden layouts', () => {
    for (let n = 1; n <= 6; n++) {
      const plan = buildFeituanHomeMosaicPlan(
        mockProject(
          `f${n}`,
          Array.from({ length: n }, (_, i) => ({ url: `https://v/${n}-${i}.jpg` }))
        ),
        0
      );
      expect(isForbiddenHeroLayoutVariant(plan!.variant)).toBe(false);
    }
  });

  it('aux 3-up spans bottom cell', () => {
    expect(auxCellClassName(2, 3)).toBe('col-span-2');
  });

  it('pickVariant excludes previous variant when possible', () => {
    const eligible = eligibleVariantsForCount(4);
    expect(eligible).toContain('hero-left-2x2');
    expect(eligible).toContain('hero-right-2x2');
    expect(pickVariant(4, 1, 'hero-left-2x2')).not.toBe('hero-left-2x2');
    expect(pickVariant(4, 1, 'hero-right-2x2')).not.toBe('hero-right-2x2');
  });

  it('adjacent plans never share variant when alternatives exist', () => {
    const four = (id: string) =>
      mockProject(id, [
        { url: `https://${id}/1.jpg` },
        { url: `https://${id}/2.jpg` },
        { url: `https://${id}/3.jpg` },
        { url: `https://${id}/4.jpg` },
      ]);
    const plans = buildFeituanHomeMosaicPlans([four('a'), four('b'), four('c')]);
    expect(plans[0]!.variant).not.toBe(plans[1]!.variant);
    expect(plans[1]!.variant).not.toBe(plans[2]!.variant);
  });

  it('assignMosaicImages returns null instead of padding duplicates', () => {
    expect(assignMosaicImages('https://a/1.jpg', [], 2, 1)).toBeNull();
  });

  it('is stable per project id', () => {
    const p = mockProject('stable', [
      { url: 'https://x/1.jpg' },
      { url: 'https://x/2.jpg' },
      { url: 'https://x/3.jpg' },
    ]);
    expect(buildFeituanHomeMosaicPlan(p, 0)).toEqual(buildFeituanHomeMosaicPlan(p, 0));
  });
});
