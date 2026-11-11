/* Supabase REST/auth client */

class SupaClient {
 constructor(url,key,config){this.url=url.replace(/\/$/,"");this.key=key;this.config=config;this.token=config.accessToken||null;}
 headers(){return {apikey:this.key,Authorization:`Bearer ${this.token||this.key}`,"Content-Type":"application/json",Prefer:"return=representation"};}
 async req(path,opts={}){const r=await fetch(this.url+path,{...opts,headers:{...this.headers(),...(opts.headers||{})}});const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{}if(!r.ok)throw new Error(data?.message||data?.error_description||data?.error||text||`HTTP ${r.status}`);return data;}
 async signUp(email,password,metadata={}){const r=await fetch(this.url+"/auth/v1/signup",{method:"POST",headers:{apikey:this.key,"Content-Type":"application/json"},body:JSON.stringify({email,password,data:metadata})});const d=await r.json();if(!r.ok)throw new Error(d.msg||d.error_description||d.message||"Account creation failed");return d;}
 async signIn(email,password,remember=true){const r=await fetch(this.url+"/auth/v1/token?grant_type=password",{method:"POST",headers:{apikey:this.key,"Content-Type":"application/json"},body:JSON.stringify({email,password})});const d=await r.json();if(!r.ok)throw new Error(d.error_description||d.msg||d.message||"Sign in failed");this.token=d.access_token;this.config.accessToken=d.access_token;this.config.refreshToken=d.refresh_token;this.config.sessionStartedAt=new Date().toISOString();this.config.sessionExpiresAt=new Date(Date.now()+Number(d.expires_in||3600)*1000).toISOString();this.config.rememberSession=!!remember;if(!remember){delete this.config.refreshToken;delete this.config.accessToken;}await window.marklendAPI.saveConfig(this.config);if(!remember){sessionStorage.setItem('marklend-access-token',d.access_token);sessionStorage.setItem('marklend-refresh-token',d.refresh_token||'');}return d;}
 async refresh(){const rt=this.config.refreshToken||sessionStorage.getItem('marklend-refresh-token');if(!rt)throw new Error('No refresh token available');const r=await fetch(this.url+"/auth/v1/token?grant_type=refresh_token",{method:"POST",headers:{apikey:this.key,"Content-Type":"application/json"},body:JSON.stringify({refresh_token:rt})});const d=await r.json();if(!r.ok)throw new Error(d.error_description||d.msg||d.message||"Session refresh failed");this.token=d.access_token;this.config.accessToken=d.access_token;this.config.refreshToken=d.refresh_token||rt;this.config.sessionExpiresAt=new Date(Date.now()+Number(d.expires_in||3600)*1000).toISOString();if(this.config.rememberSession!==false)await window.marklendAPI.saveConfig(this.config);else{sessionStorage.setItem('marklend-access-token',d.access_token);sessionStorage.setItem('marklend-refresh-token',d.refresh_token||rt);}return d;}
 async signOut(){try{if(this.token)await fetch(this.url+"/auth/v1/logout",{method:"POST",headers:{apikey:this.key,Authorization:`Bearer ${this.token}`}});}catch(_){} this.token=null;delete this.config.accessToken;delete this.config.refreshToken;delete this.config.sessionStartedAt;delete this.config.sessionExpiresAt;sessionStorage.removeItem('marklend-access-token');sessionStorage.removeItem('marklend-refresh-token');await window.marklendAPI.saveConfig(this.config);}
 async getUser(){const r=await fetch(this.url+"/auth/v1/user",{headers:{apikey:this.key,Authorization:`Bearer ${this.token||this.key}`}});const d=await r.json();if(!r.ok)throw new Error(d.message||d.error_description||"Unable to load signed-in user");return d;}
 from(table){
  const self=this,q={filters:[],select:"*",orderBy:null,ascending:true,limitN:null,method:"GET",body:null};
  const builder={
   select(cols="*"){q.select=cols;return builder},
   eq(k,v){q.filters.push([k,"eq",v]);return builder},
   order(k,o={}){q.orderBy=k;q.ascending=o.ascending!==false;return builder},
   limit(n){q.limitN=n;return builder},
   then(resolve){(async()=>{try{let path=`/rest/v1/${table}?select=${encodeURIComponent(q.select)}`;for(const [k,op,v] of q.filters)path+=`&${encodeURIComponent(k)}=${op}.${encodeURIComponent(v)}`;if(q.orderBy)path+=`&order=${encodeURIComponent(q.orderBy)}.${q.ascending?"asc":"desc"}`;if(q.limitN)path+=`&limit=${q.limitN}`;resolve({data:await self.req(path),error:null})}catch(e){resolve({data:null,error:e})}})()},
   insert(obj){
     q.method="POST"; q.body=obj;
     return builder;
   },
   update(obj){
     q.method="PATCH"; q.body=obj;
     return builder;
   },
   async single(){try{
     let path=`/rest/v1/${table}?select=${encodeURIComponent(q.select)}`;
     for(const [k,op,v] of q.filters)path+=`&${encodeURIComponent(k)}=${op}.${encodeURIComponent(v)}`;
     if(q.method==="POST"){
       const data=await self.req(path,{method:"POST",body:JSON.stringify(q.body),headers:{Prefer:"return=representation"}});
       return {data:Array.isArray(data)?(data[0]||null):data,error:null};
     }
     path += `&limit=1`;
     const d=await self.req(path);
     return {data:d?.[0]||null,error:null};
   }catch(e){return {data:null,error:e}}},
   async execute(){try{
     let path=`/rest/v1/${table}?select=${encodeURIComponent(q.select)}`;
     for(const [k,op,v] of q.filters)path+=`&${encodeURIComponent(k)}=${op}.${encodeURIComponent(v)}`;
     const data=await self.req(path,{method:q.method||"GET",body:q.body?JSON.stringify(q.body):undefined,headers:q.method==="POST"?{Prefer:"return=representation"}:undefined});
     return {data,error:null};
   }catch(e){return {data:null,error:e}}}
  };
  return builder;
 }
 async rpc(fn,args){try{return {data:await this.req(`/rest/v1/rpc/${fn}`,{method:"POST",body:JSON.stringify(args||{})}),error:null}}catch(e){return {data:null,error:e}}}
}


