import {api,preflight} from '@/lib/study';
import {isAdmin,json,db,STUDY,dimensions,type Trial,type Session,type Vote} from '@/lib/study';
const names:Record<string,string>={ours:'All-in-Image',creatidesign:'CreatiDesign',uno:'UNO'};
function csvCell(x:unknown){let s=String(x??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
async function handleGET(req:Request){try{
 if(!await isAdmin(req))return json({error:'管理码不正确。'},401);
 const ss=await db().prepare('SELECT * FROM study_sessions WHERE version = ? AND demo = 0').bind(STUDY.version).all<Session>();
 const vv=await db().prepare('SELECT v.* FROM study_votes v JOIN study_sessions s ON s.id = v.session_id WHERE s.version = ? AND s.demo = 0').bind(STUDY.version).all<Vote>();
 const trials=new Map<string,Trial>();const sessions=new Map(ss.results.map(s=>[s.id,s]));for(const s of ss.results)for(const t of JSON.parse(s.assignments))trials.set(s.id+':'+t.id,t);
 const rows=vv.results.map(v=>{const t=trials.get(v.session_id+':'+v.trial_id)!;return {dataset_version:STUDY.version,study_mode:STUDY.mode,participant_id:v.session_id,ip_address:sessions.get(v.session_id)?.ip_address??null,trial_id:v.trial_id,case_id:t.caseId,pool:t.pool,dimension:v.dimension,left_method:names[t.left],right_method:names[t.right],choice:v.choice,winner:v.choice==='A'?names[t.left]:v.choice==='B'?names[t.right]:v.choice,reasons:v.reasons,comment:v.comment,elapsed_ms:v.elapsed_ms,created_at:v.created_at};});
 const pairs=[['ours','creatidesign'],['ours','uno']];
 const summaries=(['aesthetic','adherence'] as const).flatMap(dimension=>pairs.map(([m,n])=>{const subset=rows.filter(r=>r.dimension===dimension&&[r.left_method,r.right_method].includes(names[m])&&[r.left_method,r.right_method].includes(names[n]));const wins=subset.filter(r=>r.winner===names[m]).length;const losses=subset.filter(r=>r.winner===names[n]).length;const ties=subset.filter(r=>r.winner==='tie').length;const skipped=subset.filter(r=>r.winner==='skip').length;const valid=wins+losses+ties;return {pool:'all',dimension,method:names[m],opponent:names[n],wins,losses,ties,skipped,valid,winRate:valid?wins/valid:null,tieAdjusted:valid?(wins+.5*ties)/valid:null,participants:new Set(subset.filter(r=>r.winner!=='skip').map(r=>r.participant_id)).size,cases:new Set(subset.filter(r=>r.winner!=='skip').map(r=>r.case_id)).size};}));
 const completed=ss.results.filter(s=>{return (JSON.parse(s.assignments) as Trial[]).every(t=>dimensions(t).every(d=>vv.results.some(v=>v.session_id===s.id&&v.trial_id===t.id&&v.dimension===d))); }).length;
 const participantDetails=ss.results.map(s=>({participant_id:s.id,ip_address:s.ip_address,created_at:s.created_at,saved_judgments:vv.results.filter(v=>v.session_id===s.id).length}));
 const result={version:STUDY.version,mode:STUDY.mode,sampling:STUDY.sampling,caseCount:STUDY.cases.length,pools:STUDY.pools,participants:ss.results.length,completed,judgments:rows.length,summaries,participantDetails,analysisPolicy:'All submitted judgments are included, including partial sessions. Demo sessions excluded. Skips excluded from rate denominators; ties retained. No post-hoc quality exclusions. IP is recorded at session creation; older sessions may have no IP.',rows};
 const format=new URL(req.url).searchParams.get('format');
 if(format==='csv'){const keys=['dataset_version','study_mode','participant_id','ip_address','trial_id','case_id','pool','dimension','left_method','right_method','choice','winner','reasons','comment','elapsed_ms','created_at'];const text='\uFEFF'+[keys.map(csvCell).join(','),...rows.map(r=>keys.map(k=>csvCell(r[k as keyof typeof r])).join(','))].join('\r\n');return new Response(text,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="study-votes.csv"','Cache-Control':'no-store'}});}
 if(format==='json')return new Response(JSON.stringify(result,null,2),{headers:{'Content-Type':'application/json','Content-Disposition':'attachment; filename="study-results.json"','Cache-Control':'no-store'}});
 return json(result);
 }catch(e){console.error('admin GET',e);return json({error:'结果暂时不可用，请重试。'},503);}}

export const GET = api(handleGET);

export const OPTIONS = preflight;
