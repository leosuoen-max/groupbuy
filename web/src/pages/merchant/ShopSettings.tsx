import { useParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';

export default function ShopSettings() {
  const { shopSlug } = useParams<{ shopSlug: string }>();
  return (
    <PageShell
      title="商户 · 店铺设置"
      subtitle={`/dashboard/${shopSlug}/settings`}
    >
      <p style={{ margin: 0, opacity: 0.88 }}>
        占位：店名、Logo、门头、主题色、付款码（见 docs/04）。
      </p>
    </PageShell>
  );
}
