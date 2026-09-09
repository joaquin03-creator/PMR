import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { HelpCircle, X } from 'lucide-react';

export interface HintProps {
  text: string;
  title?: string;
  tabIndex?: number;
  className?: string;
  align?: 'left' | 'right' | 'center';
}

export const Hint: React.FC<HintProps> = ({
  text,
  title,
  tabIndex = 0,
  className = '',
  align = 'left'
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const popoverEl = popoverRef.current;

    // Default dimensions if popover is not yet measured in DOM
    const popoverWidth = popoverEl ? popoverEl.offsetWidth : 256;
    const popoverHeight = popoverEl ? popoverEl.offsetHeight : 100;

    const margin = 12;
    const gap = 6;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // FIX 2: Horizontal edge-aware positioning
    let left: number;
    if (align === 'right' || rect.left > viewportWidth * 0.66) {
      // If icon is in right third of viewport, right-align so popover opens toward left
      left = rect.right - popoverWidth;
    } else if (align === 'center') {
      left = rect.left + rect.width / 2 - popoverWidth / 2;
    } else {
      // Default: appear below and slightly left-aligned to the icon
      left = rect.left;
    }

    // Always keep at least 12px margin from all viewport edges
    const maxLeft = Math.max(margin, viewportWidth - popoverWidth - margin);
    left = Math.max(margin, Math.min(left, maxLeft));

    // FIX 2: Vertical edge-aware positioning
    let top: number;
    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;
    const neededBelow = popoverHeight + gap + margin;

    // If not enough room below, open above the icon instead
    if (spaceBelow < neededBelow && spaceAbove >= popoverHeight + gap) {
      top = rect.top - popoverHeight - gap;
    } else if (spaceBelow < neededBelow && spaceAbove > spaceBelow) {
      top = rect.top - popoverHeight - gap;
    } else {
      top = rect.bottom + gap;
    }

    // Clamp top to keep at least 12px margin from all viewport edges
    const maxTop = Math.max(margin, viewportHeight - popoverHeight - margin);
    top = Math.max(margin, Math.min(top, maxTop));

    setCoords({ top, left });
  }, [align]);

  const toggleOpen = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    setIsOpen((prev) => {
      const next = !prev;
      if (next) {
        // Pre-compute initial coordinates immediately on tap/click
        updatePosition();
      }
      return next;
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleOpen(e);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  // Synchronously compute and update position when opened
  useLayoutEffect(() => {
    if (!isOpen) return;

    updatePosition();

    // Re-verify after browser layout passes and text wrapping
    const rafId = requestAnimationFrame(() => {
      updatePosition();
    });

    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [isOpen, updatePosition]);

  // Handle outside clicks, Escape key, scroll (in capturing phase for modal containers) and resize
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      // Account for both the icon button and the portaled popover element
      if (
        buttonRef.current &&
        !buttonRef.current.contains(target) &&
        popoverRef.current &&
        !popoverRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    };

    const handleScrollOrResize = () => {
      updatePosition();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    window.addEventListener('keydown', handleWindowKeyDown);
    window.addEventListener('resize', handleScrollOrResize);
    // Use capture=true to capture scroll in any scrollable modal / overflow parent
    window.addEventListener('scroll', handleScrollOrResize, true);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      window.removeEventListener('keydown', handleWindowKeyDown);
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
    };
  }, [isOpen, updatePosition]);

  return (
    <span className={`relative inline-flex items-center align-middle ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        tabIndex={tabIndex}
        onClick={toggleOpen}
        onKeyDown={handleKeyDown}
        className="p-0.5 rounded-full text-slate-400 hover:text-amber-500 focus:text-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-400/50 transition-colors inline-flex items-center justify-center cursor-pointer"
        aria-label={title ? `Help: ${title}` : 'Help hint'}
        aria-expanded={isOpen}
      >
        <HelpCircle className="w-3.5 h-3.5 shrink-0" />
      </button>

      {isOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            role="tooltip"
            style={{
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              maxWidth: 'min(288px, calc(100vw - 24px))',
              zIndex: 9999
            }}
            className="fixed z-[300] w-64 max-w-[288px] p-3 rounded-xl bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 shadow-xl text-xs leading-relaxed animate-in fade-in zoom-in-95 duration-150 select-text"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              {title ? (
                <span className="font-bold text-slate-900 dark:text-white text-xs">{title}</span>
              ) : (
                <span className="font-semibold text-amber-600 dark:text-amber-400 text-[11px] uppercase tracking-wider">
                  Hint
                </span>
              )}
              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  setIsOpen(false);
                }}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 -mr-1 -mt-0.5 rounded cursor-pointer"
                aria-label="Close"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            <p className="font-normal text-slate-600 dark:text-slate-300">{text}</p>
          </div>,
          document.body
        )}
    </span>
  );
};

export default Hint;
