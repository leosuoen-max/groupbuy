import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { getAuthClient } from '../lib/firebase';

type SignOutButtonProps = {
  returnTo?: string;
  className?: string;
  children?: React.ReactNode;
};

export function SignOutButton({
  returnTo = '/dashboard',
  className,
  children,
}: SignOutButtonProps) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const handle = async () => {
    setBusy(true);
    try {
      await signOut(getAuthClient());
      navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`, { replace: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void handle()}
      className={
        className ??
        'text-sm font-medium text-gray-600 underline-offset-2 hover:text-gray-900 hover:underline disabled:opacity-50'
      }
    >
      {busy ? '退出中…' : children ?? '退出登录'}
    </button>
  );
}
