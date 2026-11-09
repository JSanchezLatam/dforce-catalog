"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

import { FeedbackDialog } from "./FeedbackDialog";

type FeedbackContextValue = { openFeedback: () => void };

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

/** Null outside a provider, so the sidebar renders (without the item) in trees that mount no dialog. */
export function useFeedback() {
  return useContext(FeedbackContext);
}

/** Mounts the one feedback dialog for the whole shell. Props are strings only: this is rendered from a Server Component. */
export function FeedbackProvider({
  author,
  children,
}: {
  author: { username: string; roleLabel: string };
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const openFeedback = useCallback(() => setOpen(true), []);
  const value = useMemo(() => ({ openFeedback }), [openFeedback]);

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <FeedbackDialog open={open} onOpenChange={setOpen} author={author} />
    </FeedbackContext.Provider>
  );
}
