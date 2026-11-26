/**
 * Frontend Google Identity Services (GIS) integration for Student authentication ONLY.
 *
 * SECURITY REQUIREMENTS:
 * - Never trust unverified client-side Google assertions alone.
 * - Requires both `VITE_GOOGLE_OAUTH_CLIENT_ID` (Google OAuth 2.0 Web Client ID)
 *   and `VITE_AUTH_API_BASE_URL` (server endpoint `POST /api/auth/google` that verifies
 *   the Google ID token signature, audience, issuer, and `email_verified` claim).
 * - Never simulates or fabricates a Google login when configuration is absent.
 * - Strictly isolated from School Admin and Super Admin authentication portals.
 */

export interface GoogleOAuthConfigStatus {
  clientIdConfigured: boolean;
  backendVerifyConfigured: boolean;
  ready: boolean;
  missingRequirements: string[];
  clientId?: string;
  verifyEndpoint?: string;
}

export interface VerifiedGoogleStudentIdentity {
  email: string;
  fullName: string;
  googleSub: string;
  emailVerified: boolean;
  pictureUrl?: string;
}

export interface GoogleAuthAttemptResult {
  ok: boolean;
  error?: string;
  notConfigured?: boolean;
  identity?: VerifiedGoogleStudentIdentity;
}

interface GoogleCredentialResponse {
  credential?: string;
  select_by?: string;
}

interface GoogleGsiAccountsId {
  initialize: (config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
    ux_mode?: 'popup' | 'redirect';
  }) => void;
  prompt: (
    momentListener?: (notification: {
      isNotDisplayed?: () => boolean;
      isSkippedMoment?: () => boolean;
      isDismissedMoment?: () => boolean;
      getNotDisplayedReason?: () => string;
      getSkippedReason?: () => string;
      getDismissedReason?: () => string;
    }) => void
  ) => void;
  disableAutoSelect?: () => void;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: GoogleGsiAccountsId;
      };
    };
  }
}

const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

function readEnvString(key: 'VITE_GOOGLE_OAUTH_CLIENT_ID' | 'VITE_AUTH_API_BASE_URL'): string {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    return (env?.[key] ?? '').trim();
  } catch {
    return '';
  }
}

export function getGoogleOAuthConfigStatus(): GoogleOAuthConfigStatus {
  const clientId = readEnvString('VITE_GOOGLE_OAUTH_CLIENT_ID');
  const apiBase = readEnvString('VITE_AUTH_API_BASE_URL').replace(/\/+$/, '');

  const clientIdConfigured =
    Boolean(clientId) && !clientId.startsWith('YOUR_') && clientId.includes('.apps.googleusercontent.com');
  const backendVerifyConfigured = Boolean(apiBase) && /^https?:\/\//i.test(apiBase);

  const missingRequirements: string[] = [];
  if (!clientIdConfigured) {
    missingRequirements.push('VITE_GOOGLE_OAUTH_CLIENT_ID (Google Cloud Web OAuth Client ID)');
  }
  if (!backendVerifyConfigured) {
    missingRequirements.push(
      'VITE_AUTH_API_BASE_URL (Backend endpoint POST /api/auth/google for server-side ID token verification)'
    );
  }

  return {
    clientIdConfigured,
    backendVerifyConfigured,
    ready: clientIdConfigured && backendVerifyConfigured,
    missingRequirements,
    clientId: clientIdConfigured ? clientId : undefined,
    verifyEndpoint: backendVerifyConfigured ? `${apiBase}/api/auth/google` : undefined,
  };
}

let gisScriptPromise: Promise<void> | null = null;

function loadGoogleIdentityScript(): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('Google Sign-In requires a browser environment.'));
  }
  if (window.google?.accounts?.id) {
    return Promise.resolve();
  }
  if (gisScriptPromise) return gisScriptPromise;

  gisScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${GIS_SCRIPT_SRC}"]`
    );
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener(
        'error',
        () => reject(new Error('Failed to load Google Identity Services script.')),
        { once: true }
      );
      return;
    }

    const script = document.createElement('script');
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      gisScriptPromise = null;
      reject(new Error('Unable to reach Google Identity Services. Check your network connection.'));
    };
    document.head.appendChild(script);
  });

  return gisScriptPromise;
}

async function promptForGoogleIdToken(clientId: string): Promise<string> {
  await loadGoogleIdentityScript();
  const gsi = window.google?.accounts?.id;
  if (!gsi) {
    throw new Error('Google Identity Services did not initialize properly.');
  }

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('Google sign-in timed out. Please try again.'));
      }
    }, 60_000);

    gsi.initialize({
      client_id: clientId,
      ux_mode: 'popup',
      auto_select: false,
      cancel_on_tap_outside: true,
      callback: (response) => {
        if (settled) return;
        window.clearTimeout(timeoutId);
        settled = true;
        if (!response.credential) {
          reject(new Error('Google did not return an identity token.'));
          return;
        }
        resolve(response.credential);
      },
    });

    gsi.prompt((notification) => {
      if (settled) return;
      if (notification.isNotDisplayed?.() || notification.isSkippedMoment?.()) {
        window.clearTimeout(timeoutId);
        settled = true;
        const reason =
          notification.getNotDisplayedReason?.() ||
          notification.getSkippedReason?.() ||
          'popup_blocked';
        reject(
          new Error(
            `Google prompt could not be displayed (${reason}). Ensure popups are allowed and this origin is authorized in Google Cloud Console.`
          )
        );
      } else if (notification.isDismissedMoment?.()) {
        const reason = notification.getDismissedReason?.();
        if (reason !== 'credential_returned') {
          window.clearTimeout(timeoutId);
          settled = true;
          reject(new Error('Google sign-in was cancelled.'));
        }
      }
    });
  });
}

export const googleAuthService = {
  getConfigStatus: getGoogleOAuthConfigStatus,

  async authenticateStudent(): Promise<GoogleAuthAttemptResult> {
    const status = getGoogleOAuthConfigStatus();
    if (!status.ready || !status.clientId || !status.verifyEndpoint) {
      return {
        ok: false,
        notConfigured: true,
        error: `Google Sign-In is not yet configured for this deployment. Required: ${status.missingRequirements.join(' and ')}.`,
      };
    }

    try {
      const idToken = await promptForGoogleIdToken(status.clientId);
      const response = await fetch(status.verifyEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          idToken,
          portal: 'student',
        }),
      });

      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        user?: {
          email?: string;
          fullName?: string;
          sub?: string;
          emailVerified?: boolean;
          picture?: string;
          role?: string;
        };
      } | null;

      if (!response.ok || !payload?.user?.email) {
        return {
          ok: false,
          error:
            payload?.error ||
            'Google token verification failed on the authentication server.',
        };
      }

      if (payload.user.role && payload.user.role !== 'student') {
        return {
          ok: false,
          error:
            'Google Sign-In is strictly reserved for student accounts. Administrators must sign in via their designated console.',
        };
      }

      if (payload.user.emailVerified === false) {
        return {
          ok: false,
          error: 'Your Google account email is not verified.',
        };
      }

      return {
        ok: true,
        identity: {
          email: payload.user.email.trim().toLowerCase(),
          fullName: (payload.user.fullName || payload.user.email.split('@')[0]).trim(),
          googleSub: payload.user.sub || '',
          emailVerified: true,
          pictureUrl: payload.user.picture,
        },
      };
    } catch (err) {
      return {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : 'Unable to complete Google authentication.',
      };
    }
  },
};
