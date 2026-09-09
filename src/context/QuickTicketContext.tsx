import React, { createContext, useContext, useState, useRef, useCallback, ReactNode } from 'react';

interface QuickTicketContextType {
  isQuickTicketOpen: boolean;
  openQuickTicket: (draftId?: string) => void;
  closeQuickTicket: () => void;
  toggleQuickTicket: () => void;
  activeDraftId: string | null;
  focusMaterialInputRef: React.MutableRefObject<(() => void) | null>;
}

const QuickTicketContext = createContext<QuickTicketContextType | undefined>(undefined);

export function QuickTicketProvider({ children }: { children: ReactNode }) {
  const [isQuickTicketOpen, setIsQuickTicketOpen] = useState(false);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const focusMaterialInputRef = useRef<(() => void) | null>(null);

  const openQuickTicket = useCallback((draftId?: string) => {
    if (draftId) {
      setActiveDraftId(draftId);
    } else {
      setActiveDraftId(null);
    }
    setIsQuickTicketOpen(true);
    // Attempt focus after a short delay — works for mouse clicks
    setTimeout(() => {
      focusMaterialInputRef.current?.();
    }, 200);
  }, []);

  const closeQuickTicket = () => {
    setIsQuickTicketOpen(false);
    setActiveDraftId(null);
  };

  const toggleQuickTicket = () => {
    setIsQuickTicketOpen(prev => !prev);
  };

  return (
    <QuickTicketContext.Provider
      value={{
        isQuickTicketOpen,
        openQuickTicket,
        closeQuickTicket,
        toggleQuickTicket,
        activeDraftId,
        focusMaterialInputRef,
      }}
    >
      {children}
    </QuickTicketContext.Provider>
  );
}

export function useQuickTicket() {
  const context = useContext(QuickTicketContext);
  if (!context) {
    throw new Error('useQuickTicket must be used within a QuickTicketProvider');
  }
  return context;
}
