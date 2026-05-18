import { Link } from 'react-router-dom';
import { FEITUAN_TW } from '../../lib/feituanHomeTheme';

type Props = {
  backTo: string;
  backLabel: string;
  title: string;
  subtitle?: string;
};

export function FeituanFlowHeader({ backTo, backLabel, title, subtitle }: Props) {
  return (
    <header className="sticky top-0 z-30 border-b border-[#D8F0E4] bg-white/95 px-4 py-2.5 backdrop-blur">
      <Link to={backTo} className={FEITUAN_TW.backLink}>
        ← {backLabel}
      </Link>
      <h1 className="mt-0.5 text-base font-bold text-gray-900">{title}</h1>
      {subtitle ? <p className="text-xs text-gray-500">{subtitle}</p> : null}
    </header>
  );
}
