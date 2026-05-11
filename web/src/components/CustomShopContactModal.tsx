import { getCustomShopContactLine } from '../config/siteContact';
import { H5_COLUMN_CLASS } from '../lib/shopTheme';

type CustomShopContactModalProps = {
  open: boolean;
  onClose: () => void;
};

/** 顾客端：点按后展示定制店铺联系方式（微信/电话等） */
export function CustomShopContactModal({ open, onClose }: CustomShopContactModalProps) {
  if (!open) return null;

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-[45] flex flex-col justify-end bg-black/25"
      role="dialog"
      aria-modal="true"
      aria-labelledby="custom-shop-contact-title"
    >
      <button type="button" className="absolute inset-0" aria-label="关闭" onClick={onClose} />
      <div
        className={`relative mx-auto w-full rounded-t-2xl bg-white p-4 pb-[calc(16px+env(safe-area-inset-bottom,0px))] shadow-2xl ${H5_COLUMN_CLASS}`}
      >
        <h2 id="custom-shop-contact-title" className="text-center text-sm font-semibold text-gray-900">
          联系方式
        </h2>
        <p className="mt-3 whitespace-pre-wrap break-words text-center text-sm leading-relaxed text-gray-800">
          {getCustomShopContactLine()}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          关闭
        </button>
      </div>
    </div>
  );
}
