import { useEffect, useRef } from 'react';

/**
 * Lets an open overlay (answer sheet, drawer, filter dropdown, select menu,
 * running exam...) claim the phone's Back button. While one is registered,
 * pressing Back runs its handler instead of leaving the screen.
 */
type BackHandler = () => void;
type Listener = () => void;

const handlers: BackHandler[] = [];
const listeners = new Set<Listener>();

const notify = () => {
  listeners.forEach((l) => l());
};

export const hasBackHandler = (): boolean => handlers.length > 0;

export const getBackHandlerCount = (): number => handlers.length;

export const runTopBackHandler = (): boolean => {
  const top = handlers[handlers.length - 1];
  if (!top) return false;
  top();
  return true;
};

export const subscribeBackHandlers = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useBackHandler = (active: boolean, handler: BackHandler): void => {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!active) return;
    const fn: BackHandler = () => handlerRef.current();
    handlers.push(fn);
    notify();
    return () => {
      const i = handlers.lastIndexOf(fn);
      if (i >= 0) handlers.splice(i, 1);
      notify();
    };
  }, [active]);
};
