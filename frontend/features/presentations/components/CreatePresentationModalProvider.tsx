"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

import { CreatePresentationModal } from "@/features/presentations/components/CreatePresentationModal";

type CreatePresentationModalContextValue = {
  open: () => void;
  close: () => void;
};

const CreatePresentationModalContext = createContext<CreatePresentationModalContextValue | null>(null);

export function CreatePresentationModalProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const openModal = useCallback(() => setOpen(true), []);
  const value = useMemo(() => ({ open: openModal, close }), [openModal, close]);

  return (
    <CreatePresentationModalContext.Provider value={value}>
      {children}
      <CreatePresentationModal open={open} onClose={close} />
    </CreatePresentationModalContext.Provider>
  );
}

export function useCreatePresentationModal() {
  const ctx = useContext(CreatePresentationModalContext);
  if (!ctx) {
    throw new Error("useCreatePresentationModal must be used within CreatePresentationModalProvider");
  }
  return ctx;
}

