import {createServer} from 'node:http';
import {createHash,timingSafeEqual} from 'node:crypto';
import {isIP} from 'node:net';
import {pathToFileURL} from 'node:url';
import manifest from './study-manifest.json' with {type:'json'};

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tokenPattern=/^[0-9a-f-]{72,74}$/;
const dimensions=['aesthetic','adherence'];
const choices=['A','B','tie','skip'];
const reasons=['regional','layout','text','subject','other'];
const sha256=value=>createHash('sha256').update(value).digest('hex');
const response=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});

export function validAssignments(value){
 if(!Array.isArray(value)||value.length!==12)return false;
 const ids=new Set(),cases=new Set(),counts={user_selected:{creatidesign:0,uno:0},prior_reviewed:{creatidesign:0,uno:0}},left={creatidesign:0,uno:0};
 for(const t of value){
  if(!t||typeof t!=='object'||!uuid.test(t.id)||typeof t.caseId!=='string'||ids.has(t.id)||cases.has(t.caseId))return false;
  const c=manifest.cases.find(item=>item.id===t.caseId);
  if(!c||c.pool!==t.pool||!Object.hasOwn(counts,t.pool))return false;
  if((t.left==='ours')===(t.right==='ours'))return false;
  const opponent=t.left==='ours'?t.right:t.left;
  if(!['creatidesign','uno'].includes(opponent))return false;
  if(t.left==='ours')left[opponent]++;
  counts[t.pool][opponent]++;ids.add(t.id);cases.add(t.caseId);
 }
 return counts.user_selected.creatidesign===3&&counts.user_selected.uno===3&&counts.prior_reviewed.creatidesign===3&&counts.prior_reviewed.uno===3&&left.creatidesign===3&&left.uno===3;
}

export function normalizeAnswer(body){
 if(!body||body.kind!=='design-preference-study-offline-answer'||body.version!==manifest.version||!body.session||!uuid.test(body.session.id)||body.session.version!==manifest.version||!validAssignments(body.session.assignments)||!tokenPattern.test(body.token||'')||body.participant!==body.session.id.slice(0,8)||typeof body.demo!=='boolean'||!Array.isArray(body.votes)||body.votes.length<1||body.votes.length>24)throw Error('Invalid answer');
 const expected=body.session.assignments.flatMap(t=>dimensions.map(d=>`${t.id}:${d}`));
 const votes=body.votes.map((v,i)=>{
  if(!v||`${v.trialId}:${v.dimension}`!==expected[i]||!choices.includes(v.choice))throw Error('Invalid vote order');
  const comment=typeof v.comment==='string'?v.comment.trim().slice(0,500):'';
  const selectedReasons=Array.isArray(v.reasons)?[...new Set(v.reasons.filter(x=>reasons.includes(x)))].sort():[];
  const elapsedMs=typeof v.elapsedMs==='number'&&Number.isFinite(v.elapsedMs)?Math.max(0,Math.min(3600000,Math.round(v.elapsedMs))):0;
  return {trialId:v.trialId,dimension:v.dimension,choice:v.choice,reasons:selectedReasons,comment,elapsedMs};
 });
 return {kind:body.kind,version:manifest.version,participant:body.participant,token:body.token,session:{id:body.session.id,version:manifest.version,assignments:body.session.assignments.map(t=>({id:t.id,caseId:t.caseId,pool:t.pool,left:t.left,right:t.right}))},demo:body.demo,votes};
}

function adminAllowed(req,key){const supplied=req.headers.get('authorization')?.replace(/^Bearer /,'')??'';if(!key||!supplied)return false;const a=Buffer.from(sha256(key)),b=Buffer.from(sha256(supplied));return timingSafeEqual(a,b);}
function cors(origin,allowed){return origin&&allowed.includes(origin)?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{};}
async function bodyJson(req){const raw=await req.text();if(raw.length>65536)throw Error('Request too large');return JSON.parse(raw);}
function clientIp(req){
 // The CloudBase gateway supplies these proxy headers. Do not accept an IP in
 // the participant's JSON body; missing/invalid gateway headers remain null.
 for(const name of ['x-real-ip','x-original-forwarded-for','x-forwarded-for']){
  const value=req.headers.get(name)?.split(',')[0]?.trim();if(value&&isIP(value))return value;
 }
 return null;
}

