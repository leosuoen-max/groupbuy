import { useParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';

export default function ShopHome() {
  const { shopSlug, projectId } = useParams<{
    shopSlug: string;
    projectId: string;
  }>();
  return (
    <PageShell
      title="顾客 · 项目首页"
      subtitle={`shopSlug=${shopSlug ?? '?'}`}
    >
      <p style={{ margin: 0 }}>projectId={projectId ?? '?'}</p>
      <p style={{ margin: '12px 0 0', opacity: 0.88 }}>
        占位：抬头区、内容区、商品清单、底栏（见 docs/03）。
      </p>
    </PageShell>
  );
}
