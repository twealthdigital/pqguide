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
