import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {makeHandler,validAssignments} from './server.mjs';
import manifest from './study-manifest.json' with {type:'json'};

const origin='https://tony-lowe.github.io';
const grouped=Object.groupBy(manifest.cases,c=>c.pool);
function fixture(){
 const assignments=[];
 for(const pool of ['user_selected','prior_reviewed']){
  const selected=grouped[pool].slice(0,6);
  for(let i=0;i<6;i++){
   const opponent=i<3?'creatidesign':'uno',left=(pool==='user_selected'?i%3<2:i%3<1)?'ours':opponent;
   assignments.push({id:randomUUID(),caseId:selected[i].id,pool,left,right:left==='ours'?opponent:'ours'});
  }
 }
 const id=randomUUID();
 const answer={kind:'design-preference-study-offline-answer',version:manifest.version,participant:id.slice(0,8),token:randomUUID()+randomUUID(),session:{id,version:manifest.version,assignments},demo:false,votes:assignments.flatMap(t=>['aesthetic','adherence'].map(dimension=>({trialId:t.id,dimension,choice:'tie',reasons:[],comment:'',elapsedMs:300})))};
 assert.equal(validAssignments(assignments),true);
 return answer;
}
function memoryStore(){const docs=new Map();return {async get(id){return docs.get(id)??null;},async put(id,v){docs.set(id,v);},async delete(id){docs.delete(id);},async pending(limit){return [...docs.values()].filter(x=>!x.imported&&!x.withdrawn).slice(0,limit);},async withdrawals(limit){return [...docs.values()].filter(x=>x.withdrawn).slice(0,limit);},async ackWithdrawal(id){if(!docs.get(id)?.withdrawn)return false;docs.delete(id);return true;},async markImported(id,digest){const current=docs.get(id);if(!current||current.withdrawn||current.digest!==digest)return false;current.imported=true;return true;}};}
async function call(handler,path,{method='GET',body,authorization,requestOrigin=origin,sourceIp}={}){
 const headers={'Origin':requestOrigin};if(authorization)headers.Authorization=authorization;
 if(sourceIp)headers['X-Real-IP']=sourceIp;
 const req=new Request('https://relay.test'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 const res=await handler(req);return {status:res.status,body:await res.json()};
}

test('receives one completed answer, retries safely, and exposes it only to admin',async()=>{
 const store=memoryStore(),handler=makeHandler({store,adminKey:'test-only-admin-key'}),answer=fixture();
 assert.equal((await call(handler,'/answers',{method:'POST',body:answer,requestOrigin:'https://evil.example'})).status,403);
 assert.equal((await call(handler,'/admin/answers')).status,401);
 const saved=await call(handler,'/answers',{method:'POST',body:answer,sourceIp:'203.0.113.5'});assert.equal(saved.status,200);assert.deepEqual(saved.body,{received:24,complete:true});
 assert.equal((await call(handler,'/answers',{method:'POST',body:answer})).status,200);
 const admin='Bearer test-only-admin-key',items=(await call(handler,'/admin/answers',{authorization:admin})).body.items;
 assert.equal(items.length,1);assert.deepEqual(items[0].answer.votes,answer.votes);
 assert.equal(items[0].ipAddress,'203.0.113.5');
 assert.equal((await call(handler,'/admin/ack',{method:'POST',body:{items:[{id:answer.session.id,digest:'0'.repeat(64)}]},authorization:admin})).body.acknowledged,0);
 assert.equal((await call(handler,'/admin/ack',{method:'POST',body:{items:[{id:items[0].id,digest:items[0].digest}]},authorization:admin})).body.acknowledged,1);
 assert.equal((await call(handler,'/admin/answers',{authorization:admin})).body.items.length,0);
 assert.equal((await call(handler,'/answers',{method:'DELETE',body:{id:answer.session.id,token:'wrong'}})).status,400);
 assert.equal((await call(handler,'/answers',{method:'DELETE',body:{id:answer.session.id,token:answer.token}})).status,200);
 assert.equal((await call(handler,'/admin/withdrawals',{authorization:admin})).body.items.length,1);
 assert.equal((await call(handler,'/admin/withdrawal-ack',{method:'POST',body:{id:answer.session.id},authorization:admin})).body.acknowledged,true);
 assert.equal(await store.get(answer.session.id),null);
});

test('gateway prefix and withdrawal tombstones prevent a withdrawn answer from reappearing',async()=>{
 const store=memoryStore(),handler=makeHandler({store,adminKey:'test-only-admin-key'}),answer=fixture();
 assert.equal((await call(handler,'/study-relay/health')).body.ok,true);
 assert.equal((await call(handler,'/study-relay/answers',{method:'POST',body:answer})).body.received,24);
 assert.equal((await call(handler,'/study-relay/answers',{method:'DELETE',body:{id:answer.session.id,token:answer.token}})).body.deleted,true);
 assert.equal((await call(handler,'/study-relay/answers',{method:'POST',body:answer})).status,409);
 assert.equal((await call(handler,'/admin/answers',{authorization:'Bearer test-only-admin-key'})).body.items.length,0);
});

test('keeps a monotonic partial answer and rejects conflicting updates',async()=>{
 const handler=makeHandler({store:memoryStore(),adminKey:'test-only-admin-key'}),answer=fixture();
 const partial={...answer,votes:answer.votes.slice(0,6)};
 assert.equal((await call(handler,'/answers',{method:'POST',body:partial})).body.received,6);
 assert.equal((await call(handler,'/answers',{method:'POST',body:answer})).body.received,24);
 assert.equal((await call(handler,'/answers',{method:'POST',body:partial})).status,409);
 const changed={...answer,votes:answer.votes.map((v,i)=>i===0?{...v,choice:'A'}:v)};
 assert.equal((await call(handler,'/answers',{method:'POST',body:changed})).status,409);
 const wrongToken={...answer,token:randomUUID()+randomUUID()};
 assert.equal((await call(handler,'/answers',{method:'POST',body:wrongToken})).status,409);
 const wrongOrder={...answer,votes:[answer.votes[1],...answer.votes.slice(1)]};
 assert.equal((await call(handler,'/answers',{method:'POST',body:wrongOrder})).status,400);
});
