import { defaultOtpHttpHandlers, type NodeHttpRequest, type NodeHttpResponse } from '../../../server/httpAdapter.ts';

export default async function handler(req: NodeHttpRequest, res: NodeHttpResponse) {
  return defaultOtpHttpHandlers.handleSend(req, res);
}
