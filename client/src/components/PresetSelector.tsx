import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { EngineConfiguration } from '../../../shared/engineTypes';
import { PRESET_GROUPS, PRESET_OPTIONS, findPreset, typeAheadMatch } from './presetMenu';

interface PresetSelectorProps {
  onSelect: (config: EngineConfiguration) => void;
}

const TOOLTIP_WIDTH = 260;
const TYPEAHEAD_RESET_MS = 600;

/**
 * Preset menu: a button + listbox (WAI-ARIA select-only combobox pattern) so each entry can show a
 * short name and reveal the full name and description in a tooltip on hover or keyboard focus.
 * A native <select> cannot do that: Chromium ignores <option title> in the open popup.
 */
export function PresetSelector({ onSelect }: PresetSelectorProps) {
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const tooltipId = `${baseId}-tooltip`;
  const optionId = (index: number) => `${baseId}-opt-${index}`;

  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [tipPos, setTipPos] = useState<{ left: number; top: number } | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typeAhead = useRef({ query: '', at: 0 });
  // Last real pointer position: scrolling the list under a still pointer fires synthetic mouse
  // events, which must not steal the highlight from keyboard navigation.
  const pointer = useRef({ x: -1, y: -1 });

  const selectedOption = selected ? findPreset(selected) : undefined;
  const activeOption = active >= 0 ? PRESET_OPTIONS[active] : undefined;

  const openMenu = (index: number) => {
    setActive(index);
    setOpen(true);
  };

  const closeMenu = (returnFocus: boolean) => {
    setOpen(false);
    setTipPos(null);
    if (returnFocus) buttonRef.current?.focus();
  };

  const choose = (index: number) => {
    const option = PRESET_OPTIONS[index];
    if (!option) return;
    setSelected(option.value);
    onSelect(option.config);
    closeMenu(true);
  };

  const selectedIndex = () => PRESET_OPTIONS.findIndex((o) => o.value === selected);

  // Focus the listbox when it opens; keep the active option in view and place its tooltip.
  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  const placeTooltip = () => {
    const el = open && active >= 0 ? document.getElementById(optionId(active)) : null;
    const list = listRef.current;
    if (!el || !list) return setTipPos(null);
    const r = el.getBoundingClientRect();
    const lr = list.getBoundingClientRect();
    if (r.bottom < lr.top || r.top > lr.bottom) return setTipPos(null);
    const gap = 6;
    let left = lr.right + gap;
    if (left + TOOLTIP_WIDTH > window.innerWidth - 8) left = lr.left - gap - TOOLTIP_WIDTH;
    if (left < 8) left = Math.max(8, Math.min(r.left + 16, window.innerWidth - TOOLTIP_WIDTH - 8));
    const top = left === lr.right + gap || left === lr.left - gap - TOOLTIP_WIDTH ? r.top : r.bottom + gap;
    // Keep it on screen: the box is about 100 px tall with a three-line description.
    setTipPos({ left, top: Math.max(8, Math.min(top, window.innerHeight - 110)) });
  };

  useLayoutEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
    placeTooltip();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  // Click outside closes without stealing focus from whatever was clicked.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) closeMenu(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const onButtonKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const current = selectedIndex();
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openMenu(current >= 0 ? current : 0);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      openMenu(current >= 0 ? current : PRESET_OPTIONS.length - 1);
    }
  };

  const onListKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const last = PRESET_OPTIONS.length - 1;
    if (e.key.length > 1) typeAhead.current.query = '';
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive((i) => Math.min(last, i + 1));
        return;
      case 'ArrowUp':
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        return;
      case 'Home':
        e.preventDefault();
        setActive(0);
        return;
      case 'End':
        e.preventDefault();
        setActive(last);
        return;
      case 'Enter':
        e.preventDefault();
        choose(active);
        return;
      case ' ':
        e.preventDefault();
        // Space inside a type-ahead query is part of the query ("FA20 + Vortech").
        if (typeAhead.current.query && Date.now() - typeAhead.current.at < TYPEAHEAD_RESET_MS) typeAheadKey(' ');
        else choose(active);
        return;
      case 'Escape':
        e.preventDefault();
        closeMenu(true);
        return;
      case 'Tab':
        closeMenu(false);
        return;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          typeAheadKey(e.key);
        }
    }
  };

  const typeAheadKey = (key: string) => {
    const now = Date.now();
    const t = typeAhead.current;
    t.query = now - t.at > TYPEAHEAD_RESET_MS ? key : t.query + key;
    t.at = now;
    const match = typeAheadMatch(PRESET_OPTIONS, t.query, active);
    if (match >= 0) setActive(match);
  };

  let index = -1;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 id={`${baseId}-label`} className="text-xs font-medium font-[Rajdhani] text-foreground/80 uppercase tracking-wide">
          Presets
        </h3>
        <div className="flex-1 h-px bg-hud-line/30" />
      </div>
      <div ref={rootRef} className="relative">
        <button
          ref={buttonRef}
          type="button"
          data-testid="preset-trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-label={selectedOption ? `Preset: ${selectedOption.accessibleName}` : 'Load a preset'}
          title={selectedOption?.name}
          onClick={() => (open ? closeMenu(true) : openMenu(Math.max(0, selectedIndex())))}
          onKeyDown={onButtonKeyDown}
          className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-hud-line bg-dark-surface px-3 text-left text-sm font-[Rajdhani] text-foreground outline-none focus-visible:border-neon-cyan focus-visible:ring-1 focus-visible:ring-neon-cyan/60"
        >
          <span className={`truncate ${selectedOption ? '' : 'text-muted-foreground'}`}>
            {selectedOption ? selectedOption.shortName : 'Load a preset...'}
          </span>
          <svg aria-hidden="true" viewBox="0 0 16 16" className={`h-3.5 w-3.5 shrink-0 text-foreground/60 transition-transform ${open ? 'rotate-180' : ''}`}>
            <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>

        {/* Always rendered (hidden when closed) so automation can enumerate option values. */}
        <div
          ref={listRef}
          id={listboxId}
          data-testid="preset-listbox"
          role="listbox"
          tabIndex={-1}
          aria-labelledby={`${baseId}-label`}
          aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
          hidden={!open}
          onKeyDown={onListKeyDown}
          onScroll={placeTooltip}
          onMouseLeave={() => setTipPos(null)}
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[420px] overflow-y-auto rounded-md border border-hud-line bg-dark-elevated py-1 shadow-lg outline-none focus-visible:ring-1 focus-visible:ring-neon-cyan/60"
        >
          {PRESET_GROUPS.map((group) => (
            <div key={group.id} role="group" aria-labelledby={`${baseId}-group-${group.id}`}>
              <div
                id={`${baseId}-group-${group.id}`}
                role="presentation"
                className="px-3 pb-0.5 pt-2 text-[10px] font-medium font-[Rajdhani] uppercase tracking-wide text-foreground/50"
              >
                {group.label}
              </div>
              {group.options.map((option) => {
                index += 1;
                const i = index;
                const isActive = i === active;
                const isSelected = option.value === selected;
                return (
                  <div
                    key={option.value}
                    id={optionId(i)}
                    role="option"
                    data-value={option.value}
                    aria-selected={isSelected}
                    aria-label={option.accessibleName}
                    aria-describedby={`${optionId(i)}-desc`}
                    onMouseMove={(e) => {
                      if (e.clientX === pointer.current.x && e.clientY === pointer.current.y) return;
                      pointer.current = { x: e.clientX, y: e.clientY };
                      if (i !== active) setActive(i);
                      else if (!tipPos) placeTooltip();
                    }}
                    // Keep focus on the listbox while clicking.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(i)}
                    className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-1 text-sm font-[Rajdhani] ${
                      isActive ? 'bg-neon-cyan/15 text-neon-cyan' : 'text-foreground'
                    }`}
                  >
                    <span className="truncate">{option.shortName}</span>
                    <span id={`${optionId(i)}-desc`} className="sr-only">{option.description}</span>
                    {isSelected && (
                      <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3 w-3 shrink-0">
                        <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.75" />
                      </svg>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Portalled: the side panels form their own stacking contexts and would paint over it. */}
        {open && activeOption && tipPos && createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            data-testid="preset-tooltip"
            style={{ position: 'fixed', left: tipPos.left, top: tipPos.top, width: TOOLTIP_WIDTH }}
            className="pointer-events-none z-[60] rounded-md border border-hud-line bg-dark-surface px-2.5 py-1.5 font-[Rajdhani] shadow-lg"
          >
            <div className="text-sm font-semibold text-foreground">{activeOption.name}</div>
            <div className="text-xs leading-snug text-muted-foreground">
              {activeOption.description}
            </div>
          </div>,
          document.body,
        )}
      </div>
    </div>
  );
}
