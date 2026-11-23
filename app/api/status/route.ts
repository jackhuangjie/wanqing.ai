import { env } from 'cloudflare:workers';
import { DEFAULT_MODEL } from '../../../lib/chat.mjs';
export const dynamic='force-dynamic';
export async function GET() {
  const config=env as unknown as Record<string,string>;
  return Response.json({configured:!!config.OPENAI_API_KEY,model:config.OPENAI_MODEL||DEFAULT_MODEL},{headers:{'Cache-Control':'no-store'}});
}
