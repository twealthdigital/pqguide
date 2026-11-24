import { useSyncExternalStore } from 'react';
import { archiveRepository, type AppStoreState } from '../services/archiveRepository';

export function useArchiveStore(): AppStoreState {
  return useSyncExternalStore(
    archiveRepository.subscribe,
    archiveRepository.getSnapshot,
    archiveRepository.getSnapshot
  );
}
