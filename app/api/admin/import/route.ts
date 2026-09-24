import {api,preflight,isAdmin,sameOrigin,payload,session,db,hash,validOfflineAssignments,getVotes,next,json,STUDY,type Session,type Vote} from '@/lib/study';

async function handlePOST(req:Request){
 if(!await isAdmin(req))return json({error:'管理码无效。'},401);
 try{
  sameOrigin(req);
  const body=await payload(req,32000);
  if(body.kind!=='design-preference-study-offline-answer'||body.version!==STUDY.version||!/^[0-9a-f-]{72,74}$/.test(body.token||'')||!body.session||!/^[0-9a-f-]{36}$/.test(body.session.id||'')||body.session.version!==STUDY.version||!validOfflineAssignments(body.session.assignments)||!Array.isArray(body.votes)||body.votes.length<1||body.votes.length>24)return json({error:'答卷格式、版本或分组无效。'},400);
  let s=await session(req,body.token);
  if(s&&(s.id!==body.session.id||s.assignments!==JSON.stringify(body.session.assignments)))return json({error:'答卷与已保存会话不一致。'},409);
  if(!s){
   const existing=await db().prepare('SELECT id FROM study_sessions WHERE id = ?').bind(body.session.id).first();
   if(existing)return json({error:'参与编号已被其他会话使用。'},409);
   s={id:body.session.id,token_hash:await hash(body.token),version:STUDY.version,assignments:JSON.stringify(body.session.assignments),created_at:new Date().toISOString(),demo:body.demo===true?1:0,ip_address:null} as Session;
   await db().prepare('INSERT INTO study_sessions (id,token_hash,version,assignments,created_at,demo,ip_address) VALUES (?,?,?,?,?,?,?)').bind(s.id,s.token_hash,s.version,s.assignments,s.created_at,s.demo,s.ip_address).run();
  }
  const existing=await getVotes(s),progress=[...existing],additions:Vote[]=[];
  for(const item of body.votes){
   if(!item||typeof item!=='object'||!['A','B','tie','skip'].includes(item.choice)||!['aesthetic','adherence'].includes(item.dimension)||typeof item.trialId!=='string')return json({error:'评分内容无效。'},400);
   const duplicate=progress.find(v=>v.trial_id===item.trialId&&v.dimension===item.dimension);
   if(duplicate){if(duplicate.choice!==item.choice)return json({error:'该项评分与云端记录不同。'},409);continue;}
   const current=next(s,progress);
   if(!current||current.trial.id!==item.trialId||current.dimension!==item.dimension)return json({error:'评分顺序或分组无效。'},409);
   const reasons=Array.isArray(item.reasons)?[...new Set(item.reasons.filter((x:unknown)=>['regional','layout','text','subject','other'].includes(String(x))))].sort():[];
   const vote:Vote={session_id:s.id,trial_id:item.trialId,dimension:item.dimension,choice:item.choice,reasons:JSON.stringify(reasons),comment:typeof item.comment==='string'?item.comment.trim().slice(0,500):'',elapsed_ms:typeof item.elapsedMs==='number'&&Number.isFinite(item.elapsedMs)?Math.max(0,Math.min(3600000,Math.round(item.elapsedMs))):0,created_at:new Date().toISOString()};
   additions.push(vote);progress.push(vote);
  }
  if(additions.length)await db().batch(additions.map(v=>db().prepare('INSERT INTO study_votes (session_id,trial_id,dimension,choice,reasons,comment,elapsed_ms,created_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(session_id,trial_id,dimension) DO NOTHING').bind(v.session_id,v.trial_id,v.dimension,v.choice,v.reasons,v.comment,v.elapsed_ms,v.created_at)));
  const saved=await getVotes(s);
  if(body.votes.some((v:{trialId:string;dimension:string;choice:string})=>!saved.some(item=>item.trial_id===v.trialId&&item.dimension===v.dimension&&item.choice===v.choice)))return json({error:'导入未完成，请保留原文件并重试。'},503);
  return json({participant:s.id.slice(0,8),imported:additions.length,saved:saved.length,demo:!!s.demo});
 }catch(e){console.error('admin import',e);return json({error:'导入失败，请保留原文件并重试。'},503);}
}

export const POST=api(handlePOST);
export const OPTIONS=preflight;
