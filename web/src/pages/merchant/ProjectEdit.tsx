import { useParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';

export default function ProjectEdit() {
  const { shopSlug, projectId } = useParams<{
    shopSlug: string;
    projectId: string;
  }>();
  const isNew = projectId === 'new';
  return (
    <PageShell
      title={isNew ? '商户 · 新建项目' : '商户 · 编辑项目'}
      subtitle={
        isNew
          ? `/dashboard/${shopSlug}/projects/new`
          : `/dashboard/${shopSlug}/projects/${projectId}`
      }
    >
      <p style={{ margin: 0, opacity: 0.88 }}>
        占位：完整编辑表单（见 docs/04）。
      </p>
    </PageShell>
  );
}
