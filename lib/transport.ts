'use client';
declare global {interface Window {__STUDY_CONFIG__?:{api:string;base:string}}}
export function asset(path:string){const base=typeof window!=='undefined'?window.__STUDY_CONFIG__?.base??'':'';return base.replace(/\/$/,'')+path;}
const tokenKey='design-study-session-v1';
function token(){try{return localStorage.getItem(tokenKey)||'';}catch{return '';}}
export function setStudyToken(value:string){localStorage.setItem(tokenKey,value);}
export async function studyFetch(path:string,init:RequestInit={}){
 const endpoint=typeof window!=='undefined'?window.__STUDY_CONFIG__?.api??'':'';
 const headers=new Headers(init.headers);let method=init.method??'GET',body=init.body;
 if(endpoint){
  const resumeToken=token();
  if(path==='/api/session'&&method==='GET'&&resumeToken){method='POST';body=JSON.stringify({resume:true,resumeToken});}
  else if(method==='POST'&&(path==='/api/vote'||path==='/api/votes'||path==='/api/session')&&body){body=JSON.stringify({...JSON.parse(String(body)),...(resumeToken?{resumeToken}:{})});}
  if(method==='POST'&&(path==='/api/vote'||path==='/api/votes'||path==='/api/session')){headers.delete('Authorization');headers.set('Content-Type','text/plain');}
  else if(resumeToken&&!headers.has('Authorization'))headers.set('Authorization','Participant '+resumeToken);
 }
 const timeout=new AbortController();const timer=setTimeout(()=>timeout.abort(),8000);
 let r:Response;
 try{r=await fetch(endpoint+path,{...init,method,body,headers,credentials:endpoint?'omit':'same-origin',signal:init.signal??timeout.signal});}
 finally{clearTimeout(timer);}
 if(endpoint&&path==='/api/session'&&r.ok){if(method==='DELETE'){try{localStorage.removeItem(tokenKey);}catch{}}else if(method==='POST'){const data=await r.clone().json() as {resumeToken?:string};if(data.resumeToken)try{localStorage.setItem(tokenKey,data.resumeToken);}catch{}}}
 return r;
}
