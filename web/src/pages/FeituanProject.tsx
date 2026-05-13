import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageShell } from '../components/PageShell';
import { getProject, type ProjectRow } from '../lib/projectService';
import { getShopById, type ShopRow } from '../lib/shopService';

function stripText(s: string | undefined): string {
  return (s ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export default function FeituanProject() {
  const { projectId = '' } = useParams<{ projectId: string }>();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [shop, setShop] = useState<ShopRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setErr(null);
      try {
        const row = await getProject(decodeURIComponent(projectId));
        if (!row || row.data.feituanStatus !== 'listed') {
          if (!cancelled) setErr('饭团项目不存在或尚未上架。');
          return;
        }
        const shopRow = await getShopById(row.data.shopId);
        if (!cancelled) {
          setProject(row);
          setShop(shopRow);
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : '加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <PageShell title="饭团项目" subtitle={shop?.data.name ?? '大马饭团'}>
      <Link to="/feituan" className="mb-3 inline-block text-sm text-indigo-600">
        ← 返回大马饭团
      </Link>
      {loading ? <p className="text-sm text-gray-600">加载中…</p> : null}
      {err ? <p className="text-sm text-red-600">{err}</p> : null}
      {project ? (
        <div className="space-y-4">
          <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <p className="mb-1 text-xs text-gray-500">{shop?.data.name ?? '店铺'}</p>
            <h1 className="text-2xl font-bold text-gray-900">{project.data.title || '未命名项目'}</h1>
            {stripText(project.data.textContent) ? (
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                {stripText(project.data.textContent)}
              </p>
            ) : null}
          </section>
          <section className="rounded-2xl border border-orange-100 bg-orange-50 p-4 text-sm leading-relaxed text-orange-950">
            饭团下单与收款确认将在下一阶段开放。当前页面用于展示已上架饭团项目，避免顾客继续使用店铺自有参团入口。
          </section>
        </div>
      ) : null}
    </PageShell>
  );
}
