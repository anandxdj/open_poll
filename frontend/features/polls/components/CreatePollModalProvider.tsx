"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

import { CreatePollModal } from "@/features/polls/components/CreatePollModal";

type CreatePollModalContextValue = {
  open: () => void;
  close: () => void;
};

const CreatePollModalContext = createContext<CreatePollModalContextValue | null>(null);

export function CreatePollModalProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const openModal = useCallback(() => setOpen(true), []);
  const value = useMemo(() => ({ open: openModal, close }), [openModal, close]);

  return (
    <CreatePollModalContext.Provider value={value}>
      {children}
      <CreatePollModal open={open} onClose={close} />
    </CreatePollModalContext.Provider>
  );
}

export function useCreatePollModal() {
  const ctx = useContext(CreatePollModalContext);
  if (!ctx) {
    throw new Error("useCreatePollModal must be used within CreatePollModalProvider");
  }
  return ctx;
}
