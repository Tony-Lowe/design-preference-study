import {api,preflight} from '@/lib/study';
import {session,json,db,sameOrigin,payload,getVotes,next,STUDY,voteProgress,type Vote} from '@/lib/study';

async function handlePOST(req:Request){try{
 sameOrigin(req);const body=await payload(req,32000);const s=await session(req,body.resumeToken);
 if(!s)return json({error:'参与记录已过期，请重新开始。'},401);
 if(s.version!==STUDY.version)return json({error:'研究版本已更新。'},409);
 if(!Array.isArray(body.votes)||body.votes.length<1||body.votes.length>24)return json({error:'评分批次无效。'},400);
 const existing=await getVotes(s),progress=[...existing],additions:Vote[]=[];
 for(const item of body.votes){
  if(!item||typeof item!=='object'||!['A','B','tie','skip'].includes(item.choice)||!['aesthetic','adherence'].includes(item.dimension)||typeof item.trialId!=='string')return json({error:'评分内容无效。'},400);
  const duplicate=progress.find(v=>v.trial_id===item.trialId&&v.dimension===item.dimension);
  if(duplicate){if(duplicate.choice!==item.choice)return json({error:'另一窗口已提交不同评分，请刷新核对。'},409);continue;}
  const current=next(s,progress);
  if(!current||current.trial.id!==item.trialId||current.dimension!==item.dimension)return json({error:'评分顺序已变化，请刷新核对。'},409);
  const reasons=Array.isArray(item.reasons)?[...new Set(item.reasons.filter((x:unknown)=>['regional','layout','text','subject','other'].includes(String(x))))].sort():[];
  const comment=typeof item.comment==='string'?item.comment.trim().slice(0,500):'';
  const elapsed=typeof item.elapsedMs==='number'&&Number.isFinite(item.elapsedMs)?Math.max(0,Math.min(3600000,Math.round(item.elapsedMs))):0;
  const vote:Vote={session_id:s.id,trial_id:item.trialId,dimension:item.dimension,choice:item.choice,reasons:JSON.stringify(reasons),comment,elapsed_ms:elapsed,created_at:new Date().toISOString()};
  additions.push(vote);progress.push(vote);
 }
 if(additions.length)await db().batch(additions.map(v=>db().prepare('INSERT INTO study_votes (session_id,trial_id,dimension,choice,reasons,comment,elapsed_ms,created_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(session_id,trial_id,dimension) DO NOTHING').bind(v.session_id,v.trial_id,v.dimension,v.choice,v.reasons,v.comment,v.elapsed_ms,v.created_at)));
 const saved=additions.length?await getVotes(s):existing;
 for(const item of body.votes){if(!saved.some(v=>v.trial_id===item.trialId&&v.dimension===item.dimension&&v.choice===item.choice))return json({error:'未能确认全部评分，请保留本机记录并重试。'},503);}
 return json({saved:saved.length,savedVotes:voteProgress(saved)});
}catch(e){console.error('votes POST',e);return json({error:'暂时无法上传评分，本机记录仍保留。'},503);}}

export const POST=api(handlePOST);
export const OPTIONS=preflight;
