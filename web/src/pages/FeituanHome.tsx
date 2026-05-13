import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageShell } from '../components/PageShell';
import { listListedFeituanProjects } from '../lib/feituanService';
import type { ProjectRow } from '../lib/projectService';
import { getShopById, type ShopRow } from '../lib/shopService';

function pickCover(p: ProjectRow): string | undefined {
  const cover = p.data.imageBlocks?.find((b) => b.isCoverImage)?.url?.trim();
  if (cover) return cover;
  const desc = p.data.imageBlocks?.find((b) => b.url?.trim())?.url?.trim();
  if (desc) return desc;
  const prod = [...(p.data.products ?? [])]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .find((x) => x.imageUrl?.trim())?.imageUrl?.trim();
  return prod || undefined;
}

export default function FeituanHome() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<Array<{ project: ProjectRow; shop: ShopRow | null }>>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setErr(null);
      try {
        const projects = await listListedFeituanProjects();
        const items = await Promise.all(
          projects.map(async (project) => ({
            project,
            shop: await getShopById(project.data.shopId),
          }))
        );
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

  return (
    <PageShell title="大马饭团" subtitle="今日上架">
      {loading ? <p className="text-sm text-gray-600">加载中…</p> : null}
      {err ? <p className="mb-3 text-sm text-red-600">{err}</p> : null}
      {!loading && rows.length === 0 ? (
        <p className="text-sm text-gray-600">暂时还没有上架项目。</p>
      ) : null}
      <div className="space-y-3">
        {rows.map(({ project, shop }) => {
          const img = pickCover(project) || shop?.data.bannerImage || shop?.data.logoImage;
          return (
            <article key={project.id} className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
              {img ? (
                <img src={img} alt="" className="h-40 w-full object-cover" loading="lazy" />
              ) : null}
              <div className="p-4">
                <p className="mb-1 text-xs text-gray-500">{shop?.data.name ?? '店铺'}</p>
                <h2 className="text-lg font-bold text-gray-900">{project.data.title || '未命名项目'}</h2>
                <p className="mt-2 text-sm leading-relaxed text-gray-600 line-clamp-3">
                  {project.data.textContent?.replace(/\s+/g, ' ').trim() || '点击查看团购详情。'}
                </p>
                <div className="mt-3">
                  <Link
                    to={`/feituan/projects/${encodeURIComponent(project.id)}`}
                    className="inline-flex rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white"
                  >
                    查看饭团项目
                  </Link>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </PageShell>
  );
}
