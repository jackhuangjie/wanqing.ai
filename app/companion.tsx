'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Bookmark, Check, ChevronRight, Download, Flower2, Heart, MessageCircle, Moon, Plus, Send, Settings2, ShieldCheck, Sparkles, Square, Trash2, Umbrella, UserRound, X } from 'lucide-react';

type Scene='daily'|'walk';
type Message={id:string;role:'user'|'assistant';text:string;at:number;scene:Scene;model?:string;latency?:number};
type Memory={id:string;text:string;at:number};
type Saved={messages:Message[];memories:Memory[];nickname:string;pace:'slow'|'close';adult:boolean;contextAfter:number;scene:Scene};
type Page='home'|'chat'|'memories'|'settings';
type Payload={adultConfirmed:true;messages:{role:string;content:string}[];memories:string[];nickname:string;pace:string;scene:Scene};
type Reply={text?:string;model?:string;incomplete?:boolean;error?:{message?:string}};
const initial:Saved={messages:[],memories:[],nickname:'',pace:'close',adult:false,contextAfter:0,scene:'daily'};
const uuid=()=>crypto.randomUUID();
const date=(at:number)=>new Date(at).toLocaleDateString('zh-CN',{month:'long',day:'numeric'});
const time=(at:number)=>new Date(at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});

