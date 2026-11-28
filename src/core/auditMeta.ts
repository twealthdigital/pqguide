import type { AuditActionType, AuditLogEntry, School, UserRole } from './types';

export interface AuditActionMeta {
  label: string;
  whatItDoes: string;
  verb: string;
}

export const AUDIT_ACTION_META: Record<AuditActionType, AuditActionMeta> = {
  super_admin_bootstrapped: {
    label: 'Super Admin Created',
    whatItDoes: 'Initialized the primary Super Admin account for this workspace.',
    verb: 'initialized Super Admin access',
  },
  admin_created: {
    label: 'School Admin Created',
    whatItDoes: 'Created a School Admin account with direct sign-in access for a university.',
    verb: 'created a School Admin account',
  },
  admin_invited: {
    label: 'School Admin Invited',
    whatItDoes: 'Approved a university email so the administrator can activate their account.',
    verb: 'granted School Admin access',
  },
  admin_updated: {
    label: 'School Admin Updated',
    whatItDoes: 'Changed a School Admin name, email, or assigned university.',
    verb: 'updated School Admin details',
  },
  admin_verified: {
    label: 'Admin Verification Updated',
    whatItDoes: 'Turned login verification on or paused it for a School Admin.',
    verb: 'updated admin verification',
  },
  admin_university_changed: {
    label: 'Admin University Changed',
    whatItDoes: 'Reassigned a School Admin to a different university.',
    verb: 'reassigned a School Admin',
  },
  admin_suspended: {
    label: 'Admin Suspended',
    whatItDoes: 'Paused sign-in access for a School Admin until restored.',
    verb: 'suspended a School Admin',
  },
  admin_reactivated: {
    label: 'Admin Reactivated',
    whatItDoes: 'Restored active sign-in access for a School Admin.',
    verb: 'reactivated a School Admin',
  },
  admin_revoked: {
    label: 'Admin Access Revoked',
    whatItDoes: 'Removed School Admin permissions from this account.',
    verb: 'revoked School Admin access',
  },
  account_verified: {
    label: 'Student Verification Updated',
    whatItDoes: 'Approved or paused login verification for a student account.',
    verb: 'updated student login verification',
  },
  account_warned: {
    label: 'Warning Issued',
    whatItDoes: 'Added a warning count and sent a notice to the user.',
    verb: 'issued an account warning',
  },
  account_restricted: {
    label: 'Account Restricted',
    whatItDoes: 'Set the account to read-only so it cannot upload or modify data.',
    verb: 'restricted an account',
  },
  account_suspended: {
    label: 'Account Suspended',
    whatItDoes: 'Signed the user out and paused login until restored.',
    verb: 'suspended an account',
  },
  account_banned: {
    label: 'Account Banned',
    whatItDoes: 'Permanently blocked this account from signing in.',
    verb: 'banned an account',
  },
  account_reactivated: {
    label: 'Account Restored',
    whatItDoes: 'Cleared restrictions or suspensions and restored normal access.',
    verb: 'restored an account',
  },
  role_changed: {
    label: 'Role Changed',
    whatItDoes: 'Updated the permission role assigned to this account.',
    verb: 'changed an account role',
  },
  university_created: {
    label: 'University Added',
    whatItDoes: 'Registered a new university on the platform.',
    verb: 'added a university',
  },
  university_updated: {
    label: 'University Updated',
    whatItDoes: 'Edited a university name, short code, or location.',
    verb: 'updated university details',
  },
  university_status_changed: {
    label: 'University Status Changed',
    whatItDoes: 'Activated or deactivated a university for student access.',
    verb: 'changed university status',
  },
  pq_uploaded: {
    label: 'Past Question Draft Saved',
    whatItDoes: 'Uploaded a past question file as a draft before publishing.',
    verb: 'uploaded a past question draft',
  },
  pq_updated: {
    label: 'Past Question Updated',
    whatItDoes: 'Edited questions or course details on an existing past question.',
    verb: 'updated a past question',
  },
  pq_published: {
    label: 'Past Question Published',
    whatItDoes: 'Published a past question so students can browse and practice it.',
    verb: 'uploaded & published a past question',
  },
  pq_unpublished: {
    label: 'Past Question Unpublished',
    whatItDoes: 'Moved a past question back to draft so students cannot view it.',
    verb: 'unpublished a past question',
  },
  pq_deleted: {
    label: 'Past Question Deleted',
    whatItDoes: 'Removed a past question record from the archive.',
    verb: 'deleted a past question',
  },
  material_uploaded: {
    label: 'Study Material Draft Saved',
    whatItDoes: 'Uploaded a study guide or reading note as a draft.',
    verb: 'saved a study material draft',
  },
  material_updated: {
    label: 'Study Material Updated',
    whatItDoes: 'Edited notes or sections inside a study guide.',
    verb: 'updated a study material',
  },
  material_published: {
    label: 'Study Material Published',
    whatItDoes: 'Published a study guide so students can read it.',
    verb: 'published a study material',
  },
  material_unpublished: {
    label: 'Study Material Unpublished',
    whatItDoes: 'Moved a study guide back to draft.',
    verb: 'unpublished a study material',
  },
  material_deleted: {
    label: 'Study Material Deleted',
    whatItDoes: 'Removed a study guide from the library.',
    verb: 'deleted a study material',
  },
  broadcast_sent: {
    label: 'Notification Sent',
    whatItDoes: 'Delivered a notice to student or admin notification feeds.',
    verb: 'sent a notification',
  },
  notification_submitted: {
    label: 'School Notification Pending Review',
    whatItDoes: 'Submitted a student notification from a university desk awaiting Super Admin verification.',
    verb: 'submitted a student notification for verification',
  },
  notification_verified: {
    label: 'Student Notification Verified & Published',
    whatItDoes: 'Approved a School Admin notification so it appears live on the student website.',
    verb: 'verified and published a school notification',
  },
  notification_rejected: {
    label: 'School Notification Declined',
    whatItDoes: 'Declined a pending School Admin student notification request.',
    verb: 'declined a school notification request',
  },
  notification_updated: {
    label: 'Notification Updated',
    whatItDoes: 'Edited the title, message, or target details of a notification.',
    verb: 'updated a notification',
  },
  marquee_updated: {
    label: 'Header Marquee Updated',
    whatItDoes: 'Updated or toggled the scrolling announcement bar at the top of the app.',
    verb: 'updated the top announcement bar',
  },
  support_replied: {
    label: 'Support Ticket Replied',
    whatItDoes: 'Sent a direct reply to a user support message and updated ticket status.',
    verb: 'replied to a support message',
  },
  cms_updated: {
    label: 'Website UI Updated',
    whatItDoes: 'Updated live text, headings, or FAQ content on the student, admin, or info pages.',
    verb: 'updated live website content',
  },
  payment_verified: {
    label: 'Payment Verified',
    whatItDoes: 'Confirmed a Paystack or Flutterwave subscription payment automatically.',
    verb: 'completed a verified payment',
  },
  doc_scanned: {
    label: 'Document Scanned',
    whatItDoes: 'Processed an uploaded file through validation, SHA-256 hashing, and text/OCR extraction.',
    verb: 'submitted a scanned document',
  },
  doc_auto_approved: {
    label: 'Document Passed Checks',
    whatItDoes: 'A scanned document passed validation and the AI cross-check. It still waits for Super Admin verification before students can see it.',
    verb: 'scanned a document that passed all automated checks',
  },
  doc_ai_alert: {
    label: 'AI Cross-Check Alert',
    whatItDoes: 'The AI cross-check or integrity checks found a problem with a scanned document. The document stays out of the student library until the Super Admin verifies it.',
    verb: 'scanned a document the AI cross-check marked as not okay',
  },
  doc_flagged: {
    label: 'Document Flagged for Review',
    whatItDoes: 'Held an uploaded document in the Super Admin Document Review queue after validation or AI risk checks.',
    verb: 'submitted a document flagged for review',
  },
  doc_review_approved: {
    label: 'Document Review Approved',
    whatItDoes: 'Approved and published a pending or flagged document in Super Admin Document Review.',
    verb: 'approved and published a submitted document',
  },
  doc_review_rejected: {
    label: 'Document Review Rejected',
    whatItDoes: 'Rejected a submitted document with a recorded reason and notified the submitter.',
    verb: 'rejected a submitted document',
  },
  doc_resubmission_requested: {
    label: 'Resubmission Requested',
    whatItDoes: 'Requested clearer upload or corrections from the submitter with review guidance.',
    verb: 'requested document resubmission',
  },
  doc_upload_failed: {
    label: 'Upload Failed',
    whatItDoes: 'An uploaded file could not be processed. Only the Super Admin is told about failed uploads.',
    verb: 'had an upload fail',
  },
  doc_edited: {
    label: 'Document Edited',
    whatItDoes: 'Changed the details of an uploaded document. A School Admin edit sends the document back to pending.',
    verb: 'edited an uploaded document',
  },
  doc_deleted: {
    label: 'Document Deleted',
    whatItDoes: 'Permanently removed an uploaded document, including any typed copy published to the past questions catalog.',
    verb: 'deleted an uploaded document',
  },
  dev_data_reset: {
    label: 'Dev Data Reset',
    whatItDoes: 'Reset local catalog or development storage.',
    verb: 'reset development data',
  },
};

