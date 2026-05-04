import { useParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';

export default function DeliveryPoints() {
  const { shopSlug } = useParams<{ shopSlug: string }>();
  return (
    <PageShell
      title="商户 · 配送点管理"
      subtitle={`/dashboard/${shopSlug}/delivery-points`}
    >
      <p style={{ margin: 0, opacity: 0.88 }}>
        占位：店铺级配送点库（见 docs/04）。
      </p>
    </PageShell>
  );
}
