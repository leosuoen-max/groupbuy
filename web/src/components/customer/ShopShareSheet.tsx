import { H5_COLUMN_CLASS } from '../../lib/shopTheme';

export type ShopShareSheetProps = {
  open: boolean;
  onClose: () => void;
  /** 展示用，如「店名 · 项目」 */
  headline: string;
  copied: boolean;
  onCopyLink: () => void;
  /** 浏览器支持 Web Share API 时显示 */
  showSystemShare: boolean;
  onSystemShare: () => void;
};

export function ShopShareSheet({
  open,
  onClose,
  headline,
  copied,
  onCopyLink,
  showSystemShare,
  onSystemShare,
}: ShopShareSheetProps) {
  if (!open) return null;

  return (
    <div className="pointer-events-auto fixed inset-0 z-40 bg-black/25">
      <button
        type="button"
        className="absolute inset-0 h-full w-full"
        aria-label="关闭分享"
        onClick={onClose}
      />
      <div
        className={`absolute inset-x-0 bottom-0 mx-auto w-full rounded-t-2xl bg-white p-4 shadow-2xl ${H5_COLUMN_CLASS}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shop-share-sheet-title"
      >
        <div id="shop-share-sheet-title" className="mb-1 text-center text-sm font-semibold text-gray-900">
          分享
        </div>
        <p className="mb-3 line-clamp-2 px-1 text-center text-xs text-gray-500">{headline}</p>
        <div className="space-y-2">
          <button
            type="button"
            onClick={onCopyLink}
            className="flex w-full items-center justify-center rounded-xl border border-gray-200 bg-gray-50 py-3 text-sm font-semibold text-gray-900 active:bg-gray-100"
          >
            {copied ? '✓ 已复制链接' : '复制链接'}
          </button>
          {showSystemShare ? (
            <button
              type="button"
              onClick={onSystemShare}
              className="flex w-full items-center justify-center rounded-xl border border-gray-900 bg-gray-900 py-3 text-sm font-semibold text-white active:bg-gray-800"
            >
              更多分享方式…
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl py-2.5 text-sm text-gray-600 active:bg-gray-50"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
