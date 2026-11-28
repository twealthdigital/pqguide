import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  FileCode2,
  GitBranch,
  GitCommitHorizontal,
  KeyRound,
  RefreshCw,
  X,
} from 'lucide-react';

interface RepoFileChange {
  path: string;
  indexStatus: string;
  workTreeStatus: string;
  statusLabel: 'Modified' | 'Added' | 'Deleted' | 'Renamed' | 'Untracked';
  isRepoFlowHelper: boolean;
}

interface RepoCommitEntry {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  relativeDate: string;
  isoDate: string;
}

interface RepoSnapshot {
  owner: string;
  repo: string;
  fullName: string;
  remoteUrl: string;
  branch: string;
  ahead: number;
  behind: number;
  changes: RepoFileChange[];
  commits: RepoCommitEntry[];
}

interface VerifiedIdentity {
  user: {
    login: string;
    name: string;
    email: string;
    avatarUrl: string;
  };
  repo: {
    fullName: string;
    defaultBranch: string;
    private: boolean;
    canPush: boolean;
  };
}

interface PushSuccessState {
  shortSha: string;
  commitUrl: string;
  output: string;
}

const SAFE_GITHUB_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/commit\/[0-9a-f]{7,40}$/i;

function statusBadgeCode(label: RepoFileChange['statusLabel']): string {
  switch (label) {
    case 'Added':
      return 'A';
    case 'Deleted':
      return 'D';
    case 'Renamed':
      return 'R';
    case 'Untracked':
      return 'U';
    default:
      return 'M';
  }
}

function statusTextTone(label: RepoFileChange['statusLabel']): string {
  switch (label) {
    case 'Added':
    case 'Untracked':
      return 'text-[#16A34A]';
    case 'Deleted':
      return 'text-[#DC2626]';
    default:
      return 'text-[#D97706]';
  }
}

