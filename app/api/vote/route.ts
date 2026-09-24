import {api,preflight} from '@/lib/study';
import {session,json,db,publicState,sameOrigin,payload,getVotes,next,STUDY} from '@/lib/study';
async function handlePOST(req:Request){try{
 sameOrigin(req);const p=await payload(req);const s=await session(req,p.resumeToken);if(!s)return json({error:'参与记录已过期，请重新开始。'},401);
 if(s.version!==STUDY.version)return json({error:'研究版本已更新。'},409);
 if(!['A','B','tie','skip'].includes(p.choice)||!['aesthetic','adherence'].includes(p.dimension)||typeof p.trialId!=='string')return json({error:'请选择有效答案。'},400);
 const reasons=Array.isArray(p.reasons)?[...new Set(p.reasons.filter((x:unknown)=>['regional','layout','text','subject','other'].includes(String(x))))].sort():[];
 const comment=typeof p.comment==='string'?p.comment.trim().slice(0,500):'';
 const existing=await getVotes(s);const duplicate=existing.find(v=>v.trial_id===p.trialId&&v.dimension===p.dimension);
 if(duplicate){if(duplicate.choice!==p.choice)return json({error:'该项评分已保存。请刷新继续。'},409);return json(await publicState(s,existing));}
 const current=next(s,existing);if(!current||current.trial.id!==p.trialId||current.dimension!==p.dimension)return json({error:'进度已更新，请刷新后继续。'},409);
 const elapsed=typeof p.elapsedMs==='number'&&Number.isFinite(p.elapsedMs)?Math.max(0,Math.min(3600000,Math.round(p.elapsedMs))):0;
 const vote={session_id:s.id,trial_id:p.trialId,dimension:p.dimension,choice:p.choice,reasons:JSON.stringify(reasons),comment,elapsed_ms:elapsed,created_at:new Date().toISOString()} as const;
 const result=await db().prepare('INSERT INTO study_votes (session_id,trial_id,dimension,choice,reasons,comment,elapsed_ms,created_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(session_id,trial_id,dimension) DO NOTHING').bind(vote.session_id,vote.trial_id,vote.dimension,vote.choice,vote.reasons,vote.comment,vote.elapsed_ms,vote.created_at).run();
 if(result.meta.changes!==1){
  const saved=await db().prepare('SELECT choice FROM study_votes WHERE session_id = ? AND trial_id = ? AND dimension = ?').bind(s.id,p.trialId,p.dimension).first<{choice:string}>();
  if(saved?.choice!==p.choice)return json({error:'另一个窗口已提交该项，请刷新继续。'},409);
 }
 return json(await publicState(s,[...existing,vote]));
 }catch(e){console.error('vote POST',e);return json({error:'本次未能确认保存，请保留选择并重试。'},503);}}

export const POST = api(handlePOST);

export const OPTIONS = preflight;
