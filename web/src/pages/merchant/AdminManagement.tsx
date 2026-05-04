import { useParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';

export default function AdminManagement() {
  const { shopSlug } = useParams<{ shopSlug: string }>();
  return (
    <PageShell
      title="商户 · 管理员管理"
      subtitle={`/dashboard/${shopSlug}/admins`}
    >
      <p style={{ margin: 0, opacity: 0.88 }}>
        占位：邀请链接、角色（见 docs/04、02）。
      </p>
    </PageShell>
  );
}