export function RepoFlowLauncher() {
  const [isOpen, setIsOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('repoflow') === '1';
  });

  const [snapshot, setSnapshot] = useState<RepoSnapshot | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  // GitHub PAT lives strictly in React memory for this preview session
  const [tokenInput, setTokenInput] = useState('');
  const [verifiedToken, setVerifiedToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [identity, setIdentity] = useState<VerifiedIdentity | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [activeDiffPath, setActiveDiffPath] = useState<string | null>(null);
  const [diffText, setDiffText] = useState<string>('');
  const [loadingDiff, setLoadingDiff] = useState(false);

  const [commitMessage, setCommitMessage] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [authorEmail, setAuthorEmail] = useState('');

  const [pulling, setPulling] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLog, setActionLog] = useState<string | null>(null);
  const [pushSuccess, setPushSuccess] = useState<PushSuccessState | null>(null);

  const applySnapshot = useCallback((next: RepoSnapshot) => {
    setSnapshot(next);
    setSelectedPaths((prev) => {
      const existingPaths = new Set(next.changes.map((c) => c.path));
      const kept = new Set<string>();
      for (const p of prev) {
        if (existingPaths.has(p)) kept.add(p);
      }
      if (kept.size === 0 && next.changes.length > 0) {
        const appEdits = next.changes.filter((c) => !c.isRepoFlowHelper);
        const initialTargets = appEdits.length > 0 ? appEdits : next.changes;
        for (const item of initialTargets) {
          kept.add(item.path);
        }
      }
      return kept;
    });

    setActiveDiffPath((prev) => {
      if (prev && next.changes.some((c) => c.path === prev)) return prev;
      const preferred = next.changes.find((c) => !c.isRepoFlowHelper) ?? next.changes[0];
      return preferred ? preferred.path : null;
    });
  }, []);

  const refreshStatus = useCallback(async () => {
    setLoadingStatus(true);
    setStatusError(null);
    try {
      const res = await fetch('/api/repo/status');
      const data = (await res.json()) as { ok: boolean; error?: string } & Partial<RepoSnapshot>;
      if (!res.ok || !data.ok || !data.fullName) {
        throw new Error(data.error || 'Failed to inspect repository.');
      }
      applySnapshot(data as RepoSnapshot);
    } catch (err: unknown) {
      setStatusError(err instanceof Error ? err.message : 'Unable to reach repository service.');
    } finally {
      setLoadingStatus(false);
    }
  }, [applySnapshot]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (isOpen) {
      void refreshStatus();
    }
  }, [isOpen, refreshStatus]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      } else if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !activeDiffPath) {
      setDiffText('');
      return;
    }
    let cancelled = false;
    setLoadingDiff(true);
    void fetch('/api/repo/diff', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'pqguide-repoflow',
      },
      body: JSON.stringify({ path: activeDiffPath }),
    })
      .then((r) => r.json())
      .then((data: { ok?: boolean; diff?: string; error?: string }) => {
        if (cancelled) return;
        if (data.ok) {
          setDiffText(data.diff ?? '');
        } else {
          setDiffText(data.error || 'Unable to load file diff.');
        }
      })
      .catch(() => {
        if (!cancelled) setDiffText('Unable to load file diff.');
      })
      .finally(() => {
        if (!cancelled) setLoadingDiff(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, activeDiffPath]);

  const handleVerifyToken = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = tokenInput.trim();
    if (!trimmed) {
      setAuthError('Paste a GitHub Personal Access Token first.');
      return;
    }
    setVerifying(true);
    setAuthError(null);
    setActionError(null);
    try {
      const res = await fetch('/api/repo/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'pqguide-repoflow',
          'x-github-token': trimmed,
        },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        user?: VerifiedIdentity['user'];
        repo?: VerifiedIdentity['repo'];
        snapshot?: RepoSnapshot;
      };
      if (!res.ok || !data.ok || !data.user || !data.repo) {
        throw new Error(data.error || 'Token verification failed.');
      }
      setVerifiedToken(trimmed);
      setIdentity({ user: data.user, repo: data.repo });
      if (!authorName) setAuthorName(data.user.name || data.user.login);
      if (!authorEmail) setAuthorEmail(data.user.email);
      if (data.snapshot) applySnapshot(data.snapshot);
    } catch (err: unknown) {
      setIdentity(null);
      setVerifiedToken('');
      setAuthError(err instanceof Error ? err.message : 'Unable to verify GitHub token.');
    } finally {
      setVerifying(false);
    }
  };

  const handleClearToken = () => {
    setTokenInput('');
    setVerifiedToken('');
    setIdentity(null);
    setAuthError(null);
    setActionError(null);
  };

  const handlePullMain = async () => {
    if (!verifiedToken) {
      setActionError('Connect a GitHub token before pulling from origin/main.');
      return;
    }
    setPulling(true);
    setActionError(null);
    setActionLog(null);
    setPushSuccess(null);
    try {
      const res = await fetch('/api/repo/pull', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'pqguide-repoflow',
          'x-github-token': verifiedToken,
        },
        body: JSON.stringify({
          authorName: authorName.trim(),
          authorEmail: authorEmail.trim(),
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        output?: string;
        snapshot?: RepoSnapshot;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Pull failed.');
      }
      setActionLog(data.output || 'Pulled latest changes from origin/main.');
      if (data.snapshot) applySnapshot(data.snapshot);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Pull from origin/main failed.');
    } finally {
      setPulling(false);
    }
  };

  const handleCommitAndPush = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifiedToken || !identity?.repo.canPush) {
      setActionError('Connect a GitHub token with push permission to twealthdigital/pqguide.');
      return;
    }

    const files = Array.from(selectedPaths);
    const pushOnly = files.length === 0 && (snapshot?.ahead ?? 0) > 0;
    if (!pushOnly && files.length === 0) {
      setActionError('Select at least one edited file to commit and push.');
      return;
    }
    if (!pushOnly && !commitMessage.trim()) {
      setActionError('Enter a commit message describing your edits.');
      return;
    }

    setPushing(true);
    setActionError(null);
    setActionLog(null);
    setPushSuccess(null);
    try {
      const res = await fetch('/api/repo/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'pqguide-repoflow',
          'x-github-token': verifiedToken,
        },
        body: JSON.stringify({
          files,
          message: commitMessage.trim(),
          authorName: authorName.trim(),
          authorEmail: authorEmail.trim(),
          pushOnly,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        shortSha?: string;
        commitUrl?: string;
        output?: string;
        snapshot?: RepoSnapshot;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Commit & push failed.');
      }
      setCommitMessage('');
      setActionLog(data.output || 'Pushed to origin/main.');
      if (data.shortSha && data.commitUrl && SAFE_GITHUB_URL_RE.test(data.commitUrl)) {
        setPushSuccess({
          shortSha: data.shortSha,
          commitUrl: data.commitUrl,
          output: data.output || '',
        });
      }
      if (data.snapshot) applySnapshot(data.snapshot);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Push to origin/main failed.');
    } finally {
      setPushing(false);
    }
  };

  const togglePath = (filePath: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  };

  const selectAppEditsOnly = () => {
    if (!snapshot) return;
    setSelectedPaths(
      new Set(snapshot.changes.filter((c) => !c.isRepoFlowHelper).map((c) => c.path))
    );
  };

  const selectAllFiles = () => {
    if (!snapshot) return;
    setSelectedPaths(new Set(snapshot.changes.map((c) => c.path)));
  };

  const clearSelection = () => {
    setSelectedPaths(new Set());
  };

  const changes = snapshot?.changes ?? [];
  const appChangeCount = useMemo(
    () => changes.filter((c) => !c.isRepoFlowHelper).length,
    [changes]
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label="Open Repo Flow GitHub sync drawer"
        className="tactile-dark fixed bottom-20 right-4 z-[9998] flex items-center gap-2 rounded-xl border border-white/15 px-3.5 py-2.5 text-xs font-medium text-white transition-transform hover:scale-[1.02] md:bottom-5 md:right-5 whitespace-nowrap shrink-0"
      >
        <GitBranch className="h-3.5 w-3.5 text-white/85" aria-hidden="true" />
        <span>Repo Flow</span>
        {changes.length > 0 && (
          <span className="font-mono-tabular text-[11px] text-white/75">
            {changes.length}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-[9999] flex justify-end bg-[#1A1B20]/40 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-label="Repo Flow — GitHub sync and push to main"
        >
          <div
            className="flex-1"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />

          <aside className="flex h-full w-full max-w-[840px] flex-col border-l border-[#1A1B20]/10 bg-[#F6F7F9] text-[#1A1B20] shadow-2xl">
            {/* Header */}
            <header className="flex items-center justify-between gap-4 border-b border-[#1A1B20]/10 bg-white px-5 py-3.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-[#1D1E23] shrink-0" aria-hidden="true" />
                  <h2 className="font-display text-sm font-bold tracking-tight text-[#1A1B20] truncate">
                    Repo Flow
                  </h2>
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-[#686C78] font-mono-tabular truncate">
                  <span>{snapshot?.fullName ?? 'twealthdigital/pqguide'}</span>
                  <span aria-hidden="true">·</span>
                  <span>{snapshot?.branch ?? 'main'}</span>
                  {snapshot && (snapshot.ahead > 0 || snapshot.behind > 0) && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>
                        {snapshot.ahead} ahead / {snapshot.behind} behind
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => void refreshStatus()}
                  disabled={loadingStatus}
                  className="tactile-light inline-flex items-center gap-1.5 rounded-lg border border-[#1A1B20]/10 px-3 py-1.5 text-xs font-medium text-[#1A1B20] disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${loadingStatus ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                  />
                  <span>Refresh</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  aria-label="Close Repo Flow"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#1A1B20]/10 bg-white text-[#686C78] hover:text-[#1A1B20] transition-colors"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </header>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
              {statusError && (
                <div className="flex items-start gap-2.5 rounded-xl border border-[#DC2626]/25 bg-white p-3.5 text-xs text-[#DC2626]">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{statusError}</span>
                </div>
              )}

              {/* Token & Remote Connection */}
              <section className="rounded-xl border border-[#1A1B20]/10 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <KeyRound className="h-4 w-4 text-[#1D1E23]" aria-hidden="true" />
                    <h3 className="font-display text-xs font-semibold text-[#1A1B20]">
                      GitHub Token &amp; Remote Connection
                    </h3>
                  </div>
                  {identity && (
                    <div className="flex items-center gap-2 text-xs text-[#16A34A] font-medium">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>
                        @{identity.user.login} ·{' '}
                        {identity.repo.canPush ? 'Push access verified' : 'Read-only token'}
                      </span>
                    </div>
                  )}
                </div>

                <form onSubmit={handleVerifyToken} className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <div className="relative flex-1">
                    <input
                      type={showToken ? 'text' : 'password'}
                      value={tokenInput}
                      onChange={(e) => setTokenInput(e.target.value)}
                      placeholder="Paste GitHub Personal Access Token (github_pat_... or ghp_...)"
                      autoComplete="off"
                      spellCheck={false}
                      aria-label="GitHub Personal Access Token"
                      className="w-full rounded-lg border border-[#1A1B20]/15 bg-[#F6F7F9] py-2 pl-3 pr-9 font-mono text-xs text-[#1A1B20] placeholder:text-[#686C78]/75 focus:border-[#1D1E23] focus:bg-white focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken((v) => !v)}
                      aria-label={showToken ? 'Hide token' : 'Show token'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#686C78] hover:text-[#1A1B20]"
                    >
                      {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="submit"
                      disabled={verifying}
                      className="tactile-dark inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium text-white disabled:opacity-50 whitespace-nowrap shrink-0"
                    >
                      <span>{verifying ? 'Verifying...' : identity ? 'Re-verify' : 'Connect Token'}</span>
                    </button>

                    {identity && (
                      <>
                        <button
                          type="button"
                          onClick={() => void handlePullMain()}
                          disabled={pulling}
                          className="tactile-light inline-flex items-center gap-1.5 rounded-lg border border-[#1A1B20]/10 px-3 py-2 text-xs font-medium text-[#1A1B20] disabled:opacity-50 whitespace-nowrap shrink-0"
                        >
                          <ArrowDownToLine className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>{pulling ? 'Pulling...' : 'Pull main'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleClearToken}
                          className="rounded-lg border border-[#1A1B20]/10 px-2.5 py-2 text-xs font-medium text-[#686C78] hover:text-[#1A1B20] whitespace-nowrap shrink-0"
                        >
                          Clear
                        </button>
                      </>
                    )}
                  </div>
                </form>

                <p className="mt-2 text-[11px] text-[#686C78]">
                  Token stays in browser memory for this session only and is never written to disk or git config.
                </p>

                {authError && (
                  <div className="mt-2.5 flex items-start gap-2 text-xs text-[#DC2626]">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{authError}</span>
                  </div>
                )}
              </section>

              {/* Working Tree & Diff Viewer */}
              <section className="rounded-xl border border-[#1A1B20]/10 bg-white overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1A1B20]/10 px-4 py-3">
                  <div className="flex items-center gap-2 text-xs">
                    <FileCode2 className="h-4 w-4 text-[#1D1E23]" aria-hidden="true" />
                    <span className="font-display font-semibold text-[#1A1B20]">
                      Working Tree Changes
                    </span>
                    <span className="text-[#686C78] font-mono-tabular">
                      · {selectedPaths.size} of {changes.length} selected
                    </span>
                  </div>

                  {changes.length > 0 && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={selectAppEditsOnly}
                        className="rounded-md border border-[#1A1B20]/10 bg-[#F6F7F9] px-2.5 py-1 text-[11px] font-medium text-[#1A1B20] hover:bg-[#ECEEF2] whitespace-nowrap shrink-0"
                      >
                        App edits ({appChangeCount})
                      </button>
                      <button
                        type="button"
                        onClick={selectAllFiles}
                        className="rounded-md border border-[#1A1B20]/10 bg-[#F6F7F9] px-2.5 py-1 text-[11px] font-medium text-[#1A1B20] hover:bg-[#ECEEF2] whitespace-nowrap shrink-0"
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        onClick={clearSelection}
                        className="rounded-md border border-[#1A1B20]/10 bg-white px-2.5 py-1 text-[11px] font-medium text-[#686C78] hover:text-[#1A1B20] whitespace-nowrap shrink-0"
                      >
                        None
                      </button>
                    </div>
                  )}
                </div>

                {changes.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-[#686C78]">
                    Working tree is clean. Make edits in AI Studio and click Refresh to stage and push to{' '}
                    <span className="font-mono text-[#1A1B20]">main</span>.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-12">
                    {/* File List */}
                    <div className="max-h-[260px] md:max-h-[300px] overflow-y-auto border-b border-[#1A1B20]/10 md:col-span-5 md:border-b-0 md:border-r">
                      {changes.map((file) => {
                        const checked = selectedPaths.has(file.path);
                        const isActive = activeDiffPath === file.path;
                        return (
                          <div
                            key={file.path}
                            className={`flex items-center gap-2.5 border-b border-[#1A1B20]/5 px-3 py-2 text-xs transition-colors ${
                              isActive ? 'bg-[#F6F7F9]' : 'hover:bg-[#F6F7F9]/60'
                            }`}
                          >
                            <button
                              type="button"
                              role="checkbox"
                              aria-checked={checked}
                              aria-label={`Stage ${file.path}`}
                              onClick={() => togglePath(file.path)}
                              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                                checked
                                  ? 'border-[#1D1E23] bg-[#1D1E23] text-white'
                                  : 'border-[#1A1B20]/25 bg-white text-transparent'
                              }`}
                            >
                              <Check className="h-3 w-3" aria-hidden="true" />
                            </button>

                            <button
                              type="button"
                              onClick={() => setActiveDiffPath(file.path)}
                              className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
                            >
                              <div className="min-w-0">
                                <div className="truncate font-mono text-[11px] text-[#1A1B20]">
                                  {file.path}
                                </div>
                                <div className="text-[10px] text-[#686C78]">
                                  {file.statusLabel}
                                  {file.isRepoFlowHelper ? ' · Preview helper' : ''}
                                </div>
                              </div>
                              <span
                                className={`font-mono-tabular text-[11px] font-semibold shrink-0 ${statusTextTone(file.statusLabel)}`}
                              >
                                {statusBadgeCode(file.statusLabel)}
                              </span>
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    {/* Diff Inspector */}
                    <div className="flex flex-col md:col-span-7 bg-[#1D1E23] text-[#F6F7F9]">
                      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-[11px] font-mono text-white/70">
                        <span className="truncate">{activeDiffPath ?? 'Select a file to inspect diff'}</span>
                      </div>
                      <div className="max-h-[260px] md:max-h-[268px] overflow-auto p-3 font-mono text-[11px] leading-relaxed">
                        {loadingDiff ? (
                          <div className="text-white/60">Loading diff...</div>
                        ) : !diffText ? (
                          <div className="text-white/50">Select any changed file to inspect its unified diff.</div>
                        ) : (
                          diffText.split('\n').map((line, idx) => {
                            let lineClass = 'text-white/80';
                            if (line.startsWith('+') && !line.startsWith('+++')) {
                              lineClass = 'bg-[#16A34A]/20 text-[#86EFAC]';
                            } else if (line.startsWith('-') && !line.startsWith('---')) {
                              lineClass = 'bg-[#DC2626]/20 text-[#FCA5A5]';
                            } else if (line.startsWith('@@')) {
                              lineClass = 'text-[#93C5FD]';
                            }
                            return (
                              <div key={idx} className={`whitespace-pre-wrap break-all px-1 ${lineClass}`}>
                                {line || ' '}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </section>

              {/* Commit & Push to main */}
              <section className="rounded-xl border border-[#1A1B20]/10 bg-white p-4">
                <form onSubmit={handleCommitAndPush} className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <ArrowUpFromLine className="h-4 w-4 text-[#1D1E23]" aria-hidden="true" />
                      <h3 className="font-display text-xs font-semibold text-[#1A1B20]">
                        Commit &amp; Push to main
                      </h3>
                    </div>
                    <span className="text-[11px] text-[#686C78] font-mono-tabular">
                      origin/main
                    </span>
                  </div>

                  <input
                    type="text"
                    value={commitMessage}
                    onChange={(e) => setCommitMessage(e.target.value)}
                    placeholder="Commit message (e.g. Update pqguide UI and scanner flow)"
                    maxLength={500}
                    aria-label="Commit message"
                    className="w-full rounded-lg border border-[#1A1B20]/15 bg-[#F6F7F9] px-3 py-2 text-xs text-[#1A1B20] placeholder:text-[#686C78]/75 focus:border-[#1D1E23] focus:bg-white focus:outline-none"
                  />

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <input
                      type="text"
                      value={authorName}
                      onChange={(e) => setAuthorName(e.target.value)}
                      placeholder="Git Author Name"
                      aria-label="Git Author Name"
                      className="rounded-lg border border-[#1A1B20]/15 bg-[#F6F7F9] px-3 py-1.5 text-xs text-[#1A1B20] placeholder:text-[#686C78]/75 focus:border-[#1D1E23] focus:bg-white focus:outline-none"
                    />
                    <input
                      type="email"
                      value={authorEmail}
                      onChange={(e) => setAuthorEmail(e.target.value)}
                      placeholder="Git Author Email"
                      aria-label="Git Author Email"
                      className="rounded-lg border border-[#1A1B20]/15 bg-[#F6F7F9] px-3 py-1.5 text-xs text-[#1A1B20] placeholder:text-[#686C78]/75 focus:border-[#1D1E23] focus:bg-white focus:outline-none"
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <div className="text-[11px] text-[#686C78]">
                      {selectedPaths.size > 0
                        ? `Staging ${selectedPaths.size} selected file${selectedPaths.size === 1 ? '' : 's'} to main`
                        : (snapshot?.ahead ?? 0) > 0
                          ? `${snapshot?.ahead} local commit${snapshot?.ahead === 1 ? '' : 's'} ready to push`
                          : 'Select edited files above to commit and push'}
                    </div>

                    <button
                      type="submit"
                      disabled={
                        pushing ||
                        !verifiedToken ||
                        !identity?.repo.canPush ||
                        (selectedPaths.size === 0 && (snapshot?.ahead ?? 0) === 0)
                      }
                      className="tactile-dark inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-medium text-white disabled:opacity-45 whitespace-nowrap shrink-0"
                    >
                      <ArrowUpFromLine className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>
                        {pushing
                          ? 'Pushing to main...'
                          : selectedPaths.size === 0 && (snapshot?.ahead ?? 0) > 0
                            ? 'Push Commits to main'
                            : 'Commit & Push to main'}
                      </span>
                    </button>
                  </div>
                </form>

                {actionError && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-[#DC2626]/20 bg-[#DC2626]/5 p-3 text-xs text-[#DC2626]">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                    <span className="whitespace-pre-wrap break-words">{actionError}</span>
                  </div>
                )}

                {pushSuccess && (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#16A34A]/25 bg-[#16A34A]/5 p-3 text-xs text-[#16A34A]">
                    <div className="flex items-center gap-2 font-medium">
                      <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>
                        Pushed commit <span className="font-mono-tabular">{pushSuccess.shortSha}</span> to main
                      </span>
                    </div>
                    <a
                      href={pushSuccess.commitUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium underline hover:no-underline whitespace-nowrap shrink-0"
                    >
                      View on GitHub
                    </a>
                  </div>
                )}

                {actionLog && (
                  <pre className="mt-3 max-h-[120px] overflow-auto rounded-lg bg-[#1D1E23] p-3 font-mono text-[11px] text-[#E5E7EB] whitespace-pre-wrap break-words">
                    {actionLog}
                  </pre>
                )}
              </section>

              {/* Recent Commits on main */}
              {snapshot && snapshot.commits.length > 0 && (
                <section className="rounded-xl border border-[#1A1B20]/10 bg-white p-4">
                  <div className="mb-2.5 flex items-center gap-2">
                    <GitCommitHorizontal className="h-4 w-4 text-[#1D1E23]" aria-hidden="true" />
                    <h3 className="font-display text-xs font-semibold text-[#1A1B20]">
                      Recent Commits on {snapshot.branch}
                    </h3>
                  </div>
                  <div className="divide-y divide-[#1A1B20]/5">
                    {snapshot.commits.map((c) => (
                      <div key={c.sha} className="flex items-baseline justify-between gap-3 py-2 text-xs">
                        <div className="min-w-0 flex-1">
                          <span className="font-mono-tabular text-[11px] font-medium text-[#1D1E23] mr-2">
                            {c.shortSha}
                          </span>
                          <span className="text-[#1A1B20]">{c.message}</span>
                        </div>
                        <div className="text-[11px] text-[#686C78] whitespace-nowrap shrink-0">
                          {c.author} · {c.relativeDate}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
