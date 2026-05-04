import { useParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';

export default function OrderDetail() {
  const { shopSlug, projectId, orderId } = useParams<{
    shopSlug: string;
    projectId: string;
    orderId: string;
  }>();
  return (
    <PageShell
      title="顾客 · 订单详情"
      subtitle={`orderId=${orderId ?? '?'}`}
    >
      <p style={{ margin: 0, opacity: 0.88 }}>
        shopSlug={shopSlug} · projectId={projectId}
      </p>
      <p style={{ margin: '12px 0 0', opacity: 0.88 }}>
        占位：截图上传、加菜、状态（见 docs/03）。
      </p>
    </PageShell>
  );
}
