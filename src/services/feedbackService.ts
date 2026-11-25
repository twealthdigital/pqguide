/**
 * Stores customer feedback. There is no backend yet, so entries are kept on the
 * device; swap `submitFeedback` for an API call when one exists.
 */
const KEY = 'pqguide.feedback.v1';

export interface FeedbackEntry {
  id: string;
  message: string;
  createdAt: string;
}

export function submitFeedback(message: string): Promise<FeedbackEntry> {
  const entry: FeedbackEntry = {
    id: `fb-${Date.now()}`,
    message: message.trim(),
    createdAt: new Date().toISOString(),
  };
  try {
    const raw = window.localStorage.getItem(KEY);
    const list: FeedbackEntry[] = raw ? JSON.parse(raw) : [];
    list.push(entry);
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage unavailable (private mode, quota): the send still completes.
  }
  return Promise.resolve(entry);
}
