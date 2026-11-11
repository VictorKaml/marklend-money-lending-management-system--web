/* Dashboard Analysis (1.9): six donut charts built from one server call (analysis_breakdown).
 * Plain inline SVG, no library. Colours come from CSS tokens (--dv-*) that are validated for light and dark.
 * Every chart has a legend with exact values and a "View as table" fallback, so identity never rests on colour alone. */
const AN=state.analysis=state.analysis||{key:'',inflight:null,errKey:null,data:null,err:'',preset:'month',from:'',to:''};
const AN_MAX_SLICES=6;
const BRANCH_SLOTS=8;
const STATUS_SLOT={'Active':1,'Pending Approval':4,'Completed':3,'Restructured':7,'Defaulted':8,'Rejected':5,'Written-Off':6};
const CURRENCY_SLOT={MWK:1,USD:2,ZAR:3};
const SEMANTIC={Verified:'good',Pending:'warn',Rejected:'crit',Low:'good',Medium:'warn',High:'crit'};
const anColor=(slot)=>`var(--dv-${slot})`;
const anSem=(k)=>`var(--dv-${SEMANTIC[k]})`;

/* ----- period (only the collections chart uses it) ----- */
function anRange(){
  const now=new Date(),y=now.getUTCFullYear(),m=now.getUTCMonth(),iso=d=>d.toISOString().slice(0,10);
  if(AN.preset==='month')return{from:iso(new Date(Date.UTC(y,m,1))),to:iso(now)};
  if(AN.preset==='30')return{from:iso(new Date(Date.now()-29*864e5)),to:iso(now)};
  if(AN.preset==='year')return{from:iso(new Date(Date.UTC(y,0,1))),to:iso(now)};
  if(AN.preset==='custom')return{from:AN.from||null,to:AN.to||null};
  return{from:null,to:null};
}
const anKey=()=>{const r=anRange();return [state.currency,r.from||'',r.to||''].join('|')};
const anPeriodText=()=>{const r=anRange();return r.from||r.to?`${r.from||'start'} to ${r.to||'today'}`:'all time'};

/* ----- slice building (pure; exercised directly by the tests) ----- */
function anFold(slices,max=AN_MAX_SLICES){
  const real=slices.filter(s=>Number(s.value)>0).sort((a,b)=>b.value-a.value||String(a.label).localeCompare(b.label));
  const keep=real.filter(s=>s.color).slice(0,max),rest=real.filter(s=>!keep.includes(s));
  if(keep.length>=max&&rest.length>0){const last=keep.pop();rest.push(last)}   // make room so "Other" counts as one of the max
  const other=rest.reduce((a,s)=>a+Number(s.value),0);
  return other>0?[...keep,{key:'__other',label:'Other',value:other,color:'var(--dv-other)',inert:true}]:keep;
}
function anBuild(kind,d,cur){
  if(!d)return{slices:[],money:false};
  const sum=a=>a.reduce((t,s)=>t+Number(s.value||0),0);
  if(kind==='branch'||kind==='collect'){
    const f=kind==='branch'?'outstanding_minor':'collected_minor',all=d.by_branch||[];
    return{money:true,slices:anFold(all.map((b,i)=>({key:b.branch_id,label:b.name,value:Number(b[f]||0),color:i<BRANCH_SLOTS?anColor(i+1):null})))};
  }
  if(kind==='status')return{money:false,slices:anFold((d.loan_status||[]).map(r=>({key:r.status,label:r.status,value:Number(r.count),color:anColor(STATUS_SLOT[r.status]||5)})))};
  if(kind==='kyc')return{money:false,slices:anFold((d.kyc||[]).map(r=>({key:r.status,label:r.status,value:Number(r.count),color:anSem(r.status)})))};
  if(kind==='risk')return{money:true,slices:anFold((d.risk||[]).map(r=>({key:r.risk,label:r.risk+' risk',value:Number(r.outstanding_minor),color:anSem(r.risk)})))};
  if(kind==='currency')return{money:false,slices:anFold((d.currency_mix||[]).map(r=>({key:r.currency,label:r.currency,value:Number(r.count),color:anColor(CURRENCY_SLOT[r.currency]||4)})))};
  return{slices:[],money:false};
}
const anCompact=minor=>{const n=Number(minor)/100,a=Math.abs(n);return a>=1e9?(n/1e9).toFixed(1)+'B':a>=1e6?(n/1e6).toFixed(1)+'M':a>=1e3?(n/1e3).toFixed(1)+'K':n.toFixed(0)};

