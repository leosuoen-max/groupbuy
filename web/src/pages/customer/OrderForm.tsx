import { useParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';

export default function OrderForm() {
  const { shopSlug, projectId } = useParams<{
    shopSlug: string;
    projectId: string;
  }>();
  return (
    <PageShell
      title="顾客 · 下单"
      subtitle={`/shop/${shopSlug}/${projectId}/order`}
    >
      <p style={{ margin: 0, opacity: 0.88 }}>
        占位：选菜 → 填信息 → 选配送点 → 提交（见 docs/03）。
      </p>
    </PageShell>
  );
}
