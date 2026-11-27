import {
  defaultSuperAdminHttpHandlers,
  type NodeHttpRequest,
  type NodeHttpResponse,
} from '../../../server/httpAdapter.ts';

export default async function handler(req: NodeHttpRequest, res: NodeHttpResponse) {
  return defaultSuperAdminHttpHandlers.handleInitVerifyOtp(req, res);
}
