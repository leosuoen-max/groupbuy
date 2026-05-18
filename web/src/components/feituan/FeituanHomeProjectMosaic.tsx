import type { ReactNode } from 'react';
import { FEITUAN_HOME } from '../../lib/feituanHomeTheme';
import {
  AUX_CELL_MIN_HEIGHT_CLASS,
  auxCellClassName,
  isValidFeituanHomeMosaicPlan,
  type FeituanHomeMosaicPlan,
} from '../../lib/feituanHomeMosaic';

const mosaicBg = { backgroundColor: FEITUAN_HOME.primaryBg };

function MosaicImg({
  src,
  className,
}: {
  src: string;
  className: string;
}) {
  return (
    <img src={src} alt="" className={`object-cover ${className}`} loading="lazy" />
  );
}

function Shell({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  return (
    <div className={`mb-2 overflow-hidden rounded-2xl ${className}`} style={mosaicBg}>
      {children}
    </div>
  );
}

function MosaicCells({
  urls,
  className,
  cellClassName = 'h-full min-h-0 w-full',
}: {
  urls: string[];
  className: string;
  cellClassName?: string;
}) {
  return (
    <Shell className={className}>
      {urls.map((src, idx) => (
        <MosaicImg key={`${idx}-${src}`} src={src} className={cellClassName} />
      ))}
    </Shell>
  );
}

/** 主图左 + 副图侧栏（按张数自适应，不可空位） */
function HeroLeftAuxPanel({
  hero,
  aux,
  h,
}: {
  hero: string;
  aux: string[];
  h: string;
}) {
  const auxCell = `h-full min-h-0 w-full ${AUX_CELL_MIN_HEIGHT_CLASS}`;
  const heroCell = 'h-full min-h-0 w-full';
  const n = aux.length;

  const sideGridClass =
    n === 1
      ? 'col-span-2 grid h-full min-h-0 grid-cols-1 gap-1.5'
      : n === 2
        ? 'col-span-2 grid h-full min-h-0 grid-cols-1 grid-rows-2 gap-1.5'
        : 'col-span-2 grid h-full min-h-0 grid-cols-2 grid-rows-2 gap-1.5';

  return (
    <Shell className={`grid ${h} grid-cols-5 gap-1.5`}>
      <MosaicImg src={hero} className={`${heroCell} col-span-3`} />
      <div className={sideGridClass}>
        {aux.map((src, idx) => (
          <MosaicImg
            key={`${idx}-${src}`}
            src={src}
            className={`${auxCell} ${auxCellClassName(idx, n)}`}
          />
        ))}
      </div>
    </Shell>
  );
}

/** 主图右 + 副图侧栏 */
function HeroRightAuxPanel({
  hero,
  aux,
  h,
}: {
  hero: string;
  aux: string[];
  h: string;
}) {
  const auxCell = `h-full min-h-0 w-full ${AUX_CELL_MIN_HEIGHT_CLASS}`;
  const heroCell = 'h-full min-h-0 w-full';
  const n = aux.length;

  const sideGridClass =
    n === 1
      ? 'col-span-2 grid h-full min-h-0 grid-cols-1 gap-1.5'
      : n === 2
        ? 'col-span-2 grid h-full min-h-0 grid-cols-1 grid-rows-2 gap-1.5'
        : 'col-span-2 grid h-full min-h-0 grid-cols-2 grid-rows-2 gap-1.5';

  return (
    <Shell className={`grid ${h} grid-cols-5 gap-1.5`}>
      <div className={sideGridClass}>
        {aux.map((src, idx) => (
          <MosaicImg
            key={`${idx}-${src}`}
            src={src}
            className={`${auxCell} ${auxCellClassName(idx, n)}`}
          />
        ))}
      </div>
      <MosaicImg src={hero} className={`${heroCell} col-span-3`} />
    </Shell>
  );
}

/** 主图大格 + 4 张副图小格（2×2 右侧） */
function HeroMagazinePanel({
  hero,
  aux,
  h,
}: {
  hero: string;
  aux: string[];
  h: string;
}) {
  const cell = `h-full min-h-0 w-full ${AUX_CELL_MIN_HEIGHT_CLASS}`;
  return (
    <Shell className={`grid ${h} grid-cols-4 grid-rows-2 gap-1.5`}>
      <MosaicImg src={hero} className={`${cell} col-span-2 row-span-2`} />
      {aux.map((src, idx) => (
        <MosaicImg key={`${idx}-${src}`} src={src} className={cell} />
      ))}
    </Shell>
  );
}

export function FeituanHomeProjectMosaic({ plan }: { plan: FeituanHomeMosaicPlan }) {
  if (!isValidFeituanHomeMosaicPlan(plan)) {
    const src = plan.images[0]?.trim();
    if (!src) return null;
    return (
      <Shell className="">
        <MosaicImg src={src} className={`${plan.heightClass} w-full`} />
      </Shell>
    );
  }

  const h = plan.heightClass;
  const imgs = plan.images;
  const hero = imgs[0]!;
  const aux = imgs.slice(1);
  const cell = 'h-full min-h-0 w-full';

  switch (plan.variant) {
    case 'single':
      return (
        <Shell className="">
          <MosaicImg src={hero} className={`${h} w-full`} />
        </Shell>
      );

    case 'split-h':
      return (
        <MosaicCells
          urls={imgs}
          className={`grid ${h} grid-cols-2 gap-1.5`}
          cellClassName={cell}
        />
      );

    case 'split-v':
      return (
        <MosaicCells
          urls={imgs}
          className={`grid ${h} grid-rows-2 gap-1.5`}
          cellClassName={cell}
        />
      );

    case 'split-wide':
      return (
        <Shell className={`grid ${h} grid-cols-5 gap-1.5`}>
          <MosaicImg src={imgs[0]!} className={`${cell} col-span-2`} />
          <MosaicImg src={imgs[1]!} className={`${cell} col-span-3`} />
        </Shell>
      );

    case 'hero-left-2':
    case 'hero-left-2x2':
    case 'hero-left-stack':
      return <HeroLeftAuxPanel hero={hero} aux={aux} h={h} />;

    case 'hero-right-2':
    case 'hero-right-2x2':
    case 'hero-right-stack':
      return <HeroRightAuxPanel hero={hero} aux={aux} h={h} />;

    case 'row-3':
      return (
        <MosaicCells
          urls={imgs}
          className={`grid ${h} grid-cols-3 gap-1.5`}
          cellClassName={cell}
        />
      );

    case 'grid-2x2':
      return (
        <MosaicCells
          urls={imgs}
          className={`grid ${h} grid-cols-2 grid-rows-2 gap-1.5`}
          cellClassName={`${cell} ${AUX_CELL_MIN_HEIGHT_CLASS}`}
        />
      );

    case 'hero-top-2':
    case 'hero-top-3':
    case 'top-banner-grid':
    case 'magazine-6':
      if (aux.length === 4) {
        return <HeroMagazinePanel hero={hero} aux={aux} h={h} />;
      }
      return <HeroLeftAuxPanel hero={hero} aux={aux} h={h} />;

    default:
      return (
        <Shell className="">
          <MosaicImg src={hero} className={`${h} w-full`} />
        </Shell>
      );
  }
}
