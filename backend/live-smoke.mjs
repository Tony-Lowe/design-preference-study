import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import manifest from './study-manifest.json' with {type:'json'};

const relay=(process.env.RELAY_URL??'').replace(/\/$/,'');
if(!relay)throw Error('Set RELAY_URL to the deployed /study-relay URL');
const adminKey=(await readFile(new URL('../.admin-key',import.meta.url),'utf8')).trim();
const origin='https://tony-lowe.github.io';
const grouped=Object.groupBy(manifest.cases,c=>c.pool);
const assignments=[];
for(const pool of ['user_selected','prior_reviewed']){
 const cases=grouped[pool].slice(0,6);
 for(let i=0;i<6;i++){
  const opponent=i<3?'creatidesign':'uno';
  const left=(pool==='user_selected'?i%3<2:i%3<1)?'ours':opponent;
  assignments.push({id:randomUUID(),caseId:cases[i].id,pool,left,right:left==='ours'?opponent:'ours'});
 }
}
const id=randomUUID(),token=randomUUID()+randomUUID();
const answer={kind:'design-preference-study-offline-answer',version:manifest.version,participant:id.slice(0,8),token,session:{id,version:manifest.version,assignments},demo:true,votes:assignments.flatMap(t=>['aesthetic','adherence'].map(dimension=>({trialId:t.id,dimension,choice:'tie',reasons:[],comment:'integration smoke test',elapsedMs:1})))};
async function call(path,{method='GET',body,admin=false}={}){
 const headers={Origin:origin};
 if(body!==undefined)headers['Content-Type']='text/plain';
 if(admin)headers.Authorization=`Bearer ${adminKey}`;
 const response=await fetch(relay+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 const raw=await response.text();
 let data;try{data=JSON.parse(raw);}catch{data={raw:raw.slice(0,200)};}
 if(!response.ok)throw Error(`${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
 return data;
}
const health=await call('/health');
if(!health.ok||health.version!==manifest.version)throw Error('Health/version check failed');
let inserted=false;
try{
 const saved=await call('/answers',{method:'POST',body:answer});inserted=true;
 if(saved.received!==24||!saved.complete)throw Error('Answer write was not confirmed');
 const list=await call('/admin/answers',{admin:true});
 const item=list.items?.find(item=>item.id===id);
 if(!item)throw Error('Admin read did not find smoke answer');
 if(!item.ipAddress)throw Error('Gateway IP address was not recorded');
 console.log('PASS: health, database write, admin read, and IP capture');
}finally{
 if(inserted){
  const withdrawn=await call('/answers',{method:'DELETE',body:{id,token}});
  if(!withdrawn.deleted)throw Error('Withdrawal failed');
  const ack=await call('/admin/withdrawal-ack',{method:'POST',body:{id},admin:true});
  if(!ack.acknowledged)throw Error('Smoke answer cleanup failed');
  console.log('PASS: withdrawal and cleanup');
 }
}