const CHARTS=[
  {id:'branch',title:'Portfolio by branch',sub:c=>`Outstanding principal · ${c}`,unit:'outstanding',empty:'No outstanding loans in this currency.'},
  {id:'status',title:'Loans by status',sub:()=>'Number of loans · all currencies',unit:'loans',empty:'No loans yet.'},
  {id:'kyc',title:'Borrowers by KYC status',sub:()=>'Number of borrowers',unit:'borrowers',empty:'No borrowers yet.'},
  {id:'risk',title:'Portfolio by risk level',sub:c=>`Outstanding principal · ${c}`,unit:'outstanding',empty:'No outstanding loans in this currency.'},
  {id:'collect',title:'Collections by branch',sub:c=>`Payments received · ${c} · ${anPeriodText()}`,unit:'collected',empty:'No payments in this period.'},
  {id:'currency',title:'Currency mix',sub:()=>'Open loans by currency (counts, not converted)',unit:'open loans',empty:'No open loans.'}
];

/* ----- one donut ----- */
function donutHTML(ch,cur){
  const {slices,money}=anBuild(ch.id,AN.data,cur),total=slices.reduce((a,s)=>a+s.value,0);
  const fmt=v=>money?mc(v,cur):Number(v).toLocaleString('en-US');
  const head=`<div class="dn-head"><h4>${esc(ch.title)}</h4>${sub(esc(ch.sub(cur)))}</div>`;
  if(!slices.length||total<=0)return `<div class="card panel dn-card" id="dn-${ch.id}">${head}<div class="empty">${esc(ch.empty)}</div></div>`;
  const R=72,C=2*Math.PI*R,gap=slices.length>1?2.5:0;let off=0;
  const pct=v=>Math.round(v*1000/total)/10;
  const aria=slices.map(s=>`${s.label} ${fmt(s.value).replace(/<[^>]+>/g,'')} (${pct(s.value)}%)`).join(', ');
  const segs=slices.map((s,i)=>{
    const len=C*s.value/total,dash=Math.max(.5,len-gap),el=`<circle class="dn-seg${s.inert?'':' go'}" data-i="${i}" cx="100" cy="100" r="${R}" fill="none" stroke="${s.color}" stroke-width="26" stroke-dasharray="${dash.toFixed(2)} ${(C-dash).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 100 100)" aria-hidden="true" onmouseenter="anHover('${ch.id}',${i})" onmouseleave="anHover('${ch.id}',-1)"${s.inert?'':` onclick="anClick('${ch.id}',${i})"`}><title>${esc(s.label)}: ${esc(fmt(s.value).replace(/<[^>]+>/g,''))} (${pct(s.value)}%)</title></circle>`;
    off+=len;return el;
  }).join('');
  const centerTop=money?anCompact(total):Number(total).toLocaleString('en-US');
  const svg=`<svg class="donut" viewBox="0 0 200 200" role="img" aria-label="${esc(ch.title)}: ${esc(aria)}">${segs}<text x="100" y="98" text-anchor="middle" class="dn-total">${esc(centerTop)}</text><text x="100" y="118" text-anchor="middle" class="dn-unit">${esc(money?cur:ch.unit)}</text></svg>`;
  const clickable=s=>!s.inert&&anCanClick(ch.id);
  const legend=`<ul class="dn-legend">${slices.map((s,i)=>`<li data-i="${i}" onmouseenter="anHover('${ch.id}',${i})" onmouseleave="anHover('${ch.id}',-1)">${clickable(s)?`<button type="button" class="dn-row" onclick="anClick('${ch.id}',${i})">`:'<div class="dn-row">'}<i class="dn-sw" style="background:${s.color}"></i><span class="dn-label">${esc(s.label)}</span><span class="dn-val">${money?mc(s.value,cur):fmt(s.value)}</span><span class="dn-pct">${pct(s.value)}%</span>${clickable(s)?'</button>':'</div>'}</li>`).join('')}</ul>`;
  const table=`<details class="dn-table"><summary>View as table</summary><div class="table-wrap"><table class="table"><thead><tr><th>${esc(ch.title.replace(/^.* by /,'').replace(/^./,x=>x.toUpperCase()))}</th><th class="num">Value</th><th class="num">Share</th></tr></thead><tbody>${slices.map(s=>`<tr><td>${esc(s.label)}</td><td class="num">${money?mc(s.value,cur):fmt(s.value)}</td><td class="num">${pct(s.value)}%</td></tr>`).join('')}<tr><td><b>Total</b></td><td class="num"><b>${money?mc(total,cur):fmt(total)}</b></td><td class="num">100%</td></tr></tbody></table></div></details>`;
  const note=slices.length===1&&!slices[0].inert?`<div class="dn-note">Everything here is ${esc(slices[0].label)}.</div>`:'';
  return `<div class="card panel dn-card" id="dn-${ch.id}">${head}<div class="dn-body">${svg}${legend}</div>${note}${table}</div>`;
}
function anHover(id,i){
  const card=document.getElementById('dn-'+id);if(!card)return;
  const svg=card.querySelector('.donut');if(!svg)return;
  svg.classList.toggle('hovering',i>=0);
  card.querySelectorAll('.dn-seg').forEach(e=>e.classList.toggle('on',Number(e.dataset.i)===i));
  card.querySelectorAll('.dn-legend li').forEach(e=>e.classList.toggle('on',Number(e.dataset.i)===i));
}

