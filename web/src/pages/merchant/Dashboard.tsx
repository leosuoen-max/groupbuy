import { useParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';

export default function MerchantDashboard() {
  const { shopSlug } = useParams<{ shopSlug: string }>();
  return (
    <PageShell
      title="商户 · Dashboard"
      subtitle={`/dashboard/${shopSlug ?? '?'}`}
    >
      <p style={{ margin: 0, opacity: 0.88 }}>
        占位：今日数据、快捷操作（见 docs/04）。
      </p>
    </PageShell>
  );
}
