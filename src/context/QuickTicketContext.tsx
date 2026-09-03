import React, { createContext, useContext, useState, ReactNode } from 'react';

interface QuickTicketContextType {
  isQuickTicketOpen: boolean;
  openQuickTicket: (draftId?: string) => void;
  closeQuickTicket: () => void;
  toggleQuickTicket: () => void;
  activeDraftId: string | null;
}

const QuickTicketContext = createContext<QuickTicketContextType | undefined>(undefined);

export function QuickTicketProvider({ children }: { children: ReactNode }) {
  const [isQuickTicketOpen, setIsQuickTicketOpen] = useState(false);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);

  const openQuickTicket = (draftId?: string) => {
    if (draftId) {
      setActiveDraftId(draftId);
    } else {
      setActiveDraftId(null);
    }
    setIsQuickTicketOpen(true);
  };

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
