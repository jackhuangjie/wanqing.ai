import { env } from 'cloudflare:workers';
import { callModel, ChatError, DEFAULT_MODEL, validateChat } from '../../../lib/chat.mjs';

export const dynamic = 'force-dynamic';
const requests = new Map<string, number[]>();
const inFlight = new Set<string>();
const completed = new Map<string,{at:number;fingerprint:string;result:unknown}>();
const json = (value:unknown,status=200) => Response.json(value,{status,headers:{'Cache-Control':'no-store'}});

export async function POST(request:Request) {
  let id = '';
  let ownsFlight = false;
  try {
    const viewer=request.headers.get('oai-authenticated-user-id');
    if (!viewer || !request.headers.get('oai-authenticated-user-email')) throw new ChatError('请先登录 ChatGPT，再开始免费试聊。',401);
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
    if (!env.DB || !config.OPENAI_API_KEY) throw new ChatError('试聊服务暂未就绪，请稍后再来。',503);
    const day = new Date(Date.now()+8*3600000).toISOString().slice(0,10);
    const quota = await env.DB.prepare(`
      INSERT INTO daily_usage(day,viewer,attempts)
      SELECT ?,?,1 WHERE (SELECT COALESCE(SUM(attempts),0) FROM daily_usage WHERE day=?) < 300
      ON CONFLICT(day,viewer) DO UPDATE SET attempts=attempts+1 WHERE attempts<10
    `).bind(day,viewer,day).run();
    if (!quota.meta.changes) throw new ChatError('你或全站的今日试聊额度已用完，北京时间零点恢复。',429,'daily_limit');
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
