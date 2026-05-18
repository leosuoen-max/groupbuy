type PaymentMethod = { id: string; name: string; qrCodeUrl: string };

type Props = {
  methods: PaymentMethod[];
  uploading: boolean;
  uploadErr: string | null;
  onPickFile: () => void;
  uploadButtonLabel?: string;
  hint?: string;
};

export function FeituanTransferPaymentBlock({
  methods,
  uploading,
  uploadErr,
  onPickFile,
  uploadButtonLabel = '上传付款截图',
  hint = '请按「应付合计」转账。可上传一张截图，将同步到本批所有订单。',
}: Props) {
  const primary = methods[0];

  return (
    <section className="rounded-xl border border-indigo-100 bg-indigo-50/40 px-3 py-3">
      <h2 className="mb-2 text-sm font-semibold text-indigo-900">
        支付方法二：转账、上传付款截图
      </h2>
      <div className="flex gap-3">
        <div className="w-[6.5rem] shrink-0">
          {primary?.qrCodeUrl ? (
            <>
              <div className="overflow-hidden rounded-xl border border-indigo-100 bg-white shadow-sm">
                <img
                  src={primary.qrCodeUrl}
                  alt={primary.name}
                  className="aspect-square w-[6.5rem] object-cover"
                  loading="lazy"
                />
              </div>
              <p className="mt-1 text-center text-[11px] text-indigo-900/80">
                {primary.name}
              </p>
            </>
          ) : (
            <div className="flex aspect-square w-[6.5rem] items-center justify-center rounded-xl border border-dashed border-indigo-200 bg-white text-[11px] text-indigo-500">
              暂无收款码
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="mb-2 text-xs leading-relaxed text-indigo-900/80">{hint}</p>
          <button
            type="button"
            disabled={uploading}
            onClick={onPickFile}
            className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-indigo-600 px-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {uploading ? '上传中…' : uploadButtonLabel}
          </button>
          {uploadErr ? (
            <p className="mt-2 text-xs text-red-600">{uploadErr}</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
