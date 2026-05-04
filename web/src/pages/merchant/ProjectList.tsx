import { useParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';

export default function ProjectList() {
  const { shopSlug } = useParams<{ shopSlug: string }>();
  return (
    <PageShell
      title="商户 · 项目列表"
      subtitle={`/dashboard/${shopSlug}/projects`}
    >
      <p style={{ margin: 0, opacity: 0.88 }}>
        占位：草稿 / 已发布 / 已截止（见 docs/04）。
      </p>
    </PageShell>
  );
}
