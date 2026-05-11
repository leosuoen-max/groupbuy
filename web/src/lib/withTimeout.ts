/** 为 Firebase 等无内置超时的 Promise 增加超时，避免弱网下界面永久停在「加载中」 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label}超时（约 ${Math.round(ms / 1000)} 秒），请检查网络后重试`));
    }, ms);
    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        window.clearTimeout(timer);
        reject(err);
      });
  });
}
