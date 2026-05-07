import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';

/**
 * 兼容旧路由：
 * /shop/:shopSlug/:projectId/orders/:orderId/add-items
 * 统一跳转到主商品页加购模式（appendOrder）。
 */
export default function OrderAppend() {
  const { shopSlug = '', projectId = '', orderId = '' } = useParams<{
    shopSlug: string;
    projectId: string;
    orderId: string;
  }>();
  const navigate = useNavigate();
  const base = `/shop/${encodeURIComponent(shopSlug)}/${encodeURIComponent(projectId)}`;
  const target = `${base}?appendOrder=${encodeURIComponent(orderId)}`;

  useEffect(() => {
    navigate(target, { replace: true });
  }, [navigate, target]);

  return (
    <PageShell title="加购" subtitle="跳转中…">
      <p className="text-sm text-gray-600">正在跳转到商品页加购模式…</p>
      <Link
        className="mt-2 inline-block text-sm text-indigo-600 underline-offset-2 hover:underline"
        to={target}
      >
        如未自动跳转，请点这里
      </Link>
    </PageShell>
  );
}