export function formatRoleLabel(role: UserRole): string {
  if (role === 'super_admin') return 'Super Admin';
  if (role === 'school_admin') return 'School Admin';
  return 'Student';
}

export function formatAuditHeadline(entry: AuditLogEntry, schoolCode?: string): string {
  const roleLabel = formatRoleLabel(entry.actorRole);
  const actorTag = schoolCode && entry.actorRole === 'school_admin'
    ? `${entry.actorName} (${schoolCode} Admin)`
    : `${roleLabel} ${entry.actorName}`;

  if (entry.action === 'pq_published' || entry.action === 'pq_uploaded') {
    return entry.actorRole === 'super_admin'
      ? `Uploaded by Super Admin ${entry.actorName}`
      : `${actorTag} uploaded past question`;
  }
  if (entry.action === 'material_published' || entry.action === 'material_uploaded') {
    return entry.actorRole === 'super_admin'
      ? `Study material uploaded by Super Admin ${entry.actorName}`
      : `${actorTag} uploaded study material`;
  }
  const meta = AUDIT_ACTION_META[entry.action];
  return `${actorTag} ${meta?.verb ?? 'performed an action'}`;
}

export function resolveSchoolCode(
  schools: School[],
  schoolId?: string
): string | undefined {
  if (!schoolId) return undefined;
  return schools.find((s) => s.id === schoolId)?.code;
}
