import { useParams } from 'react-router-dom';
import { PageShell } from '../components/PageShell';

export default function InviteAccept() {
  const { code } = useParams<{ code: string }>();
  return (
    <PageShell
      title="管理员邀请"
      subtitle={`邀请码：${code ?? '（无）'} · 占位（见 docs/02、04）`}
    />
  );
}
