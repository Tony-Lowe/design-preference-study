'use client';
import {useState} from 'react';
import {studyFetch} from '@/lib/transport';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from '@/components/ui/table';
import {Download,RefreshCw,LockKeyhole,ArrowLeft} from 'lucide-react';

type Summary={pool:string;dimension:string;method:string;opponent:string;wins:number;losses:number;ties:number;skipped:number;valid:number;winRate:number|null;tieAdjusted:number|null;participants:number;cases:number};
type Result={version:string;mode:string;caseCount:number;participants:number;completed:number;judgments:number;summaries:Summary[];participantDetails:Array<{participant_id:string;ip_address:string|null;created_at:string;saved_judgments:number}>};

export default function Admin(){
 const [key,setKey]=useState(''),[data,setData]=useState<Result|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[importFile,setImportFile]=useState<File|null>(null),[importText,setImportText]=useState(''),[importMessage,setImportMessage]=useState('');
 async function load(){setBusy(true);setError('');try{const r=await studyFetch('/api/admin',{headers:{Authorization:`Bearer ${key}`}});const j=await r.json() as Result&{error?:string};if(!r.ok)throw Error(j.error);setData(j);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function download(format:string){setError('');try{const r=await studyFetch(`/api/admin?format=${format}`,{headers:{Authorization:`Bearer ${key}`}});if(!r.ok)throw Error('导出失败，请重试。');const url=URL.createObjectURL(await r.blob());const a=document.createElement('a');a.href=url;a.download=`study-${data?.version}.${format}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setError((e as Error).message);}}
 async function upload(){if(!importFile&&!importText.trim())return;setBusy(true);setError('');setImportMessage('');try{
  const answer=JSON.parse(importFile?await importFile.text():importText);
  if(answer.kind!=='design-preference-study-offline-answer')throw Error('请选择参与页面下载的 JSON 答卷。');
  if(!Array.isArray(answer.votes)||!answer.votes.length)throw Error('答卷中没有评分。');
  let imported=0;let last:{error?:string;participant?:string;imported?:number;saved?:number;demo?:boolean}={};
  for(let i=0;i<answer.votes.length;i+=6){
   const r=await studyFetch('/api/admin/import',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({...answer,votes:answer.votes.slice(i,i+6)})});
   const result=await r.json() as typeof last;
   if(!r.ok)throw Error(result.error||'导入失败，请保留文件并重试。');
   imported+=result.imported??0;last=result;
  }
  setImportMessage(`参与编号 ${last.participant}：新导入 ${imported} 项，共已保存 ${last.saved} 项${last.demo?'（演示，不计入统计）':''}。`);
  setImportFile(null);
  setImportText('');
  await load();
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const pct=(n:number|null)=>n===null?'—':(n*100).toFixed(1)+'%';
 const groups=[['all','aesthetic','美观偏好 · 主要结果'],['all','adherence','指令遵循 · 辅助结果']];
 return <main className="study-shell admin-shell">
  <header className="masthead"><div className="brand"><LockKeyhole size={23}/>研究结果管理</div><a href="./" className="quiet"><ArrowLeft size={14}/>返回评选</a></header>
  {!data?<section className="admin-login"><h1>查看收集进度与导出结果</h1><p>输入研究管理码。评分参与者无法查看方法名称或实时结果。</p><form onSubmit={e=>{e.preventDefault();load();}}><Input aria-label="研究管理码" type="password" value={key} onChange={e=>setKey(e.target.value)} autoComplete="off" placeholder="研究管理码"/><Button disabled={busy||!key} type="submit">{busy?'正在验证…':'查看结果'}</Button></form></section>:<>
   <div className="admin-top"><div><h1>评分收集概览</h1><p className="quiet">当前版本 {data.version} · {data.caseCount} 个案例</p></div><div className="admin-actions"><Button variant="outline" onClick={load} disabled={busy}><RefreshCw size={15}/>刷新</Button><Button variant="outline" onClick={()=>download('csv')}><Download size={15}/>CSV 原始评分</Button><Button onClick={()=>download('json')}>导出 JSON</Button></div></div>
   <div className="stat-grid">{[['参与人数',data.participants],['已完成人数',data.completed],['已保存判断',data.judgments],['案例数',data.caseCount]].map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
   <p className="admin-note">每人比较 12 组，每组先评美观、再评指令遵循，共 24 项判断。美观为主要结果，指令遵循为辅助结果，分别统计。当前统计包含已提交的部分答卷，排除演示数据；「无法判断」不进入胜率分母。平局保留，平局折半分数 =（胜 + 0.5 × 平）/（胜 + 平 + 负）。</p>
   <section className="results-block"><h2>导入离线答卷</h2><p className="admin-note">参与者若始终无法连接评分服务器，可在完成页复制答卷文本或下载 JSON 文件并交给研究者。粘贴文本或选择文件后导入；重复导入不会重复计票。手工导入的会话没有参与者 IP。</p><textarea className="import-text" aria-label="粘贴离线答卷 JSON" placeholder="在这里粘贴参与者发来的答卷文本，或在下方选择 JSON 文件" value={importText} onChange={e=>{setImportText(e.target.value);if(e.target.value)setImportFile(null);}} rows={5}/><div className="import-controls"><input type="file" accept=".json,application/json" aria-label="选择离线答卷 JSON" onChange={e=>{setImportFile(e.target.files?.[0]??null);if(e.target.files?.[0])setImportText('');}}/><Button disabled={(!importFile&&!importText.trim())||busy} onClick={upload}>{busy?'正在导入…':'导入答卷'}</Button></div>{importMessage&&<p role="status" className="import-success">{importMessage}</p>}</section>
   {groups.map(([pool,dimension,title])=><section className="results-block" key={pool+dimension}><h2>{title}</h2><Table><TableHeader><TableRow>{['比较','胜 / 平 / 负','无法判断','胜率','平局折半','参与者 / 案例'].map(h=><TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader><TableBody>{data.summaries.filter(r=>r.pool===pool&&r.dimension===dimension).map(r=><TableRow key={r.method+r.opponent}><TableCell><b>{r.method}</b><span className="versus"> vs </span>{r.opponent}</TableCell><TableCell>{r.wins} / {r.ties} / {r.losses}</TableCell><TableCell>{r.skipped}</TableCell><TableCell>{pct(r.winRate)}</TableCell><TableCell>{pct(r.tieAdjusted)}</TableCell><TableCell>{r.participants} / {r.cases}</TableCell></TableRow>)}</TableBody></Table></section>)}
   <section className="results-block"><h2>参与会话</h2><p className="admin-note">IP 在开始评选时记录。上线前已创建的会话可能没有 IP；演示会话不显示。</p><Table><TableHeader><TableRow>{['参与编号','IP 地址','开始时间','已保存判断'].map(h=><TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader><TableBody>{data.participantDetails.map(s=><TableRow key={s.participant_id}><TableCell><code>{s.participant_id.slice(0,8)}</code></TableCell><TableCell><code>{s.ip_address??'—'}</code></TableCell><TableCell>{s.created_at}</TableCell><TableCell>{s.saved_judgments}</TableCell></TableRow>)}</TableBody></Table></section>
  </>}{error&&<p role="alert" className="error">{error}</p>}
 </main>;
}
