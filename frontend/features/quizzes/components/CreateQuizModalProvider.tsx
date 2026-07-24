"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

import { CreateQuizModal } from "@/features/quizzes/components/CreateQuizModal";

type CreateQuizModalContextValue = {
  open: () => void;
  close: () => void;
};

const CreateQuizModalContext = createContext<CreateQuizModalContextValue | null>(null);

export function CreateQuizModalProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const openModal = useCallback(() => setOpen(true), []);
  const value = useMemo(() => ({ open: openModal, close }), [openModal, close]);

  return (
    <CreateQuizModalContext.Provider value={value}>
      {children}
      <CreateQuizModal open={open} onClose={close} />
    </CreateQuizModalContext.Provider>
  );
}

export function useCreateQuizModal() {
  const ctx = useContext(CreateQuizModalContext);
  if (!ctx) {
    throw new Error("useCreateQuizModal must be used within CreateQuizModalProvider");
  }
  return ctx;
}
