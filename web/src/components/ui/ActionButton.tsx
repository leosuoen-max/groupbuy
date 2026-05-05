import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'danger';
type Size = 'sm' | 'md';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  children: ReactNode;
};

function variantClass(variant: Variant): string {
  if (variant === 'primary') {
    return 'bg-gray-900 text-white disabled:bg-gray-300 disabled:text-white';
  }
  if (variant === 'danger') {
    return 'bg-red-600 text-white disabled:bg-red-300 disabled:text-white';
  }
  return 'border border-gray-200 bg-white text-gray-900 disabled:bg-gray-100 disabled:text-gray-500';
}

function sizeClass(size: Size): string {
  return size === 'sm' ? 'h-9 px-3 text-xs font-semibold' : 'h-10 px-4 text-sm font-semibold';
}

export function ActionButton({
  variant = 'secondary',
  size = 'md',
  fullWidth = false,
  className,
  children,
  ...props
}: Props) {
  const cls = [
    'inline-flex items-center justify-center rounded-xl transition',
    'disabled:cursor-not-allowed',
    variantClass(variant),
    sizeClass(size),
    fullWidth ? 'w-full' : '',
    className ?? '',
  ]
    .join(' ')
    .trim();

  return (
    <button {...props} className={cls}>
      {children}
    </button>
  );
}
