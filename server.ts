import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import express, { type Request, type Response } from 'express';
import {
  createDocumentHttpHandlers,
  createOtpHttpHandlers,
  createSuperAdminHttpHandlers,
} from './server/httpAdapter.ts';
import { createOtpEngine, type OtpEngineDeps } from './server/otpService.ts';
import { createRepoFlowHandlers } from './server/repoFlowService.ts';
import { createSuperAdminEngine } from './server/superAdminService.ts';

dotenv.config({ path: path.resolve(import.meta.dirname, '.env.local') });
dotenv.config({ path: path.resolve(import.meta.dirname, '.env') });

export function createApiApp(deps?: OtpEngineDeps) {
  const app = express();
  app.set('trust proxy', 1);

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  app.use('/api/auth', express.json({ limit: '64kb' }));
  app.use('/api/documents', express.json({ limit: '8mb' }));
  app.use('/api/repo', express.json({ limit: '256kb' }));

  const otpEngine = deps ? createOtpEngine(deps) : undefined;
  const handlers = otpEngine
    ? createOtpHttpHandlers(otpEngine)
    : createOtpHttpHandlers();
  const superAdminHandlers = deps
    ? createSuperAdminHttpHandlers(
        createSuperAdminEngine({ ...deps, otpEngine })
      )
    : createSuperAdminHttpHandlers();
  const documentHandlers = deps
    ? createDocumentHttpHandlers()
    : createDocumentHttpHandlers();
  const repoFlowHandlers = createRepoFlowHandlers();

  app.get('/api/auth/email-otp/status', (req: Request, res: Response) => {
    void handlers.handleStatus(req, res);
  });

  app.post('/api/auth/email-otp/send', (req: Request, res: Response) => {
    void handlers.handleSend(req, res);
  });

  app.post('/api/auth/email-otp/verify', (req: Request, res: Response) => {
    void handlers.handleVerify(req, res);
  });

  app.post('/api/auth/email-otp/consume-reset', (req: Request, res: Response) => {
    void handlers.handleConsumeReset(req, res);
  });

  app.get('/api/auth/super-admin/status', (req: Request, res: Response) => {
    void superAdminHandlers.handleStatus(req, res);
  });

  app.post('/api/auth/super-admin/init-otp', (req: Request, res: Response) => {
    void superAdminHandlers.handleInitOtp(req, res);
  });

  app.post('/api/auth/super-admin/init-verify-otp', (req: Request, res: Response) => {
    void superAdminHandlers.handleInitVerifyOtp(req, res);
  });

  app.post('/api/auth/super-admin/init', (req: Request, res: Response) => {
    void superAdminHandlers.handleInit(req, res);
  });

  app.post('/api/auth/super-admin/login', (req: Request, res: Response) => {
    void superAdminHandlers.handleLogin(req, res);
  });

  app.post('/api/auth/super-admin/verify-totp', (req: Request, res: Response) => {
    void superAdminHandlers.handleVerifyTotp(req, res);
  });

  app.post('/api/auth/super-admin/session', (req: Request, res: Response) => {
    void superAdminHandlers.handleVerifySession(req, res);
  });

  app.get('/api/auth/super-admin/session', (req: Request, res: Response) => {
    void superAdminHandlers.handleVerifySession(req, res);
  });

  app.post('/api/auth/super-admin/logout', (req: Request, res: Response) => {
    void superAdminHandlers.handleLogout(req, res);
  });

  app.post('/api/auth/super-admin/logout-all', (req: Request, res: Response) => {
    void superAdminHandlers.handleLogoutAll(req, res);
  });

  app.post('/api/auth/super-admin/forgot', (req: Request, res: Response) => {
    void superAdminHandlers.handleForgot(req, res);
  });

  app.post('/api/auth/super-admin/reset-password', (req: Request, res: Response) => {
    void superAdminHandlers.handleResetPassword(req, res);
  });

  app.post('/api/documents/vision-ocr', (req: Request, res: Response) => {
    void documentHandlers.handleVisionOcr(req, res);
  });

  app.post('/api/documents/validate', (req: Request, res: Response) => {
    void documentHandlers.handleValidate(req, res);
  });

  app.post('/api/documents/cross-check', (req: Request, res: Response) => {
    void documentHandlers.handleCrossCheck(req, res);
  });

  app.get('/api/repo/status', (req: Request, res: Response) => {
    void repoFlowHandlers.handleStatus(req, res);
  });

  app.post('/api/repo/verify', (req: Request, res: Response) => {
    void repoFlowHandlers.handleVerify(req, res);
  });

  app.post('/api/repo/diff', (req: Request, res: Response) => {
    void repoFlowHandlers.handleDiff(req, res);
  });

  app.post('/api/repo/pull', (req: Request, res: Response) => {
    void repoFlowHandlers.handlePull(req, res);
  });

  app.post('/api/repo/push', (req: Request, res: Response) => {
    void repoFlowHandlers.handlePush(req, res);
  });

  return app;
}

async function startServer() {
  const PORT = Number(process.env.PORT || 3000);
  const HOST = '0.0.0.0';
  const IS_PRODUCTION = process.env.NODE_ENV === 'production';

  const app = createApiApp();

  if (!IS_PRODUCTION) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(import.meta.dirname, 'dist');
    const indexHtml = path.join(distDir, 'index.html');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`PQGuide server listening on http://${HOST}:${PORT}`);
  });
}

const isEntrypoint =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);

if (isEntrypoint) {
  startServer().catch((err) => {
    console.error('Failed to start PQGuide server:', err);
    process.exit(1);
  });
}
