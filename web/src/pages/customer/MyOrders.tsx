import { useParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';

export default function MyOrders() {
  const { shopSlug, projectId } = useParams<{
    shopSlug: string;
    projectId: string;
  }>();
  return (
    <PageShell
      title="顾客 · 我的订单"
      subtitle={`/shop/${shopSlug}/${projectId}/my-orders`}
    >
      <p style={{ margin: 0, opacity: 0.88 }}>
        占位：多订单列表（见 docs/03）。
      </p>
    </PageShell>
  );
}
