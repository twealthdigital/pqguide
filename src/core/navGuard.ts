import { useEffect, useRef } from 'react';

/**
 * Lets each open overlay (answer sheet, confirm dialog, drawer, filter dropdown,
 * select menu, running exam...) claim its own Back layer in exact stack order.
 * Pressing device Back closes the topmost layer first, then returns down the page trail.
 */
export type BackHandler = () => void;

export interface BackLayer {
  id: string;
  close: () => void;
}

type Listener = () => void;

let nextLayerSeq = 1;
const layers: BackLayer[] = [];
const listeners = new Set<Listener>();

const notify = () => {
  listeners.forEach((l) => l());
};

export const getBackLayers = (): readonly BackLayer[] => layers;

export const hasBackHandler = (): boolean => layers.length > 0;

export const getBackHandlerCount = (): number => layers.length;

export const closeBackLayer = (id: string): boolean => {
  const layer = layers.find((l) => l.id === id);
  if (!layer) return false;
  layer.close();
  return true;
};

export const runTopBackHandler = (): boolean => {
  const top = layers[layers.length - 1];
  if (!top) return false;
  top.close();
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
    const layer: BackLayer = {
      id: `layer-${nextLayerSeq++}`,
      close: () => handlerRef.current(),
    };
    layers.push(layer);
    notify();
    return () => {
      const i = layers.findIndex((l) => l.id === layer.id);
      if (i >= 0) layers.splice(i, 1);
      notify();
    };
  }, [active]);
};

export type LeaveProceed = () => void;
export type NavigationGuardHandler = (proceed: LeaveProceed) => void;

interface NavigationGuardEntry {
  id: string;
  onAttemptLeave: NavigationGuardHandler;
  isStillBlocking?: () => boolean;
}

let nextGuardSeq = 1;
const navGuards: NavigationGuardEntry[] = [];

export const useNavigationGuard = (
  active: boolean,
  onAttemptLeave: NavigationGuardHandler,
  isStillBlocking?: () => boolean
): void => {
  const handlerRef = useRef(onAttemptLeave);
  handlerRef.current = onAttemptLeave;
  const checkRef = useRef(isStillBlocking);
  checkRef.current = isStillBlocking;

  useEffect(() => {
    if (!active) return;
    const entry: NavigationGuardEntry = {
      id: `guard-${nextGuardSeq++}`,
      onAttemptLeave: (proceed) => handlerRef.current(proceed),
      isStillBlocking: () => (checkRef.current ? checkRef.current() : true),
    };
    navGuards.push(entry);
    return () => {
      const i = navGuards.findIndex((g) => g.id === entry.id);
      if (i >= 0) navGuards.splice(i, 1);
    };
  }, [active]);
};

/**
 * Runs active navigation guards before executing `proceed`.
 * Returns true when navigation was intercepted (held pending user confirmation),
 * or false when navigation executed immediately.
 */
export const runNavigationGuard = (proceed: LeaveProceed): boolean => {
  for (let i = navGuards.length - 1; i >= 0; i--) {
    const entry = navGuards[i];
    if (entry.isStillBlocking && !entry.isStillBlocking()) {
      continue;
    }
    entry.onAttemptLeave(proceed);
    return true;
  }
  proceed();
  return false;
};