/* ----- clicking a slice filters the matching list ----- */
const anCanClick=id=>(id==='branch'||id==='collect')?isAdminUser():true;
function anSliceKey(id,i){return anBuild(id,AN.data,state.currency).slices[i]}
function anClick(id,i){
  const sl=anSliceKey(id,i);if(!sl||sl.inert||!anCanClick(id))return;
  const fresh=v=>{const s=pgs(v);s.f={};s.q='';s.from='';s.to='';s.page=0;s.stale=true;return s};
  if(id==='branch'){fresh('loans').f.branch=sl.key;return go('loans')}
  if(id==='collect'){const s=fresh('repayments'),r=anRange();s.f.branch=sl.key;s.f.currency=state.currency;s.from=r.from||'';s.to=r.to||'';return go('repayments')}
  if(id==='status'){fresh('loans').f.status=sl.key;return go('loans')}
  if(id==='kyc'){fresh('borrowers').f.kyc=sl.key;return go('borrowers')}
  if(id==='risk'){fresh('borrowers').f.risk=sl.key;return go('borrowers')}
  if(id==='currency')return setCurrency(sl.key);
}

/* ----- loading and layout ----- */
let anSeq=0;
async function loadAnalysis(){
  const key=anKey(),r=anRange(),seq=++anSeq;AN.inflight=key;
  const res=await state.sb.rpc('analysis_breakdown',{p_currency:state.currency,p_from:r.from,p_to:r.to});
  if(seq!==anSeq)return;
  AN.inflight=null;AN.key=key;
  if(res.error){AN.data=null;AN.errKey=key;AN.err=isSchemaErr(res.error)?'Run the latest supabase/schema.sql in Supabase to enable the Analysis charts.':res.error.message}
  else{AN.data=res.data;AN.errKey=null;AN.err=''}
  anPaint();
}
function anPaint(){const h=document.getElementById('analysisHost');if(h&&state.view==='dashboard')analysisView(h)}
function anSetPreset(v){AN.preset=v;AN.errKey=null;anPaint()}
function anSetDate(k,v){AN[k]=v;AN.errKey=null;anPaint()}
function analysisView(host){
  if(AN.key!==anKey()&&AN.inflight!==anKey()&&AN.errKey!==anKey())loadAnalysis();
  const presets=[['all','All time'],['month','This month'],['30','Last 30 days'],['year','This year'],['custom','Custom']];
  const cur=state.currency;
  const bar=`<div class="toolbar"><div><h3 style="margin:0">Analysis</h3>${sub(isAdminUser()?'Where the portfolio sits across branches, statuses and risk. Click a slice to see those records.':'Your branch at a glance. Click a slice to see those records.')}</div><div class="tb">${curSwitch()}<select class="cursel" aria-label="Collections period" onchange="anSetPreset(this.value)">${presets.map(([v,l])=>`<option value="${v}"${AN.preset===v?' selected':''}>Collections: ${l}</option>`).join('')}</select>${AN.preset==='custom'?`<label class="dr"><input type="date" aria-label="From date" value="${esc(AN.from)}" onchange="anSetDate('from',this.value)"> – <input type="date" aria-label="To date" value="${esc(AN.to)}" onchange="anSetDate('to',this.value)"></label>`:''}</div></div>`;
  let body;
  if(AN.errKey===anKey()&&AN.err)body=`<div class="alert info" style="margin-top:14px">${esc(AN.err)}</div>`;
  else if(!AN.data||AN.key!==anKey())body='<div class="empty">Loading analysis…</div>';
  else body=`<div class="dn-grid">${CHARTS.map(ch=>donutHTML(ch,cur)).join('')}</div>`;
  host.innerHTML=`<section class="card panel" style="margin-top:17px" aria-label="Analysis">${bar}${body}</section>`;
}
function dashboardWithAnalysis(c){
  dashboard(c);
  if(state.userProfile?.role==='Borrower'||!can('dashboard'))return;
  const host=document.createElement('div');host.id='analysisHost';c.append(host);analysisView(host);
}
