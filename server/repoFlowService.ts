import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Request, Response } from 'express';

const execFileAsync = promisify(execFile);

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const GITHUB_API_BASE = 'https://api.github.com';
const MAX_DIFF_BYTES = 64 * 1024;
const GIT_TIMEOUT_MS = 30_000;

const REPO_FLOW_FILES = new Set([
  'server/repoFlowService.ts',
  'src/components/dev/RepoFlowDrawer.tsx',
]);

export interface RepoFileChange {
  path: string;
  indexStatus: string;
  workTreeStatus: string;
  statusLabel: 'Modified' | 'Added' | 'Deleted' | 'Renamed' | 'Untracked';
  isRepoFlowHelper: boolean;
}

export interface RepoCommitEntry {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  relativeDate: string;
  isoDate: string;
}

interface ParsedRemote {
  owner: string;
  repo: string;
  remoteUrl: string;
}

function redactSecret(text: string, token?: string): string {
  let out = text;
  if (token && token.length > 0) {
    out = out.split(token).join('[REDACTED]');
    const basic = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');
    out = out.split(basic).join('[REDACTED]');
  }
  out = out.replace(/(github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9]+|gho_[A-Za-z0-9]+)/g, '[REDACTED]');
  return out;
}

function normalizeToken(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim();
}

function getTokenFromRequest(req: Request): string {
  const headerToken = req.header('x-github-token');
  return normalizeToken(headerToken);
}

function assertSameOriginOrHeader(req: Request): boolean {
  if (req.header('x-requested-with') === 'pqguide-repoflow') {
    return true;
  }
  const origin = req.header('origin');
  const host = req.header('x-forwarded-host') || req.header('host');
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    return parsed.host === host;
  } catch {
    return false;
  }
}

function sanitizeGitSingleLine(value: string, fallback: string, maxLen = 120): string {
  const cleaned = value.replace(/[\r\n\0<>]/g, ' ').trim();
  if (!cleaned) return fallback;
  return cleaned.slice(0, maxLen);
}

function validateRepoRelativePath(rawPath: unknown): string | null {
  if (typeof rawPath !== 'string') return null;
  const trimmed = rawPath.trim();
  if (!trimmed || trimmed.startsWith('-') || trimmed.includes('\0')) {
    return null;
  }
  const normalizedPosix = trimmed.replace(/\\/g, '/');
  const resolved = path.resolve(REPO_ROOT, normalizedPosix);
  if (resolved !== REPO_ROOT && !resolved.startsWith(REPO_ROOT + path.sep)) {
    return null;
  }
  const rel = path.relative(REPO_ROOT, resolved).replace(/\\/g, '/');
  if (!rel || rel === '.' || rel.split('/').includes('.git') || rel.split('/').includes('node_modules')) {
    return null;
  }
  return rel;
}

async function runGit(
  args: string[],
  options?: { token?: string; timeoutMs?: number }
): Promise<{ stdout: string; stderr: string }> {
  const token = options?.token;
  const fullArgs: string[] = [];
  if (token) {
    const b64 = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');
    fullArgs.push('-c', `http.extraheader=Authorization: Basic ${b64}`);
  }
  fullArgs.push(...args);

  try {
    const res = await execFileAsync('git', fullArgs, {
      cwd: REPO_ROOT,
      timeout: options?.timeoutMs ?? GIT_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'never',
      },
    });
    return {
      stdout: redactSecret(res.stdout ?? '', token),
      stderr: redactSecret(res.stderr ?? '', token),
    };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const combined = [e.stderr, e.stdout, e.message].filter(Boolean).join('\n');
    throw new Error(redactSecret(combined || 'Git command failed', token));
  }
}

async function parseOriginRemote(): Promise<ParsedRemote> {
  const { stdout } = await runGit(['remote', 'get-url', 'origin']);
  const remoteUrl = stdout.trim();
  const httpsMatch = remoteUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  const sshMatch = remoteUrl.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  const match = httpsMatch || sshMatch;
  if (!match) {
    throw new Error('Origin remote is not a recognized GitHub repository URL.');
  }
  return {
    owner: match[1],
    repo: match[2],
    remoteUrl: `https://github.com/${match[1]}/${match[2]}.git`,
  };
}

