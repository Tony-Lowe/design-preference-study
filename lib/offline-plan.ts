import manifest from '@/data/offline-cases.json';

export type OfflineMethod='ours'|'creatidesign'|'uno';
export type OfflineAssignment={id:string;caseId:string;pool:'user_selected'|'prior_reviewed';left:OfflineMethod;right:OfflineMethod};

function randomInt(n:number){const values=new Uint32Array(1);const ceiling=Math.floor(4294967296/n)*n;do{crypto.getRandomValues(values);}while(values[0]>=ceiling);return values[0]%n;}
function shuffle<T>(items:T[]):T[]{const result=[...items];for(let i=result.length-1;i>0;i--){const j=randomInt(i+1);[result[i],result[j]]=[result[j],result[i]];}return result;}

export function makeOfflineAssignments():OfflineAssignment[]{
 const extraLeft={creatidesign:randomInt(2),uno:randomInt(2)};
 return shuffle((['user_selected','prior_reviewed'] as const).flatMap(pool=>{
  const cases=shuffle(manifest.cases.filter(c=>c.pool===pool)).slice(0,6);
  const sides=shuffle((['creatidesign','uno'] as const).flatMap(opponent=>{
   const leftCount=1+(pool==='user_selected'?extraLeft[opponent]:1-extraLeft[opponent]);
   return Array.from({length:3},(_,i)=>i<leftCount?(['ours',opponent] as const):([opponent,'ours'] as const));
  }));
  return cases.map((c,i)=>({id:crypto.randomUUID(),caseId:c.id,pool,left:sides[i][0],right:sides[i][1]}));
 }));
}

export function offlinePlan(assignments:OfflineAssignment[]){return assignments.map((a,i)=>{
 const c=manifest.cases.find(item=>item.id===a.caseId)!;
 return {id:a.id,index:i+1,images:[c.panels[a.left],c.panels[a.right]],prompt:c.prompt,requirements:{prompt:c.prompt,semantic:c.panels.semantic,pixel:c.panels.pixel,...(c.layoutOverlay?{layoutOverlay:c.layoutOverlay}:{}),...(c.subjectOverlay?{subjectOverlay:c.subjectOverlay}:{})}};
});}

export const offlineVersion=manifest.version;