export default function Companion({viewerKey}:{viewerKey:string}) {
  const [saved,setSaved]=useState<Saved>(initial),[ready,setReady]=useState(false),[page,setPage]=useState<Page>('home');
  const [draft,setDraft]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[toast,setToast]=useState('');
  const [status,setStatus]=useState<{configured:boolean;model:string}|null>(null);
  const [consent,setConsent]=useState<Scene|null>(null),[agreed,setAgreed]=useState(false);
  const [editing,setEditing]=useState<{id:string|null;text:string}|null>(null);
  const [confirm,setConfirm]=useState<'chat'|'all'|null>(null);
  const control=useRef<AbortController|null>(null),generation=useRef(0),busyRef=useRef(false),lastRequest=useRef<{id:string;body:Payload}|null>(null),end=useRef<HTMLDivElement>(null);
  const key='wanqing-private-v1:'+viewerKey;

  useEffect(()=>{
    try {
      const raw=localStorage.getItem(key);
      if(raw){const s=JSON.parse(raw);setSaved({
        messages:Array.isArray(s.messages)?s.messages.filter((m:Message)=>m&&['user','assistant'].includes(m.role)&&typeof m.text==='string'&&typeof m.at==='number').slice(-180):[],
        memories:Array.isArray(s.memories)?s.memories.filter((m:Memory)=>m&&typeof m.id==='string'&&typeof m.text==='string').slice(0,12).map((m:Memory)=>({...m,text:m.text.slice(0,150)})):[],
        nickname:typeof s.nickname==='string'?s.nickname.slice(0,20):'',pace:s.pace==='slow'?'slow':'close',adult:s.adult===true,
        contextAfter:typeof s.contextAfter==='number'?s.contextAfter:0,scene:s.scene==='walk'?'walk':'daily'
      });}
    }catch{setToast('本机记录无法读取，已开启新的体验。');}
    setReady(true);
    fetch('/api/status').then(r=>r.ok?r.json():Promise.reject()).then(value=>{const s=value as {configured?:unknown;model?:unknown};if(typeof s.configured==='boolean'&&typeof s.model==='string')setStatus({configured:s.configured,model:s.model});}).catch(()=>setStatus(null));
    return ()=>{generation.current++;control.current?.abort();};
  },[key]);
  useEffect(()=>{if(ready)try{localStorage.setItem(key,JSON.stringify(saved));}catch{setToast('浏览器未能保存记录，请及时导出。');}},[saved,ready,key]);
  useEffect(()=>{if(toast){const t=setTimeout(()=>setToast(''),4200);return()=>clearTimeout(t);}},[toast]);
  useEffect(()=>{end.current?.scrollIntoView({behavior:'smooth',block:'end'});},[saved.messages.length,busy,page,error]);
  function stop(){generation.current++;control.current?.abort();control.current=null;busyRef.current=false;setBusy(false);}
  function resetContext(){stop();lastRequest.current=null;setError('');}
  function enter(scene:Scene){
    if(!saved.adult){setConsent(scene);setAgreed(false);return;}
    if(saved.scene!==scene){resetContext();setSaved(s=>({...s,scene,contextAfter:Date.now()}));}
    setPage('chat');
  }
  async function requestReply(body:Payload,id:string){
    if(busyRef.current)return;
    busyRef.current=true;setBusy(true);setError('');
    const token=++generation.current,controller=new AbortController();control.current=controller;
    const started=performance.now();lastRequest.current={body,id};
    try{
      const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json','X-Request-ID':id},body:JSON.stringify(body),signal:controller.signal});
      const result=await response.json().catch(()=>null) as Reply|null;
      if(!response.ok)throw new Error(result?.error?.message||'连接暂时不可用，请稍后重试。');
      if(typeof result?.text!=='string'||!result.text)throw new Error('没有收到回复，请重试。');
      if(token!==generation.current)return;
      const replyText=result.text;
      setSaved(s=>({...s,messages:[...s.messages,{id:uuid(),role:'assistant',text:replyText,at:Date.now(),scene:body.scene,model:result.model,latency:Math.round((performance.now()-started)/100)/10}].slice(-180) as Message[]}));
      lastRequest.current=null;
      if(result.incomplete)setToast('这条回复达到长度限制，可以让晚晴继续说。');
    }catch(e){if(token===generation.current&&!(e instanceof DOMException&&e.name==='AbortError'))setError(e instanceof Error?e.message:'连接中断，请重试。');}
    finally{if(token===generation.current){busyRef.current=false;setBusy(false);control.current=null;}}
  }
  function send(text=draft){
    const value=text.trim();if(!value||busyRef.current||!ready)return;
    if(!saved.adult){setConsent(saved.scene);return;}
    const message:Message={id:uuid(),role:'user',text:value.slice(0,2000),at:Date.now(),scene:saved.scene};
    let history=saved.messages.filter(m=>m.at>saved.contextAfter).slice(-19).map(m=>({role:m.role,content:m.text.slice(0,2000)}));
    while(history.reduce((n,m)=>n+m.content.length,0)>14000)history=history.slice(1);
    const body:Payload={adultConfirmed:true,messages:[...history,{role:'user',content:message.text}],memories:saved.memories.map(m=>m.text),nickname:saved.nickname,pace:saved.pace,scene:saved.scene};
    setSaved(s=>({...s,messages:[...s.messages,message].slice(-180)}));setDraft('');
    void requestReply(body,message.id);
  }
  function saveMemory(){
    const value=editing?.text.trim();if(!value)return;
    if(!editing?.id&&saved.memories.length>=12){setToast('已保存 12 条，请先整理已有记忆。');return;}
    resetContext();
    setSaved(s=>({...s,contextAfter:Date.now(),memories:editing?.id?s.memories.map(m=>m.id===editing.id?{...m,text:value,at:Date.now()}:m):[...s.memories,{id:uuid(),text:value,at:Date.now()}]}));
    setEditing(null);setToast('记忆已保存，接下来的对话会使用这份记忆。');
  }
  function deleteMemory(id:string){resetContext();setSaved(s=>({...s,contextAfter:Date.now(),memories:s.memories.filter(m=>m.id!==id)}));setToast('记忆已删除；新的聊天上下文已开始。');}
  function clearData(){
    resetContext();setDraft('');
    if(confirm==='all'){setSaved({...initial});setPage('home');setToast('本机聊天、记忆和偏好已清除。');}
    else{setSaved(s=>({...s,messages:[],contextAfter:Date.now(),scene:'daily'}));setToast('聊天已清空，已确认的记忆仍保留。');}
    setConfirm(null);
  }
  function exportData(){
    const url=URL.createObjectURL(new Blob([JSON.stringify({exportedAt:new Date().toISOString(),...saved},null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='wanqing-records.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setToast('已导出本机聊天与记忆。');
  }
  const messageInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const input = messageInput.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight + 2, 112) + 'px';
  }, [draft, page]);
  const lastReply=[...saved.messages].reverse().find(m=>m.role==='assistant');
  const totalDays=new Set(saved.messages.map(m=>new Date(m.at).toLocaleDateString())).size;
  return <main className="workspace">
    <aside className="intro">
      <div className="brand"><Flower2 size={28} strokeWidth={1.4}/><span>晚晴<small>WANQING</small></span></div>
      <div className="intro-copy"><span className="eyebrow">A LITTLE CLOSER, EVERY DAY</span><h1>今天的事，<br/>可以慢慢说。</h1><p>留一点时间，给自己。<br/>也给一个愿意听你说话的 AI 女友。</p><div className="intro-line"/><span className="intro-note">温柔有回应，相处有边界。</span></div>
      <div className="private-note"><ShieldCheck size={17}/><div>私享体验版<small>真实 AI 对话 · 手动确认记忆</small></div></div>
    </aside>
    <section className="app" aria-label="晚晴 AI 女友应用">
      <header className="app-header"><div className="header-left">{page==='chat'?<button className="icon-button" aria-label="返回首页" onClick={()=>setPage('home')}><ArrowLeft size={20}/></button>:<span className="tiny-avatar"><Flower2 size={21}/></span>}<div><strong>{page==='memories'?'我们的小事':page==='settings'?'我的空间':'晚晴'}</strong><small>{page==='chat'?'AI 女友 · 回复由模型生成':page==='memories'?'被认真记下的，才会被记住':page==='settings'?'按你的节奏相处':'26 岁 · 虚构成年 AI 角色'}</small></div></div><button className="icon-button" aria-label={page==='chat'?'清空聊天':'打开设置'} onClick={()=>page==='chat'?setConfirm('chat'):setPage('settings')}>{page==='chat'?<Trash2 size={18}/>:<Settings2 size={19}/>}</button></header>
      {page==='home'&&<div className="page-scroll home-page">
        <div className="portrait-card"><span className="portrait-label"><span/> AI COMPANION</span><div className="portrait-sun"/><div className="portrait-arch"><span>晚</span><Flower2 size={62} strokeWidth={.7}/></div><div className="portrait-caption"><span>一起，把日子过得柔软一点。</span><strong>晚晴 <small>Wǎn qíng</small></strong></div></div>
        <div className="hello"><span className="eyebrow">{lastReply?'接着上次的话':'很高兴，在这里遇见你'}</span><h2>{saved.nickname ? `${saved.nickname}，今天过得怎么样？` : '今天过得怎么样？'}</h2><p>{lastReply?lastReply.text.slice(0,90)+(lastReply.text.length>90?'…':''):'我是晚晴。喜欢雨后散步、旧书店，还有认真听完一个故事。今天，想从哪件小事说起？'}</p>{!lastReply&&<small className="script-label">角色开场白</small>}</div>
        <button className="primary big" onClick={()=>enter(saved.scene)} disabled={!ready}><MessageCircle size={18}/> {saved.messages.length?'继续上次的聊天':'聊聊今天'}<ArrowRight size={18}/></button>
        <button className="scene-card" onClick={()=>enter('walk')}><span className="scene-icon"><Umbrella size={24} strokeWidth={1.4}/></span><span><strong>去雨后的街上走走</strong><small>虚拟约会 · 一段不赶时间的散步</small></span><ChevronRight size={17}/></button>
        <p className="home-foot"><span className={status?.configured?'status-dot':'status-dot muted-dot'}/>{status?.configured?'真实模型已配置':'正在等待模型连接'}<span>只需把话说给她听</span></p>
      </div>}
      {page==='chat'&&<div className="chat-page">
        {saved.scene==='walk'&&<div className="scene-banner"><Umbrella size={15}/><span>雨后散步 · 虚拟情境</span><button onClick={()=>{resetContext();setSaved(s=>({...s,scene:'daily',contextAfter:Date.now()}));setToast('已回到日常聊天，虚拟情境不会带入新上下文。');}}>结束约会</button></div>}
        <div className="chat-scroll" aria-live="polite" aria-busy={busy}>
          <div className="conversation-note"><Flower2 size={18}/><span>这里是你和晚晴的 AI 对话</span><small>聊天与记忆保存在当前浏览器</small></div>
          {!saved.messages.length&&<div className="opening"><span className="tiny-avatar"><Flower2 size={20}/></span><div><p>{saved.scene==='walk'?'雨刚停。想不想一起沿着街边走一段？我们可以慢慢聊。':'你来啦。今天有什么想说的？开心的小事，或是藏了一整天的心事，都可以。'}</p><small>角色开场白 · 非模型回复</small></div></div>}
          {saved.messages.map((m,i)=><div key={m.id}>
            {(i===0||date(m.at)!==date(saved.messages[i-1].at))&&<div className="date-line">{date(m.at)}</div>}
            <div className={'message '+m.role}><div className="bubble">{m.text}</div><div className="message-meta"><span>{m.role==='assistant'?'晚晴 · AI':'你'} · {time(m.at)}{m.scene==='walk'?' · 虚拟约会':''}</span>{m.role==='user'&&m.scene!=='walk'&&<button aria-label="将这条消息存为记忆" title="存为记忆" onClick={()=>setEditing({id:null,text:m.text.slice(0,150)})}><Bookmark size={12}/></button>}</div>{m.role==='assistant'&&m.model&&<small className="model-meta">{m.model} · {m.latency} 秒</small>}</div>
          </div>)}
          {busy&&<div className="typing"><span/><span/><span/><small>晚晴正在想怎么回应…</small></div>}
          {error&&<div className="chat-error" role="alert"><p>{error}</p>{lastRequest.current&&<button onClick={()=>{const r=lastRequest.current;if(r)void requestReply(r.body,r.id);}}>重试这条消息</button>}<small>本次未生成回复</small></div>}
          <div ref={end}/>
        </div>
        {!saved.messages.length&&!busy&&!draft.trim()&&<div className="prompts">{(saved.scene==='walk'?['陪我走走吧','想听听你眼里的雨后']:['今天有点累','分享一件开心的小事']).map(t=><button key={t} onClick={()=>{setDraft(t);messageInput.current?.focus();}}>{t}</button>)}</div>}
        <form className="composer" onSubmit={e=>{e.preventDefault();send();}}><label className="sr-only" htmlFor="message">给晚晴发消息</label><textarea ref={messageInput} id="message" placeholder="和晚晴说点什么…" maxLength={2000} value={draft} rows={1} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing&&e.nativeEvent.keyCode!==229&&!window.matchMedia('(pointer: coarse)').matches){e.preventDefault();send();}}}/>{busy?<button type="button" className="send-button" aria-label="停止等待回复" onClick={()=>{stop();setError('已停止等待。需要时可以重试这条消息。');}}><Square size={16}/></button>:<button className="send-button" aria-label="发送消息" disabled={!draft.trim()||!ready}><Send size={17}/></button>}</form><p className="composer-note">{draft.length>=1800?`${draft.length} / 2000 字`:'晚晴是 AI · 回复可能不准确'}</p>
      </div>}
      {page==='memories'&&<div className="page-scroll memories-page"><div className="section-heading"><span className="eyebrow">LITTLE THINGS, HELD CLOSE</span><h2>记得你在意的。</h2><p>只有你确认保存的小事，才会随下一次对话发给晚晴。</p></div><div className="stats"><div><strong>{totalDays}</strong><span>有聊过天的日子</span></div><div><strong>{saved.memories.length}<small> / 12</small></strong><span>你确认的记忆</span></div></div><div className="section-label"><strong>关于你的小事</strong><button className="text-button" onClick={()=>setEditing({id:null,text:''})} disabled={saved.memories.length>=12}><Plus size={15}/>添加记忆</button></div>
        {!saved.memories.length?<div className="empty-state"><Bookmark size={30} strokeWidth={1.2}/><h3>从一件小事开始</h3><p>比如你喜欢的称呼、口味，<br/>或希望晚晴尊重的相处边界。</p><button className="secondary" onClick={()=>setEditing({id:null,text:''})}>记下第一件小事</button></div>:<div className="memory-list">{saved.memories.map(m=><article className="memory-card" key={m.id}><span className="memory-flower"><Flower2 size={20} strokeWidth={1.2}/></span><div><p>{m.text}</p><small>你确认保存 · {date(m.at)}</small><div className="memory-actions"><button onClick={()=>setEditing({id:m.id,text:m.text})}>编辑</button><button onClick={()=>deleteMemory(m.id)}>删除</button></div></div></article>)}</div>}
        <p className="data-note"><ShieldCheck size={15}/>修改或删除记忆会开启新的聊天上下文。已有聊天记录仍可查看，也可在设置中清空。</p></div>}
      {page==='settings'&&<div className="page-scroll settings-page"><div className="profile-card"><span className="profile-icon"><UserRound size={25} strokeWidth={1.4}/></span><div><strong>{saved.nickname||'以你舒服的方式'}</strong><small>这是属于你的相处空间</small></div><Heart size={20} strokeWidth={1.2}/></div>
        <div className="setting-section"><h3>相处偏好</h3><label className="field-label" htmlFor="nickname">希望晚晴怎么称呼你</label><input id="nickname" maxLength={20} placeholder="填写昵称（可选）" value={saved.nickname} onChange={e=>setSaved(s=>({...s,nickname:e.target.value}))}/><span className="field-label">我们的节奏</span><div className="pace-options"><button className={saved.pace==='slow'?'selected':''} onClick={()=>setSaved(s=>({...s,pace:'slow'}))}><Moon size={17}/><strong>慢慢熟悉</strong><small>轻松聊，慢一点靠近</small>{saved.pace==='slow'&&<Check size={14}/>}</button><button className={saved.pace==='close'?'selected':''} onClick={()=>setSaved(s=>({...s,pace:'close'}))}><Heart size={17}/><strong>温柔亲近</strong><small>多一点亲昵和回应</small>{saved.pace==='close'&&<Check size={14}/>}</button></div></div>
        <div className="setting-section"><h3>对话服务</h3><div className="model-card"><Sparkles size={20}/><div><strong>{status?.model||'真实 AI 模型'}</strong><small>{status?.configured?'服务端已配置 · 每条回复独立生成':'模型状态暂时不可用'}</small></div><span className={status?.configured?'status-dot':'status-dot muted-dot'}/></div><p className="setting-explain">发送消息时，最近的对话、昵称和你确认的记忆会提交给 OpenAI。当前体验版提供文字聊天；不包含语音通话或主动推送。</p></div>
        <div className="setting-section"><h3>你的数据，由你做主</h3><p className="setting-explain">记录仅保存在此浏览器，不会跨设备同步。清除浏览器数据会丢失记录。服务端不建立聊天数据库；请求可能在内存中短暂保留用于重试。</p><button className="setting-row" onClick={exportData}><Download size={17}/><span>导出聊天与记忆</span><ChevronRight size={16}/></button><button className="setting-row" onClick={()=>setConfirm('chat')}><MessageCircle size={17}/><span>清空聊天记录</span><ChevronRight size={16}/></button><button className="setting-row danger" onClick={()=>setConfirm('all')}><Trash2 size={17}/><span>清除本机全部数据</span><ChevronRight size={16}/></button></div><p className="footer-note">晚晴是虚构的成年 AI 角色。<br/>愿这里的温柔，也陪你走回真实的生活。</p></div>}
      {page!=='chat'&&<nav className="bottom-nav" aria-label="主导航">{[{id:'home',label:'她',Icon:Flower2},{id:'memories',label:'我们',Icon:Heart},{id:'settings',label:'我的',Icon:UserRound}].map(({id,label,Icon})=><button key={id} className={page===id?'active':''} onClick={()=>setPage(id as Page)} aria-current={page===id?'page':undefined}><Icon size={21} strokeWidth={1.6}/><span>{label}</span></button>)}</nav>}
    </section>
    {toast&&<div className="toast" role="status"><Check size={16}/>{toast}</div>}
    {consent!==null&&<div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="consent-title"><button className="modal-close icon-button" aria-label="关闭" onClick={()=>setConsent(null)}><X size={19}/></button><span className="modal-flower"><Flower2 size={30} strokeWidth={1.3}/></span><h2 id="consent-title">在开始之前</h2><p>晚晴是一位虚构的成年 AI 女友。这里的交流由模型生成，不能替代现实关系或专业帮助。</p><p>发消息时，你的对话和确认保存的记忆将提交给 OpenAI 生成回复。</p><label className="checkbox-row"><input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)}/><span>我已满 18 岁，了解并同意以上说明。</span></label><button className="primary" disabled={!agreed} onClick={()=>{setSaved(s=>({...s,adult:true,scene:consent,contextAfter:Date.now()}));setConsent(null);setPage('chat');}}>开始和晚晴聊天<ArrowRight size={17}/></button></div></div>}
    {editing&&<div className="modal-backdrop"><form className="modal" role="dialog" aria-modal="true" aria-labelledby="memory-title" onSubmit={e=>{e.preventDefault();saveMemory();}}><button type="button" className="modal-close icon-button" aria-label="关闭记忆编辑" onClick={()=>setEditing(null)}><X size={19}/></button><span className="modal-flower"><Bookmark size={28} strokeWidth={1.3}/></span><h2 id="memory-title">{editing.id?'编辑这件小事':'让晚晴记住这件事'}</h2><p>保存后，这条内容会用于之后的对话。请只留下你愿意分享的信息。</p><label className="sr-only" htmlFor="memory">记忆内容</label><textarea id="memory" autoFocus maxLength={150} rows={4} placeholder="比如：我喜欢喝不加糖的乌龙茶。" value={editing.text} onChange={e=>setEditing({...editing,text:e.target.value})}/><div className="character-count">{editing.text.length} / 150</div><button className="primary" disabled={!editing.text.trim()}>确认保存<Check size={17}/></button></form></div>}
    {confirm&&<div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="clear-title"><h2 id="clear-title">{confirm==='all'?'清除全部本机数据？':'清空聊天记录？'}</h2><p>{confirm==='all'?'这会删除此浏览器中的聊天、记忆和偏好，无法撤销。需要留存的话，请先导出。':'聊天记录会从此浏览器删除。你确认保存的记忆会继续保留。'}</p><div className="dialog-actions"><button className="secondary" onClick={()=>setConfirm(null)}>取消</button><button className="primary" onClick={clearData}>确认清除</button></div></div></div>}
  </main>;
}
