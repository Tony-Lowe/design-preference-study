'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowRight,ScanEye,ShieldCheck,Check,Expand,CloudCheck,RotateCcw,Eye,ClipboardCheck,Download} from 'lucide-react';
import preview from '@/data/preview.json';
import {studyFetch,asset,setStudyToken} from '@/lib/transport';
import {makeOfflineAssignments,offlinePlan,offlineVersion,type OfflineAssignment} from '@/lib/offline-plan';
import {translate,type Language} from '@/lib/i18n';
import {Button} from '@/components/ui/button';
import {Checkbox} from '@/components/ui/checkbox';
import {Progress} from '@/components/ui/progress';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {AlertDialog,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter,AlertDialogCancel,AlertDialogAction,AlertDialogTrigger} from '@/components/ui/alert-dialog';
import {Textarea} from '@/components/ui/textarea';
type Trial={id:string;index:number;dimension:'aesthetic'|'adherence';images:string[];prompt:string;requirements?:{prompt:string;semantic:string;pixel:string;layoutOverlay?:string;subjectOverlay?:string}};
type PlanTrial=Omit<Trial,'pool'|'dimension'> & {requirements:NonNullable<Trial['requirements']>};
type LocalVote={trialId:string;dimension:'aesthetic'|'adherence';choice:string;reasons:string[];comment:string;elapsedMs:number};
type SavedVote={trialId:string;dimension:string;choice:string};
type OfflineSession={id:string;version:string;assignments:OfflineAssignment[]};
type State={active:boolean;done?:boolean;stale?:boolean;error?:string;demo?:boolean;participant?:string;version?:string;total?:number;totalJudgments?:number;completed?:number;saved?:number;trial?:Trial;plan?:PlanTrial[];savedVotes?:SavedVote[];offlineSession?:OfflineSession;offlineBackup?:OfflineSession};
const cacheKey='design-study-local-progress-v1';
const voteKey=(v:{trialId:string;dimension:string})=>`${v.trialId}:${v.dimension}`;
function readCache():{base:State;votes:LocalVote[];confirmed:string[]}|null{try{const data=JSON.parse(localStorage.getItem(cacheKey)||'null');return data?.base?.plan&&Array.isArray(data.votes)&&Array.isArray(data.confirmed)?data:null;}catch{return null;}}
function persist(base:State,votes:LocalVote[],confirmed:Set<string>){localStorage.setItem(cacheKey,JSON.stringify({base,votes,confirmed:[...confirmed]}));}
function localState(base:State,votes:LocalVote[]):State{
 if(!base.plan)return base;
 let current:Trial|undefined,completed=0;
 for(const item of base.plan){const aesthetic=votes.some(v=>v.trialId===item.id&&v.dimension==='aesthetic'),adherence=votes.some(v=>v.trialId===item.id&&v.dimension==='adherence');
  if(aesthetic&&adherence)completed++;
  if(!current&&!aesthetic)current={id:item.id,index:item.index,images:item.images,prompt:item.prompt,dimension:'aesthetic'};
  else if(!current&&!adherence)current={...item,dimension:'adherence'};
 }
 return {...base,active:true,done:!current,trial:current,saved:votes.length,completed};
}
function mergeVotes(plan:PlanTrial[],saved:SavedVote[],cached:LocalVote[]):LocalVote[]{
 const server=new Map(saved.map(v=>[voteKey(v),v])),local=new Map(cached.map(v=>[voteKey(v),v]));const result:LocalVote[]=[];
 for(const item of plan)for(const dimension of ['aesthetic','adherence'] as const){const key=`${item.id}:${dimension}`,remote=server.get(key),previous=local.get(key);if(!remote&&!previous)return result;result.push(previous&&(!remote||previous.choice===remote.choice)?previous:{trialId:item.id,dimension,choice:remote!.choice,reasons:[],comment:'',elapsedMs:0});}
 return result;
}
export default function Home(){
 const [language,setLanguage]=useState<Language>('zh');
 const t=(value:string)=>translate(language,value);
 useEffect(()=>{const saved=localStorage.getItem('design-study-language');if(saved==='en')setLanguage('en');},[]);
 function changeLanguage(next:Language){setLanguage(next);localStorage.setItem('design-study-language',next);document.documentElement.lang=next==='en'?'en':'zh-CN';}
 const [consent,setConsent]=useState(false),[zoom,setZoom]=useState<{src:string;label:string;overlay?:string;subjectOverlay?:string}|null>(null),[state,setState]=useState<State|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[choice,setChoice]=useState(''),[reasons,setReasons]=useState<string[]>([]),[comment,setComment]=useState('');
 const [zoomScale,setZoomScale]=useState(1);
 useEffect(()=>setZoomScale(1),[zoom?.src]);
 const [overlayOn,setOverlayOn]=useState(false),[overlayOpacity,setOverlayOpacity]=useState(0.8),[overlayBroken,setOverlayBroken]=useState(false),[subjectOn,setSubjectOn]=useState(false),[subjectOpacity,setSubjectOpacity]=useState(0.62),[subjectBroken,setSubjectBroken]=useState(false),[compactPair,setCompactPair]=useState(false);
 const [loadedImages,setLoadedImages]=useState<string[]>([]),[broken,setBroken]=useState(false),[confirmedCount,setConfirmedCount]=useState(0),[syncing,setSyncing]=useState(false),[syncError,setSyncError]=useState(''),[copyMessage,setCopyMessage]=useState('');
 const began=useRef(Date.now()),votesRef=useRef<LocalVote[]>([]),confirmedRef=useRef(new Set<string>()),baseRef=useRef<State|null>(null),syncingRef=useRef(false),syncTimer=useRef<number|null>(null),submitLock=useRef(false),prefetchRef=useRef(new Map<string,HTMLImageElement>());
 const flush=useCallback(async()=>{
  if(syncingRef.current)return;
  const pending=votesRef.current.filter(v=>!confirmedRef.current.has(voteKey(v)));
  if(!pending.length&&!baseRef.current?.offlineSession)return;
  syncingRef.current=true;setSyncing(true);setSyncError('');let succeeded=false;
  try{
   if(baseRef.current?.offlineSession){
    const registration=await studyFetch('/api/session',{method:'POST',body:JSON.stringify({consent:true,plan:true,demo:baseRef.current.demo,offlineSession:baseRef.current.offlineSession})});
    const registered=await registration.json() as State;
    if(!registration.ok||!registered.plan)throw Error(registered.error||'暂时无法连接评分服务器');
    if(registered.participant!==baseRef.current.participant)throw Error('参与编号不一致，请保留本机答卷');
    baseRef.current={...registered,offlineSession:undefined,offlineBackup:baseRef.current.offlineBackup};
    persist(baseRef.current,votesRef.current,confirmedRef.current);
   }
   if(!pending.length){succeeded=true;return;}
   const r=await studyFetch('/api/votes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({votes:pending})});const data=await r.json() as {error?:string;savedVotes?:SavedVote[]};if(!r.ok||!data.savedVotes)throw Error(data.error||'上传未完成');
   confirmedRef.current=new Set(data.savedVotes.map(voteKey));setConfirmedCount(confirmedRef.current.size);
   if(baseRef.current)persist(baseRef.current,votesRef.current,confirmedRef.current);succeeded=true;
  }catch(e){setSyncError(e instanceof TypeError||e instanceof SyntaxError||((e as Error).name==='AbortError')?'评分服务器暂不可达，答案已保存在本机':(e as Error).message||'上传失败，请重试');}
  finally{syncingRef.current=false;setSyncing(false);}
  if(succeeded&&votesRef.current.some(v=>!confirmedRef.current.has(voteKey(v))))window.setTimeout(()=>void flush(),0);
 },[]);
 const scheduleFlush=useCallback((delay:number)=>{if(syncTimer.current!==null)window.clearTimeout(syncTimer.current);syncTimer.current=window.setTimeout(()=>{syncTimer.current=null;void flush();},delay);},[flush]);
 const applyServer=useCallback((j:State)=>{
  if(!j.plan||!j.participant||!j.version){setState(j);return;}
  const cached=readCache(),previous=cached?.base.participant===j.participant&&cached.base.version===j.version?cached.votes:[];
  const merged=mergeVotes(j.plan,j.savedVotes??[],previous),confirmed=new Set((j.savedVotes??[]).map(voteKey));
  const base={...j,offlineBackup:cached?.base.participant===j.participant?cached.base.offlineBackup:undefined};
  baseRef.current=base;votesRef.current=merged;confirmedRef.current=confirmed;setConfirmedCount(confirmed.size);setState(localState(base,merged));setSyncError('');persist(base,merged,confirmed);
  if(merged.some(v=>!confirmed.has(voteKey(v))))scheduleFlush(0);
 },[scheduleFlush]);
 const load=useCallback(async()=>{setError('');try{const r=await studyFetch('/api/session',{method:'POST',body:JSON.stringify({resume:true,plan:true})});const j=await r.json() as State;if(!r.ok)throw Error(j.error);if(j.active)applyServer(j);else if(!baseRef.current)setState(j);}catch(e){if(!baseRef.current)setError('服务器暂不可达，仍可直接开始评选。');}},[applyServer]);
 useEffect(()=>{const cached=readCache();if(cached&&localStorage.getItem('design-study-session-v1')){baseRef.current=cached.base;votesRef.current=cached.votes;confirmedRef.current=new Set(cached.confirmed);setConfirmedCount(cached.confirmed.length);setState(localState(cached.base,cached.votes));if(cached.base.offlineSession)scheduleFlush(0);else void load();}else setState({active:false,total:12,totalJudgments:24});},[load,scheduleFlush]);
 useEffect(()=>{const resume=()=>scheduleFlush(0);window.addEventListener('online',resume);const timer=window.setInterval(()=>{if(baseRef.current?.offlineSession||votesRef.current.some(v=>!confirmedRef.current.has(voteKey(v))))void flush();},15000);return()=>{window.removeEventListener('online',resume);window.clearInterval(timer);if(syncTimer.current!==null)window.clearTimeout(syncTimer.current);};},[flush,scheduleFlush]);
 useEffect(()=>{setChoice('');setReasons([]);setComment('');setLoadedImages([]);setBroken(false);setOverlayOn(false);setOverlayBroken(false);setSubjectOn(false);setSubjectBroken(false);submitLock.current=false;began.current=Date.now();},[state?.trial?.id,state?.trial?.dimension]);
 useEffect(()=>{if(!state?.plan||!state.trial||loadedImages.length<new Set(state.trial.images).size)return;const upcoming=state.plan[state.trial.index];if(!upcoming)return;for(const src of upcoming.images)if(!prefetchRef.current.has(src)){const img=new Image();img.decoding='async';img.src=asset(src);prefetchRef.current.set(src,img);}for(const src of prefetchRef.current.keys())if(!upcoming.images.includes(src))prefetchRef.current.delete(src);},[state?.plan,state?.trial?.index,state?.trial?.images,loadedImages.length]);
 // Read-only agent integration. Human judgments are deliberately not automated.
 useEffect(()=>{const context=(document as unknown as {modelContext?:{registerTool:(t:unknown,o:unknown)=>Promise<void>}}).modelContext;if(!context?.registerTool)return;const controller=new AbortController();try{Promise.resolve(context.registerTool({name:'read_study_progress',title:'查看研究进度',description:'Read the visible study progress only. Does not submit or generate participant ratings.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:async(input:unknown)=>{if(!input||typeof input!=='object'||Object.keys(input).length)throw Error('Expected an empty object');return {active:!!state?.active,completed:state?.completed??0,total:state?.total??12,dimension:state?.trial?.dimension??null,demo:!!state?.demo};}},{signal:controller.signal})).catch(()=>{});}catch{}return ()=>controller.abort();},[state]);
 function start(){
  if(!consent)return;setError('');
  try{
   const assignments=makeOfflineAssignments(),id=crypto.randomUUID(),token=crypto.randomUUID()+crypto.randomUUID();
   const offlineSession={id,version:offlineVersion,assignments};
   const base:State={active:true,participant:id.slice(0,8),version:offlineVersion,demo:new URLSearchParams(location.search).get('preview')==='1',total:12,totalJudgments:24,plan:offlinePlan(assignments),offlineSession,offlineBackup:offlineSession};
   persist(base,[],new Set());setStudyToken(token);
   baseRef.current=base;votesRef.current=[];confirmedRef.current=new Set();setConfirmedCount(0);setState(localState(base,[]));scheduleFlush(0);window.scrollTo(0,0);
  }catch{setError('本机无法保存答卷，请检查浏览器存储设置。');}
 }
 function startFresh(){setConsent(true);localStorage.removeItem(cacheKey);localStorage.removeItem('design-study-session-v1');setState({active:false,total:12,totalJudgments:24});setError('请勾选同意后开始新版评选。');}
 function answerData(){
  if(!baseRef.current)return '';
  const data={kind:'design-preference-study-offline-answer',version:baseRef.current.version,participant:baseRef.current.participant,token:localStorage.getItem('design-study-session-v1'),session:baseRef.current.offlineBackup??baseRef.current.offlineSession,demo:baseRef.current.demo,votes:votesRef.current};
  return JSON.stringify(data);
 }
 function downloadAnswers(){
  const answer=answerData();if(!answer)return;
  const url=URL.createObjectURL(new Blob([answer],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=`design-study-${baseRef.current?.participant}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 async function copyAnswers(){try{await navigator.clipboard.writeText(answerData());setCopyMessage(language==='en'?'Copied. Send this text to the researcher.':'已复制，请把答卷文本发给研究者。');}catch{setCopyMessage(language==='en'?'Copy failed. Please download the JSON file.':'复制失败，请改用下载 JSON 文件。');}}
 function submit(){if(!state?.trial||!state.plan||!choice||busy||submitLock.current)return;submitLock.current=true;setError('');const vote:LocalVote={trialId:state.trial.id,dimension:state.trial.dimension,choice,reasons,comment,elapsedMs:Date.now()-began.current};const updated=[...votesRef.current,vote];
  try{persist(baseRef.current??state,updated,confirmedRef.current);}catch{setError('本机暂存失败，请检查浏览器存储空间后重试。');submitLock.current=false;return;}
  votesRef.current=updated;setChoice('');setState(localState(baseRef.current??state,updated));window.scrollTo(0,0);scheduleFlush(vote.dimension==='adherence'?0:4000);
 }
 async function withdraw(){setBusy(true);setError('');try{if(!baseRef.current?.offlineSession||confirmedRef.current.size){const r=await studyFetch('/api/session',{method:'DELETE'});if(!r.ok)throw Error('暂时无法撤回云端记录，请稍后重试。');}localStorage.removeItem(cacheKey);localStorage.removeItem('design-study-session-v1');votesRef.current=[];confirmedRef.current=new Set();baseRef.current=null;setConfirmedCount(0);setState({active:false,total:12,totalJudgments:24});setConsent(false);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const trial=state?.trial,adherence=trial?.dimension==='adherence';
 function imagePair(images:string[],interactive=false){
  const overlay=interactive&&adherence&&overlayOn&&!overlayBroken?trial?.requirements?.layoutOverlay:undefined;
  const subject=interactive&&adherence&&subjectOn&&!subjectBroken?trial?.requirements?.subjectOverlay:undefined;
  return <div className={`image-pair ${compactPair?'compact-pair':''}`}>{images.map((src,i)=>{
   const label=`${t('候选图像')} ${i?'B':'A'}`;
   return <article className="image-card" key={src+(interactive?trial?.dimension:"")}>
    <div className="image-label"><span>{i?'B':'A'}</span>{t('候选图像')}<button onClick={()=>setZoom({src,label,overlay,subjectOverlay:subject})} aria-label={`${language==='en'?'Enlarge image':'放大图像'} ${i?'B':'A'}`}><Expand size={17}/></button></div>
    <button className="image-surface" onClick={()=>setZoom({src,label,overlay,subjectOverlay:subject})} aria-label={`${language==='en'?'View image':'查看图像'} ${i?'B':'A'}`}>
     <span className="image-stage"><img src={asset(src)} alt={label} onLoad={()=>interactive&&setLoadedImages(old=>old.includes(src)?old:[...old,src])} onError={()=>interactive&&setBroken(true)}/>
      {subject&&<img className="subject-overlay" src={asset(subject)} alt="" aria-hidden="true" style={{opacity:subjectOpacity}} onError={()=>setSubjectBroken(true)}/>}
      {overlay&&<img className="layout-overlay" src={asset(overlay)} alt="" aria-hidden="true" style={{opacity:overlayOpacity}} onError={()=>setOverlayBroken(true)}/>}
     </span>
    </button>
   </article>;
  })}</div>;
 }
 return <main className="study-shell"><header className="masthead"><div className="brand"><span className="brand-icon"><ScanEye size={22}/></span><div>{t('设计图像偏好研究')}<small>VISUAL PREFERENCE STUDY</small></div></div><div className="header-status"><button type="button" className="language-switch" onClick={()=>changeLanguage(language==='zh'?'en':'zh')} aria-label={language==='zh'?'Switch to English':'切换为中文'}>{language==='zh'?'English':'中文'}</button><span className="pilot-tag">{t(state?.demo?'演示 · 不计入统计':'正式评选')}</span>{state?.active&&<span className="saved-status"><CloudCheck size={15}/>{language==='en'?`Selected ${state.saved??0} · Cloud received ${confirmedCount}${syncing?' · Syncing':''}`:`已选 ${state.saved??0} 项 · 云端已收 ${confirmedCount} 项${syncing?' · 同步中':''}`}</span>}</div></header>
 {error&&<div className="error" role="alert">{error}{state?.active&&<button className="retry" onClick={load}>{t('重新读取进度')}</button>}</div>}
 {syncError&&<div className="sync-notice" role="status">{t(syncError)}<button className="retry" onClick={()=>scheduleFlush(0)}>{t('重试上传')}</button></div>}
 {state?.stale?<section className="completion"><h1>{t('研究版本已更新')}</h1><p>{t('旧版评分会保留并与新版分开统计。新版会在首次成功同步时记录 IP 地址，供研究管理者核查重复参与。')}</p><Button onClick={startFresh} disabled={busy} className="submit-vote">{t('开始新版评选')}<ArrowRight size={16}/></Button></section>:state?.done?<section className="completion"><span className="complete-icon"><Check size={32}/></span><p className="eyebrow">{t(confirmedCount>=(state.totalJudgments??24)?'全部完成':'全部选完，等待同步')}</p><h1>{t(confirmedCount>=(state.totalJudgments??24)?'谢谢，您的判断已保存。':'您的判断已暂存在本机。')}</h1><p>{language==='en'?`Completed ${state.total} image pairs and ${state.saved} judgments. `:`已完成 ${state.total} 组比较，共 ${state.saved} 项判断。`}{confirmedCount>=(state.totalJudgments??24)?t(state.demo?'这是演示会话，不计入研究结果。':'全部已同步，可以关闭页面。'):(language==='en'?`The cloud has received ${confirmedCount}. Retry syncing, or send the copied response text or downloaded JSON to the researcher if the server remains unreachable.`:`云端已收到 ${confirmedCount} 项。可重试同步；如始终无法连接，请复制答卷文本或下载 JSON，发送给研究者。`)}</p><div className="receipt">{t('参与编号')}<b>{state.participant}</b><span>{language==='en'?'Response status · ':'评分记录 · '}{t(confirmedCount>=(state.totalJudgments??24)?'已同步':syncing?'正在同步':'等待同步')}</span></div>{confirmedCount<(state.totalJudgments??24)&&<><Button onClick={()=>scheduleFlush(0)} disabled={syncing} className="submit-vote">{t(syncing?'正在上传…':'立即重试上传')}</Button><Button onClick={copyAnswers} variant="outline">{t('复制答卷文本')}</Button><Button onClick={downloadAnswers} variant="outline"><Download size={16}/>{t('下载答卷备用')}</Button>{copyMessage&&<p role="status" className="import-success">{copyMessage}</p>}</>}<p className="quiet">{t('为保持独立判断，参与页面不展示方法名称或实时胜率。')}</p></section>:trial?<>
 <section className="task-heading"><div><p className="eyebrow">{language==='en'?`Pair ${trial.index} / ${state.total} · `:`第 ${trial.index} / ${state.total} 组 · `}{t(adherence?'指令遵循 · 2 / 2':'美观评价 · 1 / 2')}</p><h1>{t(adherence?'哪张图更符合设计要求？':'哪张图在视觉上更美观？')}</h1><p>{t(adherence?'逐框核对指定对象及其颜色、材质、形状和数量，再检查位置、文字和参考主体。':'只考虑构图、配色、视觉协调与完成度，先不评判是否符合设计要求。')}</p></div><div className="round-progress"><div><span className={!adherence?'current-step':'finished-step'}><Eye size={15}/>{t('美观')} {adherence&&<Check size={13}/>}</span><span className={adherence?'current-step':''}><ClipboardCheck size={15}/>{t('指令遵循')} {adherence&&<Check size={13}/>}</span></div><Progress value={(state.saved??0)/(state.totalJudgments??24)*100} aria-label={language==='en'?'Overall progress':'总体完成进度'}/></div></section>
 {!adherence&&trial.prompt&&<section className="global-prompt"><h2>{t('设计主题')}</h2><p>{trial.prompt}</p></section>}
 {adherence&&trial.requirements&&<section className="requirements"><div className="brief"><h2>{t('设计要求')}</h2><p>{trial.requirements.prompt}</p><span>{t('同色描述对应同色框：不仅检查位置，还要检查框内内容是否满足描述。可点击放大核对。')}</span></div>{[{src:trial.requirements.semantic,label:'区域与文字要求'},{src:trial.requirements.pixel,label:'主体与字形参考'}].map(r=><button className="reference-card" onClick={()=>setZoom(r)} key={r.label}><span>{t(r.label)}<Expand size={13}/></span><img src={asset(r.src)} alt={t(r.label)}/></button>)}</section>}
 <div className="comparison-controls"><button className="mobile-pair-toggle" aria-pressed={compactPair} onClick={()=>setCompactPair(v=>!v)}>{t(compactPair?'上下查看':'并排查看')}</button>{adherence&&<div className="overlay-controls"><label><input type="checkbox" role="switch" checked={overlayOn&&!overlayBroken} disabled={overlayBroken||!trial.requirements?.layoutOverlay} onChange={e=>setOverlayOn(e.target.checked)}/>{t('叠加布局')}</label>{overlayOn&&!overlayBroken&&<label className="opacity-control">{t('布局透明度')}<input type="range" aria-label={t('布局透明度')} min="20" max="100" step="5" value={Math.round(overlayOpacity*100)} onChange={e=>setOverlayOpacity(Number(e.target.value)/100)}/><span>{Math.round(overlayOpacity*100)}%</span></label>}<label><input type="checkbox" role="switch" checked={subjectOn&&!subjectBroken} disabled={subjectBroken||!trial.requirements?.subjectOverlay} onChange={e=>setSubjectOn(e.target.checked)}/>{t('叠加主体参考')}</label>{subjectOn&&!subjectBroken&&<label className="opacity-control">{t('主体透明度')}<input type="range" aria-label={t('主体透明度')} min="20" max="100" step="5" value={Math.round(subjectOpacity*100)} onChange={e=>setSubjectOpacity(Number(e.target.value)/100)}/><span>{Math.round(subjectOpacity*100)}%</span></label>}{overlayBroken&&<span role="status">{t('布局标注暂时无法加载。')}</span>}{subjectBroken&&<span role="status">{t('主体参考暂时无法加载。')}</span>}</div>}</div>
 {imagePair(trial.images,true)}
 {broken&&<p className="error" role="alert">{t('图片加载失败，请刷新重试；也可以选择「无法判断」。')}</p>}
 <section className="vote-panel"><div className="vote-title"><strong>{t(adherence?'综合设计要求，您的选择是':'仅看视觉美观，您的选择是')}</strong><span>{t('无明显差异时，请选择平局')}</span></div><fieldset className="choices" aria-label={language==='en'?(adherence?'Instruction adherence preference':'Visual appeal preference'):(adherence?'指令遵循偏好':'视觉美观偏好')} disabled={busy}>{[['A','图像 A 更好'],['B','图像 B 更好'],['tie','难分高下'],['skip','无法判断']].map(([value,label])=><label className={`choice ${choice===value?'selected':''}`} key={value}><input type="radio" name={`vote-${trial.id}-${trial.dimension}`} value={value} checked={choice===value} onChange={()=>setChoice(value)}/><span>{t(label)}</span></label>)}</fieldset>
 {adherence&&<details className="optional-detail"><summary>{t('补充判断依据（可选）')}</summary><div className="reason-checks">{[['regional','框内对象 / 颜色 / 材质 / 形状 / 数量'],['layout','位置 / 大小 / 区域是否对应'],['text','指定文字是否正确'],['subject','主体外观是否一致'],['other','其他']].map(([key,label])=><label key={key}><Checkbox checked={reasons.includes(key)} onCheckedChange={checked=>setReasons(old=>checked?[...old,key]:old.filter(v=>v!==key))}/>{t(label)}</label>)}</div><Textarea aria-label={language==='en'?'Optional comment':'可选评论'} value={comment} onChange={e=>setComment(e.target.value)} maxLength={500} placeholder={language==='en'?'Briefly explain your choice if useful (do not include personal information)':'如有需要，可以简短说明您的判断（请勿填写个人信息）'}/></details>}
 <div className="vote-footer"><span><ShieldCheck size={14}/>{t(!adherence?'选择先存本机，再显示区域与主体参考':'本组判断在后台自动上传')}</span><Button onClick={submit} disabled={!choice||busy||(choice!=='skip'&&loadedImages.length<new Set(trial.images).size)} className="submit-vote">{t(!adherence?'下一步：查看详细要求':(trial.index===state.total?'完成评选':'下一组'))} <ArrowRight size={16}/></Button></div></section>
 </>:<><section className="intro-strip"><div><p className="eyebrow">{t('图像设计 · 美观偏好研究')}</p><h1>{t('看图选美观，也看设计要求。')}</h1><p>{t('每次比较两张匿名设计图。每组先评美观，再核对设计要求。')}</p></div><div className="study-spec"><span><strong>12</strong>{t('组比较')}</span><span><strong>24</strong>{t('次判断')}</span><span><strong>8–10</strong>{t('分钟')}</span></div></section><div className="onboarding"><div className="how"><h2>{t('如何参与')}</h2><p><b>{t('01 · 美观性')}</b><br/>{t('查看设计主题，比较构图、配色、视觉协调与整体完成度。')}</p><p><b>{t('02 · 指令遵循')}</b><br/>{t('保存美观判断后，页面会显示详细要求与布局叠加开关。可检查对象和属性、位置、指定文字及主体参考。')}</p><p className="quiet">{t('可以选择「难分高下」或「无法判断」。图片支持放大，刷新后可继续。')}</p></div><div className="consent"><ShieldCheck size={23}/><h2>{t('无需姓名，随时退出')}</h2><p>{t('我们保存评分、首次成功同步时的 IP 地址、用时和可选评论。IP 仅供研究管理者核查重复参与；不要求姓名或联系方式。您可以随时退出或撤回本次评分。')}</p><label className="consent-check"><Checkbox checked={consent} onCheckedChange={v=>setConsent(v===true)}/>{t('我已了解数据记录方式，并自愿参与')}</label><Button onClick={start} disabled={!consent||busy} className="start-button">{t('开始匿名评选')}<ArrowRight size={17}/></Button><p className="quiet">{t('无需等待服务器连接。答案先存本机，联网时自动同步。')}</p></div></div><div className="preview-title"><h2>{t('比较界面预览')}</h2><span>{t('示例图片 · 不计入评分')}</span></div>{imagePair([preview.a,preview.b])}</>}
 <footer className="site-footer"><span>{t('独立判断 · 匿名展示 · 支持平局')}</span>{state?.active&&<AlertDialog><AlertDialogTrigger asChild><button className="withdraw-link" disabled={busy}>{t('撤回我的全部评分')}</button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('撤回本次参与？')}</AlertDialogTitle><AlertDialogDescription>{t('当前会话已保存的全部评分将从数据库删除。已下载的研究导出文件需由研究者另行更新。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('保留评分')}</AlertDialogCancel><AlertDialogAction onClick={withdraw}>{t('确认撤回')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}</footer>
 <Dialog open={!!zoom} onOpenChange={open=>!open&&setZoom(null)}><DialogContent className="zoom-dialog"><DialogTitle>{t(zoom?.label??'图像细节')}</DialogTitle><DialogDescription>{t('保留原图比例。滚动查看超出屏幕的部分。')}</DialogDescription><button className="zoom-detail-toggle" onClick={()=>setZoomScale(v=>v===1?2:1)}>{t(zoomScale===1?'放大细节（2×）':'适应屏幕')}</button><div className="zoom-scroll">{zoom&&<span className="zoom-stage" style={zoomScale>1?{width:'200%',maxWidth:'none'}:undefined}><img src={asset(zoom.src)} alt={zoom.label}/>{zoom.subjectOverlay&&<img className="subject-overlay" src={asset(zoom.subjectOverlay)} alt="" aria-hidden="true" style={{opacity:subjectOpacity}}/>}{zoom.overlay&&<img className="layout-overlay" src={asset(zoom.overlay)} alt="" aria-hidden="true" style={{opacity:overlayOpacity}}/>}</span>}</div></DialogContent></Dialog>
 </main>
}
