import {api,preflight} from '@/lib/study';
import {session,json,db,hash,assignments,validOfflineAssignments,publicState,publicPlan,voteProgress,getVotes,cookieHeader,sameOrigin,payload,STUDY} from '@/lib/study';
async function handleGET(req:Request){try{const s=await session(req);return json(s?await publicState(s):{active:false,mode:STUDY.mode,total:12,totalJudgments:24,caseCount:STUDY.cases.length});}catch(e){console.error('session GET',e);return json({error:'暂时无法读取进度，请稍后重试。'},503);}}
async function handlePOST(req:Request){try{
 sameOrigin(req);const body=await payload(req);const old=await session(req,body.resumeToken);
 if(body.resume===true){
  if(!old)return json({active:false,mode:STUDY.mode,total:12,totalJudgments:24,caseCount:STUDY.cases.length});
  const votes=await getVotes(old);return json({...await publicState(old,votes),...(body.plan===true&&old.version===STUDY.version?{plan:publicPlan(old),savedVotes:voteProgress(votes)}:{})});
 }
 if(body.consent!==true)return json({error:'请先确认自愿参与。'},400);
 if(old&&(old.version===STUDY.version||body.startFresh!==true)){
  const votes=await getVotes(old);return json({...await publicState(old,votes),...(body.plan===true&&old.version===STUDY.version?{plan:publicPlan(old),savedVotes:voteProgress(votes)}:{})});
 }
 const offline=body.offlineSession;
 if(offline&&(!/^[0-9a-f-]{72,74}$/.test(body.resumeToken||'')||!/^[0-9a-f-]{36}$/.test(offline.id||'')||offline.version!==STUDY.version||!validOfflineAssignments(offline.assignments)))return json({error:'本机答卷版本或分组无效。'},400);
 const token=offline?body.resumeToken:crypto.randomUUID()+crypto.randomUUID();
 const suppliedIp=req.headers.get('CF-Connecting-IP');const ipAddress=suppliedIp&&suppliedIp.length<=45?suppliedIp:null;
 const s={id:offline?offline.id:crypto.randomUUID(),token_hash:await hash(token),version:STUDY.version,assignments:JSON.stringify(offline?offline.assignments:assignments()),created_at:new Date().toISOString(),demo:old?old.demo:(body.demo===true?1:0),ip_address:ipAddress};
 await db().prepare('INSERT INTO study_sessions (id,token_hash,version,assignments,created_at,demo,ip_address) VALUES (?,?,?,?,?,?,?)').bind(s.id,s.token_hash,s.version,s.assignments,s.created_at,s.demo,s.ip_address).run();
 return json({...await publicState(s,[]),...(body.plan===true?{plan:publicPlan(s),savedVotes:[]}:{}),resumeToken:token},201,{'Set-Cookie':cookieHeader(token,req)});
}catch(e){console.error('session POST',e);return json({error:'无法开始，请重试。'},503);}}
async function handleDELETE(req:Request){try{sameOrigin(req);const s=await session(req);if(s)await db().batch([db().prepare('DELETE FROM study_votes WHERE session_id = ?').bind(s.id),db().prepare('DELETE FROM study_sessions WHERE id = ?').bind(s.id)]);return json({active:false},200,{'Set-Cookie':cookieHeader('',req,0)});}catch(e){console.error('session DELETE',e);return json({error:'撤回失败，请稍后重试。'},503);}}

export const GET = api(handleGET);

export const POST = api(handlePOST);

export const DELETE = api(handleDELETE);

export const OPTIONS = preflight;
