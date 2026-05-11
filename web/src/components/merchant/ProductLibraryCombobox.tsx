import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProductLibraryRow } from '../../lib/productLibraryService';

type Props = {
  items: ProductLibraryRow[];
  kindFilter: 'product' | 'bundle_scheme' | 'bundle_option';
  value: string;
  onChangeValue: (next: string) => void;
  onPickRow: (row: ProductLibraryRow) => void;
  disabled?: boolean;
  placeholder?: string;
  inputClassName: string;
  /** 供校验滚动/聚焦（如 `validation-scheme-dup:…`） */
  inputId?: string;
  className?: string;
};

/** 在名称输入框内输入即筛选商品库，下拉点选套用 */
export function ProductLibraryCombobox({
  items,
  kindFilter,
  value,
  onChangeValue,
  onPickRow,
  disabled,
  placeholder = '名称',
  inputClassName,
  inputId,
  className = '',
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const pool = items.filter((r) => r.data.kind === kindFilter);
    const s = value.trim().toLowerCase();
    if (!s) return pool.slice(0, 40);
    return pool
      .filter((r) => r.data.name.toLowerCase().includes(s))
      .slice(0, 60);
  }, [items, kindFilter, value]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const showList = open && (filtered.length > 0 || value.trim().length > 0);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <input
        id={inputId}
        type="text"
        disabled={disabled}
        className={inputClassName}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChangeValue(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        autoComplete="off"
      />
      {showList ? (
        <ul className="absolute z-30 mt-0.5 max-h-52 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 text-xs shadow-lg">
          {filtered.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="flex w-full items-start gap-2 px-2 py-1.5 text-left hover:bg-indigo-50"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPickRow(r);
                  setOpen(false);
                }}
              >
                {r.data.imageUrl ? (
                  <img
                    src={r.data.imageUrl}
                    alt=""
                    className="h-8 w-8 shrink-0 rounded object-cover"
                  />
                ) : (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-gray-100 text-[10px] text-gray-400">
                    {kindFilter === 'bundle_scheme'
                      ? '套'
                      : kindFilter === 'bundle_option'
                        ? '选'
                        : '库'}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-gray-900">{r.data.name}</span>
                  {kindFilter === 'bundle_option' ? null : (
                    <span className="ml-1 tabular-nums text-gray-600">
                      RM {Number(r.data.retailPrice ?? 0).toFixed(2)}
                    </span>
                  )}
                  {r.data.note ? (
                    <span className="mt-0.5 block truncate text-[10px] text-gray-500">
                      {r.data.note}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
          {filtered.length === 0 && value.trim() ? (
            <li className="px-2 py-2 text-[11px] text-gray-500">
              无匹配商品名，可直接使用当前输入；发布后会写入商品库。
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
