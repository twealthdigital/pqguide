import type { SupportTicket, UserRole } from '../core/types';
import { archiveRepository } from './archiveRepository';

const KEY = 'pqguide.feedback.v1';

export interface FeedbackEntry {
  id: string;
  message: string;
  createdAt: string;
}

export interface FeedbackSenderContext {
  userId?: string;
  role?: UserRole;
  fullName?: string;
  email?: string;
  matricNumber?: string;
  level?: SupportTicket['senderLevel'];
  kind?: SupportTicket['kind'];
}

export function submitFeedback(
  message: string,
  sender?: FeedbackSenderContext
): Promise<FeedbackEntry> {
  const entry: FeedbackEntry = {
    id: `fb-${Date.now()}`,
    message: message.trim(),
    createdAt: new Date().toISOString(),
  };

  try {
    archiveRepository.submitSupportTicket({
      senderUserId: sender?.userId,
      senderRole: sender?.role,
      senderName: sender?.fullName,
      senderEmail: sender?.email,
      senderMatric: sender?.matricNumber,
      senderLevel: sender?.level,
      kind: sender?.kind,
      message,
    });
  } catch {
    // Keep resilient even if validation fails silently
  }

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
