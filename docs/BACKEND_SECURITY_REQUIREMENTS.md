# PQGuide Backend Security Requirements & Honest Client-Side Boundaries

This phase implements PQGuide's frontend Role-Based Access Control (RBAC), Super Admin / School Admin dashboards, input sanitization, and upload validation. **Because this phase has no backend server, all browser-side checks and `localStorage` records are client-side ergonomics only and can be inspected or modified by an end user in browser DevTools.**

Production deployment **must** move trust decisions, authentication, authorization, and file handling to a hardened server before onboarding live students or institutional administrators.

---

## 1. Authentication & Session Management

- **Server-Issued Cryptographic Sessions / Tokens**:
  - Authenticate users over HTTPS (`TLS 1.2+`) on a backend endpoint (`POST /api/auth/login`).
  - Issue either `HttpOnly; Secure; SameSite=Lax` (or `None; Partitioned` if embedded) session cookies, or short-lived signed JWTs (`15m`) paired with rotating refresh tokens stored securely in Capacitor native secure storage (`Keychain` on iOS / `EncryptedSharedPreferences` Keystore on Android) rather than `localStorage`.
  - Store session revocation lists / token versions server-side so **Suspend** and **Revoke Access** take effect immediately across all devices.
- **Password Hashing & MFA**:
  - Replace client-side PBKDF2 with server-side **Argon2id** (preferred) or `scrypt`/`bcrypt` with per-user cryptographic salts and pepper.
  - Require **MFA (TOTP / Passkeys)** for `super_admin` and `school_admin` accounts.
  - Enforce rate limiting, exponential backoff, and account lockout notifications against credential stuffing and brute-force attempts.

## 2. Server-Side RBAC & University Scoping

- **Zero Trust in Client Claims**:
  - Never accept `role`, `assignedSchoolId`, or `userId` from request bodies, query strings, or headers without verifying against the authenticated server session.
  - Every `POST`, `PUT`, `PATCH`, `DELETE`, and admin `GET` endpoint must assert:
    1. Valid active session + `account.status === 'active'`
    2. Explicit permission check (`schools:manage`, `admins:manage`, `pq:upload_school`, etc.)
    3. For `school_admin`, query/row scoping `WHERE school_id = session.assignedSchoolId` enforced in backend middleware and database Row-Level Security (RLS).
- **Super Admin Provisioning**:
  - Remove the client-side `dev_super_admin_setup` bootstrap completely in production builds (`!import.meta.env.DEV`).
  - Provision initial Super Admins via secure CLI migration / seed script or out-of-band IAM/SSO, never via a public signup form or hardcoded password.
- **School Admin Invitations**:
  - Send time-limited, single-use signed invite links to institutional emails instead of passing an initial password created in a frontend form.

## 3. File Upload Scanning & Document Storage

- **Re-Validate & Scan Server-Side**:
  - Re-verify MIME type, extension allowlist, size limit, and magic-byte headers on the server (`file-type` inspection).
  - Run uploaded PDFs, DOCX files, and images through **antivirus/malware scanning** (e.g., ClamAV) before persisting.
  - Re-encode/transcode uploaded images on the server (stripping EXIF and embedded payloads) and sanitize or flatten PDFs where appropriate.
- **Safe Serving & Isolation**:
  - Store uploaded files in private object storage (S3 / GCS / Cloudflare R2) outside the web root with generated UUID filenames — never trust `originalFileName` in filesystem paths.
  - Serve downloadable attachments from an isolated origin/bucket domain with:
    - `Content-Disposition: attachment`
    - `X-Content-Type-Options: nosniff`
    - Strict `Content-Security-Policy` blocking active script execution.

## 4. Database, Injection & Transport Hardening

- **Parameterized Queries**: Use parameterized SQL / ORM bindings (`pg`, `Prisma`, `Drizzle`) exclusively for search, filters, pagination, and CRUD.
- **Command Execution**: Avoid shelling out on user-supplied filenames or metadata; if document conversion tools are invoked server-side, pass static argument arrays without a shell (`execFile` / `spawn(..., { shell: false })`) and validate confined `path.resolve` directories.
- **Immutable Audit Logs**: Write `audit_logs` on the server from verified middleware context into an append-only table (never writable by client requests).
- **Security Headers & CSRF**:
  - Enforce `Strict-Transport-Security`, `Content-Security-Policy` (`default-src 'self'; script-src 'self'; object-src 'none'`), `X-Content-Type-Options: nosniff`, and CSRF tokens or `Origin` verification on state-changing routes.
