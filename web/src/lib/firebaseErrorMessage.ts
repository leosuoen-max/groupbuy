import { FirebaseError } from 'firebase/app';

export function toLoadErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof FirebaseError)) return fallback;

  switch (error.code) {
    case 'permission-denied':
      return '没有读取权限，请检查 Firestore 规则。';
    case 'failed-precondition':
      return '数据库索引未配置，请按控制台提示创建索引后重试。';
    case 'unavailable':
      return '网络不可用，请稍后重试。';
    case 'unauthenticated':
      return '当前会话未认证，请刷新页面后重试。';
    default:
      return `${fallback}（${error.code}）`;
  }
}
