import { env } from 'cloudflare:workers';
import { callModel, ChatError, DEFAULT_MODEL, validateChat } from '../../../lib/chat.mjs';

export const dynamic = 'force-dynamic';
const requests = new Map<string, number[]>();
const inFlight = new Set<string>();
const completed = new Map<string,{at:number;fingerprint:string;result:unknown}>();
const json = (value:unknown,status=200) => Response.json(value,{status,headers:{'Cache-Control':'no-store'}});

// This endpoint relies on the owner-private Sites access boundary, including
// authorized service access. Revisit authorization before changing the audience.
export async function POST(request:Request) {
  let id = '';
  let ownsFlight = false;
  try {
    const origin=request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) throw new ChatError('请求来源无效。',403);
    if (!request.headers.get('content-type')?.includes('application/json')) throw new ChatError('请发送 JSON 请求。',415);
    if (Number(request.headers.get('content-length')) > 80000) throw new ChatError('消息太长。',413);
    const raw=await request.text();
    if (new TextEncoder().encode(raw).length > 80000) throw new ChatError('消息太长。',413);
    let body; try { body=JSON.parse(raw); } catch { throw new ChatError('请求格式不正确。'); }
    const data=validateChat(body);
    const suppliedId=request.headers.get('x-request-id');
    if (!suppliedId || !/^[a-zA-Z0-9-]{16,64}$/.test(suppliedId)) throw new ChatError('缺少有效请求编号。');
    const viewer=request.headers.get('oai-authenticated-user-id') || 'private-service';
    id=viewer+':'+suppliedId;
    const now=Date.now();
    for (const [key,value] of completed) if (now-value.at>300000) completed.delete(key);
    const fingerprint=JSON.stringify(data);
    const cached=completed.get(id);
    if (cached) {
      if (cached.fingerprint!==fingerprint) throw new ChatError('请求编号已用于其他消息。',409);
      return json(cached.result);
    }
    if (inFlight.has(id)) throw new ChatError('上一条请求仍在处理中，请稍后重试。',409);
    const recent=(requests.get(viewer)||[]).filter(t=>now-t<60000);
    if (recent.length>=10) throw new ChatError('发送有点快，每分钟最多 10 次，请稍后再试。',429,'rate_limit');
    requests.set(viewer,[...recent,now]);
    inFlight.add(id);
    ownsFlight = true;
    const config=env as unknown as Record<string,string>;
    const result=await callModel(data,config.OPENAI_API_KEY,config.OPENAI_MODEL||DEFAULT_MODEL,fetch,AbortSignal.timeout(45000));
    completed.set(id,{at:Date.now(),fingerprint,result});
    if(completed.size>100) completed.delete(completed.keys().next().value!);
    return json(result);
  } catch (error) {
    if(error instanceof ChatError) return json({error:{code:error.code,message:error.message}},error.status);
    if(error instanceof Error && ['TimeoutError','AbortError'].includes(error.name)) return json({error:{code:'timeout',message:'这次回复等待较久，请重试。'}},504);
    return json({error:{code:'unavailable',message:'连接暂时中断，请稍后重试。'}},502);
  } finally { if(ownsFlight) inFlight.delete(id); }
}
