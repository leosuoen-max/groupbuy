type Props = {
  title: string;
  hint?: string;
  className?: string;
};

export function EmptyStateCard({ title, hint, className }: Props) {
  return (
    <div
      className={`rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center ${className ?? ''}`.trim()}
    >
      <p className="text-sm font-medium text-gray-700">{title}</p>
      {hint ? <p className="mt-1 text-xs text-gray-500">{hint}</p> : null}
    </div>
  );
}
