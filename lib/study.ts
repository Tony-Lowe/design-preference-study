import {env} from 'cloudflare:workers';
import data from '@/data/cases.json';
export const STUDY=data as typeof data & {cases:Array<(typeof data.cases)[number] & {layoutOverlay?:string;subjectOverlay?:string}>};
export type Method='ours'|'creatidesign'|'uno';
export type Pool='user_selected'|'prior_reviewed';
export type Trial={id:string;caseId:string;left:Method;right:Method;pool:Pool};
export function dimensions(_t:Trial){return ['aesthetic','adherence'];}
export type Session={id:string;token_hash:string;version:string;assignments:string;created_at:string;demo:number;ip_address:string|null};
export type Vote={session_id:string;trial_id:string;dimension:string;choice:string;reasons:string;comment:string;elapsed_ms:number;created_at:string};
export function db(){const binding=(env as unknown as {DB?:D1Database}).DB;if(!binding)throw Error('Study database is unavailable');return binding;}
export function json(body:unknown,status=200,headers:Record<string,string>={}){return Response.json(body,{status,headers:{'Cache-Control':'no-store',...headers}});}
export async function hash(s:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');}
export function cookie(req:Request){const auth=req.headers.get('authorization');if(auth?.startsWith('Participant '))return auth.slice(12);return req.headers.get('cookie')?.match(/(?:^|; )study_token=([^;]+)/)?.[1]||'';}
export async function session(req:Request,bodyToken?:unknown):Promise<Session|null>{const t=typeof bodyToken==='string'?bodyToken:cookie(req);if(!/^[0-9a-f-]{72,74}$/.test(t))return null;return await db().prepare('SELECT * FROM study_sessions WHERE token_hash = ?').bind(await hash(t)).first<Session>();}
export function cookieHeader(token:string,req:Request,age=2592000){return `study_token=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${new URL(req.url).protocol==='https:'?'; Secure':''}`;}
export function sameOrigin(req:Request){const origin=req.headers.get('origin');if(origin&&origin!==new URL(req.url).origin&&!allowedOrigin(req))throw Error('Origin mismatch');}
export async function payload(req:Request,maxLength=6000){const s=await req.text();if(s.length>maxLength)throw Error('Request too large');return JSON.parse(s);}
function randInt(n:number){const ceiling=Math.floor(4294967296/n)*n;const a=new Uint32Array(1);do{crypto.getRandomValues(a);}while(a[0]>=ceiling);return a[0]%n;}
export function shuffle<T>(a:T[]){const out=[...a];for(let i=out.length-1;i>0;i--){const j=randInt(i+1);[out[i],out[j]]=[out[j],out[i]];}return out;}
export function assignments():Trial[]{
 // Complement the odd per-pool counts: each opponent has exactly three
 // ours-left and three ours-right comparisons over the whole session.
 const extraLeft={creatidesign:randInt(2),uno:randInt(2)};
 return shuffle((['user_selected','prior_reviewed'] as Pool[]).flatMap(pool=>{
  const ids=shuffle(STUDY.cases.filter(c=>c.pool===pool).map(c=>c.id)).slice(0,6);
  if(ids.length!==6)throw Error('Each study pool needs at least six cases');
  const sequence=shuffle((['creatidesign','uno'] as const).flatMap(opponent=>{
   const leftCount=1+(pool==='user_selected'?extraLeft[opponent]:1-extraLeft[opponent]);
   return Array.from({length:3},(_,i)=>(i<leftCount?['ours',opponent]:[opponent,'ours']) as [Method,Method]);
  }));
  return ids.map((caseId,i)=>({id:crypto.randomUUID(),caseId,pool,left:sequence[i][0],right:sequence[i][1]}));
 }));
}
export function validOfflineAssignments(value:unknown):value is Trial[]{
 if(!Array.isArray(value)||value.length!==12)return false;
 const ids=new Set<string>(),cases=new Set<string>();
 const counts={user_selected:{creatidesign:0,uno:0},prior_reviewed:{creatidesign:0,uno:0}};
 const left={creatidesign:0,uno:0};
 for(const t of value){
  if(!t||typeof t!=='object'||!/^[-0-9a-f]{36}$/.test(t.id)||typeof t.caseId!=='string'||ids.has(t.id)||cases.has(t.caseId))return false;
  const c=STUDY.cases.find(item=>item.id===t.caseId);
  if(!c||c.pool!==t.pool||!['user_selected','prior_reviewed'].includes(t.pool))return false;
  if(t.left!=='ours'&&t.right!=='ours')return false;
  const opponent=t.left==='ours'?t.right:t.left;
  if(!['creatidesign','uno'].includes(opponent))return false;
  if(t.left==='ours')left[opponent as 'creatidesign'|'uno']++;
  counts[t.pool as Pool][opponent as 'creatidesign'|'uno']++;
  ids.add(t.id);cases.add(t.caseId);
 }
 return counts.user_selected.creatidesign===3&&counts.user_selected.uno===3&&counts.prior_reviewed.creatidesign===3&&counts.prior_reviewed.uno===3&&left.creatidesign===3&&left.uno===3;
}
export async function getVotes(s:Session){const r=await db().prepare('SELECT * FROM study_votes WHERE session_id = ?').bind(s.id).all<Vote>();return r.results;}
export function publicPlan(s:Session){return (JSON.parse(s.assignments) as Trial[]).map((t,i)=>{const c=STUDY.cases.find(item=>item.id===t.caseId)!;return {id:t.id,index:i+1,images:[c.panels[t.left],c.panels[t.right]],prompt:c.prompt,requirements:{prompt:c.prompt,semantic:c.panels.semantic,pixel:c.panels.pixel,...(c.layoutOverlay?{layoutOverlay:c.layoutOverlay}:{}),...(c.subjectOverlay?{subjectOverlay:c.subjectOverlay}:{})}};});}
export function voteProgress(v:Vote[]){return v.map(item=>({trialId:item.trial_id,dimension:item.dimension,choice:item.choice}));}
export function next(s:Session,v:Vote[]){for(const t of JSON.parse(s.assignments) as Trial[]){for(const dimension of dimensions(t))if(!v.some(x=>x.trial_id===t.id&&x.dimension===dimension))return {trial:t,dimension};}return null;}
export async function publicState(s:Session,votes?:Vote[]){
 if(s.version!==STUDY.version)return {active:true,demo:!!s.demo,stale:true,error:'研究样本已更新，请撤回旧记录后重新开始。'};
 const v=votes??await getVotes(s);const n=next(s,v);const ts=JSON.parse(s.assignments) as Trial[];
 const base={active:true,participant:s.id.slice(0,8),version:s.version,mode:STUDY.mode,demo:!!s.demo,total:ts.length,totalJudgments:ts.reduce((sum,t)=>sum+dimensions(t).length,0),completed:ts.filter(t=>dimensions(t).every(d=>v.some(x=>x.trial_id===t.id&&x.dimension===d))).length,saved:v.length};
 if(!n)return {...base,done:true};
 const c=STUDY.cases.find(c=>c.id===n.trial.caseId)!;
 return {...base,done:false,trial:{id:n.trial.id,pool:n.trial.pool,index:ts.findIndex(t=>t.id===n.trial.id)+1,dimension:n.dimension,images:[c.panels[n.trial.left],c.panels[n.trial.right]],prompt:c.prompt,...(n.dimension==='adherence'?{requirements:{prompt:c.prompt,semantic:c.panels.semantic,pixel:c.panels.pixel,...((c as {layoutOverlay?:string}).layoutOverlay?{layoutOverlay:(c as {layoutOverlay?:string}).layoutOverlay}:{}),...((c as {subjectOverlay?:string}).subjectOverlay?{subjectOverlay:(c as {subjectOverlay?:string}).subjectOverlay}:{})}}:{})}};
}
export async function isAdmin(req:Request){const key=(env as unknown as {STUDY_ADMIN_KEY?:string}).STUDY_ADMIN_KEY;const supplied=req.headers.get('authorization')?.replace(/^Bearer /,'');return !!key&&!!supplied&&(await hash(key))===(await hash(supplied));}

export function allowedOrigin(req:Request){const origin=req.headers.get('origin');return !!origin&&origin==='https://tony-lowe.github.io';}
export function api(handler:(req:Request)=>Promise<Response>){return async(req:Request)=>{const response=await handler(req);if(allowedOrigin(req)){response.headers.set('Access-Control-Allow-Origin',req.headers.get('origin')!);response.headers.set('Vary','Origin');response.headers.set('Access-Control-Expose-Headers','Content-Disposition');}return response;};}
export function preflight(req:Request){if(!allowedOrigin(req))return new Response(null,{status:403});return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':req.headers.get('origin')!,'Access-Control-Allow-Methods':'GET, POST, DELETE, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Max-Age':'600','Vary':'Origin'}});}
