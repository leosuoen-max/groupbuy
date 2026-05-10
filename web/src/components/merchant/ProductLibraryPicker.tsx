import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProductLibraryRow } from '../../lib/productLibraryService';

type Props = {
  items: ProductLibraryRow[];
  kindFilter: 'product' | 'bundle_scheme';
  disabled?: boolean;
  onPick: (row: ProductLibraryRow) => void;
  className?: string;
};

export function ProductLibraryPicker({
  items,
  kindFilter,
  disabled,
  onPick,
  className = '',
}: Props) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const pool = items.filter((r) => r.data.kind === kindFilter);
    const s = q.trim().toLowerCase();
    if (!s) return pool.slice(0, 40);
    return pool
      .filter(
        (r) =>
          r.data.name.toLowerCase().includes(s) ||
          (r.data.note && r.data.note.toLowerCase().includes(s))
      )
      .slice(0, 60);
  }, [items, kindFilter, q]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <input
        type="text"
        disabled={disabled}
        className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-800 placeholder:text-gray-400"
        placeholder="从商品库按名称搜索并套用…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && filtered.length > 0 ? (
        <ul className="absolute z-30 mt-0.5 max-h-52 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 text-xs shadow-lg">
          {filtered.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="flex w-full items-start gap-2 px-2 py-1.5 text-left hover:bg-indigo-50"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(r);
                  setQ('');
                  setOpen(false);
                }}
              >
                {r.data.imageUrl && kindFilter === 'product' ? (
                  <img
                    src={r.data.imageUrl}
                    alt=""
                    className="h-8 w-8 shrink-0 rounded object-cover"
                  />
                ) : (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-gray-100 text-[10px] text-gray-400">
                    {kindFilter === 'bundle_scheme' ? '套' : '库'}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-gray-900">{r.data.name}</span>
                  <span className="ml-1 tabular-nums text-gray-600">
                    RM {Number(r.data.retailPrice ?? 0).toFixed(2)}
                  </span>
                  {r.data.note ? (
                    <span className="mt-0.5 block truncate text-[10px] text-gray-500">
                      {r.data.note}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {open && q.trim() && filtered.length === 0 ? (
        <div className="absolute z-30 mt-0.5 w-full rounded-lg border border-gray-100 bg-white px-2 py-2 text-[11px] text-gray-500 shadow">
          无匹配项，可手动填写或到「产品库」页添加。
        </div>
      ) : null}
    </div>
  );
}