function classifyStatus(indexCode: string, workTreeCode: string): RepoFileChange['statusLabel'] {
  if (indexCode === '?' && workTreeCode === '?') return 'Untracked';
  if (indexCode === 'R' || workTreeCode === 'R') return 'Renamed';
  if (indexCode === 'D' || workTreeCode === 'D') return 'Deleted';
  if (indexCode === 'A' || workTreeCode === 'A') return 'Added';
  return 'Modified';
}

async function getWorkingTreeChanges(): Promise<RepoFileChange[]> {
  const { stdout } = await runGit(['status', '--porcelain=v1', '-z', '-uall']);
  if (!stdout) return [];

  const tokens = stdout.split('\0').filter((t) => t.length > 0);
  const changes: RepoFileChange[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i];
    if (entry.length < 4) continue;
    const indexStatus = entry[0];
    const workTreeStatus = entry[1];
    let filePath = entry.slice(3);

    // Rename entries in -z format are followed by the original path token
    if (indexStatus === 'R' || indexStatus === 'C') {
      i += 1;
    }

    filePath = filePath.replace(/\\/g, '/');
    if (!filePath || filePath.startsWith('.git/')) continue;

    changes.push({
      path: filePath,
      indexStatus,
      workTreeStatus,
      statusLabel: classifyStatus(indexStatus, workTreeStatus),
      isRepoFlowHelper: REPO_FLOW_FILES.has(filePath),
    });
  }

  return changes;
}

async function getAheadBehind(branch: string): Promise<{ ahead: number; behind: number }> {
  try {
    const { stdout } = await runGit([
      'rev-list',
      '--left-right',
      '--count',
      `HEAD...origin/${branch}`,
    ]);
    const parts = stdout.trim().split(/\s+/);
    return {
      ahead: Number.parseInt(parts[0] || '0', 10) || 0,
      behind: Number.parseInt(parts[1] || '0', 10) || 0,
    };
  } catch {
    return { ahead: 0, behind: 0 };
  }
}

async function getRecentCommits(limit = 8): Promise<RepoCommitEntry[]> {
  try {
    const { stdout } = await runGit([
      'log',
      `-n`,
      String(limit),
      '--format=%H%x1f%h%x1f%s%x1f%an%x1f%ar%x1f%cI',
    ]);
    return stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sha = '', shortSha = '', message = '', author = '', relativeDate = '', isoDate = ''] =
          line.split('\x1f');
        return { sha, shortSha, message, author, relativeDate, isoDate };
      });
  } catch {
    return [];
  }
}

async function getRepoSnapshot() {
  const remote = await parseOriginRemote();
  let branch = 'main';
  try {
    const b = await runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
    if (b.stdout.trim()) branch = b.stdout.trim();
  } catch {
    branch = 'main';
  }

  const [changes, counts, commits] = await Promise.all([
    getWorkingTreeChanges(),
    getAheadBehind(branch),
    getRecentCommits(8),
  ]);

  return {
    owner: remote.owner,
    repo: remote.repo,
    fullName: `${remote.owner}/${remote.repo}`,
    remoteUrl: remote.remoteUrl,
    branch,
    ahead: counts.ahead,
    behind: counts.behind,
    changes,
    commits,
  };
}

