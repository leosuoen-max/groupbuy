type StatusTone = 'confirmed' | 'pending' | 'unpaid' | 'cancelled' | 'neutral';

type Props = {
  tone: StatusTone;
  label: string;
  className?: string;
};

function toneClass(tone: StatusTone): string {
  if (tone === 'confirmed') return 'bg-emerald-100 text-emerald-900';
  if (tone === 'pending') return 'bg-sky-100 text-sky-900';
  if (tone === 'unpaid') return 'bg-amber-100 text-amber-900';
  if (tone === 'cancelled') return 'bg-gray-200 text-gray-700';
  return 'bg-gray-100 text-gray-700';
}

export function StatusChip({ tone, label, className }: Props) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${toneClass(
        tone
      )} ${className ?? ''}`.trim()}
    >
      {label}
    </span>
  );
}