export function makeHandler({store,adminKey,allowedOrigins=['https://tony-lowe.github.io','https://canvas-preference-study.tonylowe001031.chatgpt.site']}={}){
 if(!store)throw Error('Store is required');
 return async function handle(req){
  const url=new URL(req.url),origin=req.headers.get('origin');
  const pathname=url.pathname.replace(/^\/study-relay(?=\/|$)/,'')||'/';
  if(origin&&!allowedOrigins.includes(origin))return response({error:'Origin not allowed'},403);
  const headers=cors(origin,allowedOrigins);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET, POST, DELETE, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Max-Age':'600'}});
  if(req.method==='GET'&&pathname==='/health')return response({ok:true,version:manifest.version},200,headers);
  if(req.method==='POST'&&pathname==='/answers'){
   try{
    const answer=normalizeAnswer(await bodyJson(req)),id=answer.session.id,previous=await store.get(id),tokenHash=sha256(answer.token),digest=sha256(JSON.stringify(answer));
    if(previous){
     if(previous.withdrawn)return response({error:'Session withdrawn'},409,headers);
     if(previous.tokenHash!==tokenHash||previous.answer.session.version!==answer.session.version||JSON.stringify(previous.answer.session.assignments)!==JSON.stringify(answer.session.assignments)||previous.answer.demo!==answer.demo)return response({error:'Session conflict'},409,headers);
     if(previous.answer.votes.length>answer.votes.length||JSON.stringify(previous.answer.votes)!==JSON.stringify(answer.votes.slice(0,previous.answer.votes.length)))return response({error:'Answer conflict'},409,headers);
     if(previous.digest===digest)return response({received:answer.votes.length,complete:answer.votes.length===24},200,headers);
    }
    await store.put(id,{_id:id,version:manifest.version,tokenHash,digest,answer,imported:false,withdrawn:false,ipAddress:previous?.ipAddress??clientIp(req),receivedAt:previous?.receivedAt??new Date().toISOString()});
    return response({received:answer.votes.length,complete:answer.votes.length===24},200,headers);
   }catch(e){if(e instanceof SyntaxError||e.message==='Invalid answer'||e.message==='Invalid vote order'||e.message==='Request too large')return response({error:e.message},400,headers);console.error('relay write',e);return response({error:'Storage temporarily unavailable'},503,headers);}
  }
  if(req.method==='DELETE'&&pathname==='/answers'){
   try{const body=await bodyJson(req);if(!uuid.test(body?.id||'')||!tokenPattern.test(body?.token||''))return response({error:'Invalid withdrawal'},400,headers);
    const previous=await store.get(body.id);if(previous){
     if(previous.tokenHash!==sha256(body.token))return response({error:'Session conflict'},409,headers);
     if(!previous.withdrawn)await store.put(body.id,{_id:body.id,version:previous.version,tokenHash:previous.tokenHash,withdrawn:true,withdrawnAt:new Date().toISOString()});
    }
    return response({deleted:true},200,headers);
   }catch(e){console.error('relay withdrawal',e);return response({error:'Withdrawal failed'},503,headers);}
  }
  if(pathname.startsWith('/admin/')){
   if(!adminAllowed(req,adminKey))return response({error:'Unauthorized'},401,headers);
   try{
    if(req.method==='GET'&&pathname==='/admin/answers'){
     const items=await store.pending(50);return response({version:manifest.version,items:items.map(item=>({id:item._id,digest:item.digest,answer:item.answer,ipAddress:item.ipAddress??null,receivedAt:item.receivedAt}))},200,headers);
    }
    if(req.method==='GET'&&pathname==='/admin/withdrawals'){
     const items=await store.withdrawals(50);return response({items:items.map(item=>({id:item._id,withdrawnAt:item.withdrawnAt}))},200,headers);
    }
    if(req.method==='POST'&&pathname==='/admin/withdrawal-ack'){
     const data=await bodyJson(req);if(!uuid.test(data?.id||''))return response({error:'Invalid acknowledgement'},400,headers);
     return response({acknowledged:await store.ackWithdrawal(data.id)},200,headers);
    }
    if(req.method==='POST'&&pathname==='/admin/ack'){
     const data=await bodyJson(req);if(!Array.isArray(data.items)||data.items.length<1||data.items.length>50||data.items.some(x=>!uuid.test(x?.id||'')||!/^[a-f0-9]{64}$/.test(x?.digest||'')))return response({error:'Invalid acknowledgement'},400,headers);
     let acknowledged=0;for(const item of data.items)if(await store.markImported(item.id,item.digest))acknowledged++;
     return response({acknowledged},200,headers);
    }
   }catch(e){console.error('relay admin',e);return response({error:'Storage temporarily unavailable'},503,headers);}
  }
  return response({error:'Not found'},404,headers);
 };
}

async function launch(){
 if(!process.env.STUDY_RELAY_ADMIN_KEY)throw Error('STUDY_RELAY_ADMIN_KEY is required');
 const {createCloudbaseStore}=await import('./cloudbase-store.mjs');
 const handler=makeHandler({store:createCloudbaseStore(),adminKey:process.env.STUDY_RELAY_ADMIN_KEY,allowedOrigins:(process.env.STUDY_ALLOWED_ORIGINS||'https://tony-lowe.github.io,https://canvas-preference-study.tonylowe001031.chatgpt.site').split(',').map(x=>x.trim()).filter(Boolean)});
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`),chunks=[];let length=0;
  for await(const chunk of req){length+=chunk.length;if(length>65536){res.writeHead(413);res.end('Request too large');return;}chunks.push(chunk);}
  const request=new Request(url,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
  const result=await handler(request);res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));
 });
 server.listen(Number(process.env.PORT||8080),'0.0.0.0');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)launch().catch(error=>{console.error(error);process.exitCode=1;});
