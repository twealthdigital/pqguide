import { useEffect, useRef } from 'react';

/**
 * Lets an open overlay (answer sheet, drawer, running exam...) claim the
 * phone's Back button. While one is registered, pressing Back runs its handler
 * (close the sheet, ask "leave the exam?") instead of leaving the screen.
 */
type BackHandler = () => void;

const handlers: BackHandler[] = [];

export const hasBackHandler = (): boolean => handlers.length > 0;

export const runTopBackHandler = (): boolean => {
  const top = handlers[handlers.length - 1];
  if (!top) return false;
  top();
  return true;
};

export const useBackHandler = (active: boolean, handler: BackHandler): void => {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!active) return;
    const fn: BackHandler = () => handlerRef.current();
    handlers.push(fn);
    return () => {
      const i = handlers.lastIndexOf(fn);
      if (i >= 0) handlers.splice(i, 1);
    };
  }, [active]);
};
