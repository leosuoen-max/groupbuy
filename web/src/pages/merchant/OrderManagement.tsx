import { useParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';

export default function OrderManagement() {
  const { shopSlug } = useParams<{ shopSlug: string }>();
  return (
    <PageShell
      title="商户 · 订单管理"
      subtitle={`/dashboard/${shopSlug}/orders（项目可由 query 指定）`}
    >
      <p style={{ margin: 0, opacity: 0.88 }}>
        占位：待核实 / 已确认 / 全部 / 对账单（见 docs/04）。
      </p>
    </PageShell>
  );
}
