import {
  defaultAiHttpHandlers,
  type NodeHttpRequest,
  type NodeHttpResponse,
} from '../../server/httpAdapter.ts';

export default async function handler(req: NodeHttpRequest, res: NodeHttpResponse) {
  return defaultAiHttpHandlers.handleStatus(req, res);
}