async function fetchGitHubJson<T>(apiPath: string, token: string): Promise<T> {
  const res = await fetch(`${GITHUB_API_BASE}${apiPath}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'pqguide-repo-flow',
    },
  });
  if (!res.ok) {
    let msg = `GitHub API returned ${res.status}`;
    try {
      const data = (await res.json()) as { message?: string };
      if (data?.message) msg = data.message;
    } catch {
      // ignore parse failure
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export function createRepoFlowHandlers() {
  return {
    async handleStatus(_req: Request, res: Response) {
      try {
        const snapshot = await getRepoSnapshot();
        res.json({ ok: true, ...snapshot });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unable to read repository status.';
        res.status(500).json({ ok: false, error: msg });
      }
    },

    async handleVerify(req: Request, res: Response) {
      if (!assertSameOriginOrHeader(req)) {
        res.status(403).json({ ok: false, error: 'Cross-origin request blocked.' });
        return;
      }
      const token = getTokenFromRequest(req);
      if (!token) {
        res.status(400).json({ ok: false, error: 'Enter a GitHub Personal Access Token.' });
        return;
      }

      try {
        const remote = await parseOriginRemote();
        const [user, repoInfo] = await Promise.all([
          fetchGitHubJson<{
            login: string;
            name: string | null;
            email: string | null;
            avatar_url: string;
          }>('/user', token),
          fetchGitHubJson<{
            full_name: string;
            default_branch: string;
            private: boolean;
            permissions?: { admin?: boolean; push?: boolean; pull?: boolean };
          }>(`/repos/${encodeURIComponent(remote.owner)}/${encodeURIComponent(remote.repo)}`, token),
        ]);

        let resolvedEmail = user.email;
        if (!resolvedEmail) {
          try {
            const emails = await fetchGitHubJson<
              Array<{ email: string; primary: boolean; verified: boolean }>
            >('/user/emails', token);
            const primary = emails.find((e) => e.primary && e.verified) || emails[0];
            if (primary?.email) resolvedEmail = primary.email;
          } catch {
            // Fine-grained PATs without user:email read permission fall back cleanly
          }
        }

        // Refresh origin/main tracking ref in memory without altering working tree
        try {
          await runGit(['fetch', 'origin', 'main'], { token });
        } catch {
          // Non-fatal if branch differs or network hiccups; repo snapshot still returns
        }

        const snapshot = await getRepoSnapshot();
        res.json({
          ok: true,
          user: {
            login: user.login,
            name: user.name || user.login,
            email: resolvedEmail || `${user.login}@users.noreply.github.com`,
            avatarUrl: user.avatar_url,
          },
          repo: {
            fullName: repoInfo.full_name,
            defaultBranch: repoInfo.default_branch,
            private: repoInfo.private,
            canPush: Boolean(repoInfo.permissions?.push || repoInfo.permissions?.admin),
          },
          snapshot,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'GitHub token verification failed.';
        res.status(401).json({ ok: false, error: redactSecret(msg, token) });
      }
    },

    async handleDiff(req: Request, res: Response) {
      if (!assertSameOriginOrHeader(req)) {
        res.status(403).json({ ok: false, error: 'Cross-origin request blocked.' });
        return;
      }
      const relPath = validateRepoRelativePath(req.body?.path);
      if (!relPath) {
        res.status(400).json({ ok: false, error: 'Invalid file path.' });
        return;
      }

      try {
        const changes = await getWorkingTreeChanges();
        const entry = changes.find((c) => c.path === relPath);

        if (entry?.statusLabel === 'Untracked') {
          const absPath = path.resolve(REPO_ROOT, relPath);
          const stat = await fs.stat(absPath);
          if (stat.size > MAX_DIFF_BYTES) {
            res.json({
              ok: true,
              path: relPath,
              diff: `New file (${Math.round(stat.size / 1024)} KB) — preview truncated for large file.`,
            });
            return;
          }
          const buf = await fs.readFile(absPath);
          if (buf.includes(0)) {
            res.json({ ok: true, path: relPath, diff: 'Binary file (preview unavailable).' });
            return;
          }
          const lines = buf.toString('utf8').split('\n');
          const formatted = [
            `--- /dev/null`,
            `+++ b/${relPath}`,
            `@@ -0,0 +1,${lines.length} @@`,
            ...lines.map((l) => `+${l}`),
          ].join('\n');
          res.json({ ok: true, path: relPath, diff: formatted });
          return;
        }

        const { stdout } = await runGit(['diff', 'HEAD', '--', relPath]);
        const diffText =
          stdout.length > MAX_DIFF_BYTES
            ? `${stdout.slice(0, MAX_DIFF_BYTES)}\n\n... diff truncated at 64 KB ...`
            : stdout || 'No textual diff available (mode or binary change).';
        res.json({ ok: true, path: relPath, diff: diffText });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unable to load diff.';
        res.status(500).json({ ok: false, error: msg });
      }
    },

    async handlePull(req: Request, res: Response) {
      if (!assertSameOriginOrHeader(req)) {
        res.status(403).json({ ok: false, error: 'Cross-origin request blocked.' });
        return;
      }
      const token = getTokenFromRequest(req);
      if (!token) {
        res.status(400).json({ ok: false, error: 'GitHub token is required to pull from origin.' });
        return;
      }

      try {
        await runGit(['fetch', 'origin', 'main'], { token });
        let output = '';
        try {
          const pullRes = await runGit(['pull', '--ff-only', 'origin', 'main'], { token });
          output = [pullRes.stdout, pullRes.stderr].filter(Boolean).join('\n').trim();
        } catch {
          const authorName = sanitizeGitSingleLine(
            typeof req.body?.authorName === 'string' ? req.body.authorName : '',
            'twealthdigital'
          );
          const authorEmail = sanitizeGitSingleLine(
            typeof req.body?.authorEmail === 'string' ? req.body.authorEmail : '',
            'noreply@users.noreply.github.com'
          );
          const mergeRes = await runGit(
            [
              '-c',
              `user.name=${authorName}`,
              '-c',
              `user.email=${authorEmail}`,
              'pull',
              '--no-rebase',
              '--no-edit',
              'origin',
              'main',
            ],
            { token }
          );
          output = [mergeRes.stdout, mergeRes.stderr].filter(Boolean).join('\n').trim();
        }

        const snapshot = await getRepoSnapshot();
        res.json({
          ok: true,
          output: output || 'Already up to date with origin/main.',
          snapshot,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Pull from origin/main failed.';
        res.status(409).json({ ok: false, error: redactSecret(msg, token) });
      }
    },

    async handlePush(req: Request, res: Response) {
      if (!assertSameOriginOrHeader(req)) {
        res.status(403).json({ ok: false, error: 'Cross-origin request blocked.' });
        return;
      }
      const token = getTokenFromRequest(req);
      if (!token) {
        res.status(400).json({ ok: false, error: 'GitHub token is required to push to main.' });
        return;
      }

      const rawFiles = Array.isArray(req.body?.files) ? (req.body.files as unknown[]) : [];
      const validatedFiles: string[] = [];
      for (const item of rawFiles) {
        const valid = validateRepoRelativePath(item);
        if (!valid) {
          res.status(400).json({ ok: false, error: 'Selection contains an invalid file path.' });
          return;
        }
        validatedFiles.push(valid);
      }

      const pushOnly = Boolean(req.body?.pushOnly);
      const rawMessage = typeof req.body?.message === 'string' ? req.body.message.trim() : '';

      if (!pushOnly && validatedFiles.length === 0) {
        res.status(400).json({ ok: false, error: 'Select at least one edited file to commit and push.' });
        return;
      }

      if (validatedFiles.length > 0 && !rawMessage) {
        res.status(400).json({ ok: false, error: 'Enter a commit message before pushing.' });
        return;
      }

      if (rawMessage.length > 500) {
        res.status(400).json({ ok: false, error: 'Commit message must be 500 characters or fewer.' });
        return;
      }

      const authorName = sanitizeGitSingleLine(
        typeof req.body?.authorName === 'string' ? req.body.authorName : '',
        'twealthdigital'
      );
      const authorEmail = sanitizeGitSingleLine(
        typeof req.body?.authorEmail === 'string' ? req.body.authorEmail : '',
        'noreply@users.noreply.github.com'
      );

      try {
        const remote = await parseOriginRemote();
        let commitOutput = '';

        if (validatedFiles.length > 0) {
          // Stage only the selected files, then commit exclusively those paths
          await runGit(['add', '-A', '--', ...validatedFiles]);
          const commitRes = await runGit([
            '-c',
            `user.name=${authorName}`,
            '-c',
            `user.email=${authorEmail}`,
            'commit',
            '-m',
            rawMessage,
            '--only',
            '--',
            ...validatedFiles,
          ]);
          commitOutput = [commitRes.stdout, commitRes.stderr].filter(Boolean).join('\n').trim();
        }

        const pushRes = await runGit(['push', 'origin', 'HEAD:main'], { token });
        const pushOutput = [pushRes.stdout, pushRes.stderr].filter(Boolean).join('\n').trim();

        const headRes = await runGit(['rev-parse', 'HEAD']);
        const commitSha = headRes.stdout.trim();
        const shortSha = commitSha.slice(0, 7);
        const snapshot = await getRepoSnapshot();

        res.json({
          ok: true,
          commitSha,
          shortSha,
          commitUrl: `https://github.com/${remote.owner}/${remote.repo}/commit/${commitSha}`,
          output: [commitOutput, pushOutput].filter(Boolean).join('\n\n') || `Pushed ${shortSha} to main.`,
          snapshot,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Push to origin/main failed.';
        res.status(409).json({ ok: false, error: redactSecret(msg, token) });
      }
    },
  };
}
