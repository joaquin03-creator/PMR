import { Material } from '../types';
import { filterAndSortMaterials } from '../lib/materialSearch';
import { formatUnitPrice } from '../lib/scrapPricing';

interface MaterialAutocompleteInputProps {
  /** Unique id for this row/instance -- used to build DOM element ids for focus management. */
  id: string;
  materials: Material[];
  value: Material | null;
  isOpen: boolean;
  searchValue: string;
  onOpenChange: (open: boolean) => void;
  onSearchChange: (value: string) => void;
  onSelect: (material: Material) => void;
  placeholder?: string;
  /** Show each result's buy price, matching Quick Ticket. Off by default -- most new uses (e.g. the inventory sheet) don't need pricing here. */
  showPrice?: boolean;
}

// Mirrors QuickTicketModal's material search field exactly (same
// filterAndSortMaterials algorithm, same code-priority sort, same
// single-match auto-select, same Tab/Enter/Escape behavior) so that typing a
// material anywhere in the app feels identical. QuickTicketModal keeps its
// own inline copy of this UI -- deliberately not refactored to use this
// component, to avoid any risk to that already-proven, heavily-used flow.
export function MaterialAutocompleteInput({
  id,
  materials,
  value,
  isOpen,
  searchValue,
  onOpenChange,
  onSearchChange,
  onSelect,
  placeholder = 'Type code or material...',
  showPrice = false,
}: MaterialAutocompleteInputProps) {
  const searchTrimmed = (searchValue || '').trim();
  const filteredMaterials = filterAndSortMaterials(materials, searchValue || '');
  const visibleResults = filteredMaterials.slice(0, 6);
  const remainingCount = filteredMaterials.length - visibleResults.length;

  const handleSelect = (m: Material) => {
    onSelect(m);
    onOpenChange(false);
    onSearchChange('');
    setTimeout(() => {
      const matBtn = document.getElementById(`material-autocomplete-btn-${id}`);
      if (matBtn) matBtn.focus();
    }, 50);
  };

  if (value && !isOpen) {
    return (
      <button
        type="button"
        id={`material-autocomplete-btn-${id}`}
        onClick={() => {
          onOpenChange(true);
          onSearchChange('');
          setTimeout(() => {
            const input = document.querySelector(`[data-material-autocomplete-id="${id}"]`) as HTMLInputElement | null;
            if (input) {
              input.focus();
              input.click();
            }
          }, 50);
        }}
        className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-left font-bold text-sm flex items-center justify-between hover:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-colors group cursor-pointer"
      >
        <div className="flex items-center gap-2 truncate">
          {value.code && (
            <span className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 text-slate-700 font-mono text-[10px] font-black rounded-md shrink-0">
              {value.code}
            </span>
          )}
          <span className="truncate text-slate-900">{value.name}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          {showPrice && (
            <span className="text-slate-500 font-mono text-[11px] font-semibold shrink-0">
              {formatUnitPrice(value.buyPrice, value.unit, value.category, value.name)}
            </span>
          )}
          <span className="text-[11px] font-bold text-slate-400 group-hover:text-amber-600 transition-colors">
            Change
          </span>
        </div>
      </button>
    );
  }

  return (
    <div className="relative">
      <input
        data-material-autocomplete
        data-material-autocomplete-id={id}
        type="text"
        placeholder={placeholder}
        className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold placeholder:text-slate-400 placeholder:font-normal outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-all"
        value={searchValue || ''}
        onChange={(e) => {
          const newSearch = e.target.value;
          onSearchChange(newSearch);
          onOpenChange(true);
          if (newSearch.trim().length > 0) {
            const matches = filterAndSortMaterials(materials, newSearch);
            if (matches.length === 1) {
              handleSelect(matches[0]);
            }
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Tab' || e.key === 'Enter') {
            const currentMatches = filterAndSortMaterials(materials, searchValue || '');
            if (currentMatches.length > 0) {
              e.preventDefault();
              handleSelect(currentMatches[0]);
            }
          }
          if (e.key === 'Escape') {
            onOpenChange(false);
            setTimeout(() => {
              const matBtn = document.getElementById(`material-autocomplete-btn-${id}`);
              if (matBtn) matBtn.focus();
            }, 50);
          }
        }}
        onBlur={() => {
          setTimeout(() => {
            if (value) {
              onOpenChange(false);
              onSearchChange('');
            }
          }, 200);
        }}
      />

      {searchTrimmed.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
          {filteredMaterials.length === 0 ? (
            <p className="py-2.5 px-3 text-xs text-slate-400 text-center font-medium">
              No materials match "{searchValue}"
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {visibleResults.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onTouchStart={(e) => e.preventDefault()}
                  onClick={() => handleSelect(m)}
                  className="w-full py-1.5 px-3 text-left hover:bg-amber-50 active:bg-amber-100 flex items-center justify-between cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0 truncate">
                    {m.code && (
                      <span className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 text-slate-700 font-mono text-[10px] font-black rounded shrink-0">
                        {m.code}
                      </span>
                    )}
                    <span className="truncate text-xs font-bold text-slate-800">{m.name}</span>
                  </div>
                  {showPrice && (
                    <span className="text-slate-500 font-mono text-[11px] font-semibold shrink-0 ml-2">
                      {formatUnitPrice(m.buyPrice, m.unit, m.category, m.name)}
                    </span>
                  )}
                </button>
              ))}
              {remainingCount > 0 && (
                <div className="py-1 px-3 text-center text-[10px] font-semibold text-slate-400 bg-slate-50">
                  {remainingCount} more result{remainingCount === 1 ? '' : 's'} &mdash; keep typing
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
