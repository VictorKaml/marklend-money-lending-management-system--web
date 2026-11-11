/* Branch performance (1.8.2): ranked comparison of branches, bar chart, per-officer drill-down, CSV/PDF export.
 * All aggregation happens in SQL (branch_metrics / officer_metrics); this file only derives ratios and presents them. */
const canSeePerformance=()=>state.userProfile?.role==='Admin'||(state.userProfile?.role==='Branch Manager'&&can('reports'));
const PF=state.perf=state.perf||{key:'',inflight:null,errKey:null,rows:null,err:'',preset:'all',from:'',to:'',rank:'rate',open:null,officers:null,officersKey:'',officersLoading:false};
const PF_RANKS={rate:{l:'Collection rate',hi:true},par:{l:'Portfolio at risk (30+ days)',hi:false},disbursed:{l:'Disbursed',hi:true},outstanding:{l:'Outstanding principal',hi:true},active:{l:'Active loans',hi:true},kyc:{l:'KYC verified',hi:true}};
const pct1=v=>v==null?'—':(Math.round(v*10)/10).toFixed(1)+'%';

/* ----- derived figures (pure) ----- */
function pfDerive(r){
  const n=k=>Number(r[k]||0);
  return {...r,
    rate:n('due_minor')>0?n('paid_on_due_minor')*100/n('due_minor'):null,
    par:n('outstanding_minor')>0?n('par30_minor')*100/n('outstanding_minor'):0,
    kycPct:n('borrowers')>0?n('kyc_verified')*100/n('borrowers'):null,
    avg:n('disbursed_count')>0?n('disbursed_minor')/n('disbursed_count'):null,
    perOfficer:n('officers')>0?n('active_loans')/n('officers'):null};
}
function pfTotals(rows){
  const t={name:'All branches',code:'',status:''};
  for(const k of ['borrowers','kyc_verified','officers','active_loans','outstanding_minor','disbursed_count','disbursed_minor','collected_minor','due_minor','paid_on_due_minor','par30_minor','penalties_minor'])t[k]=rows.reduce((a,r)=>a+Number(r[k]||0),0);
  return pfDerive(t);
}
function pfValue(d,k){return k==='rate'?d.rate:k==='par'?d.par:k==='disbursed'?Number(d.disbursed_minor):k==='outstanding'?Number(d.outstanding_minor):k==='active'?Number(d.active_loans):d.kycPct}
function pfRanked(rows,k){
  const hi=PF_RANKS[k].hi;
  return rows.map(pfDerive).sort((a,b)=>{const x=pfValue(a,k),y=pfValue(b,k);if(x==null&&y==null)return a.name.localeCompare(b.name);if(x==null)return 1;if(y==null)return -1;return (hi?y-x:x-y)||a.name.localeCompare(b.name)});
}
const pfBadge=(v,good,warn,lowerBetter)=>{if(v==null)return '<span class="badge b-pending">—</span>';const ok=lowerBetter?v<=good:v>=good,mid=lowerBetter?v<=warn:v>=warn;return `<span class="badge ${ok?'b-active':mid?'b-pending':'b-default'}">${pct1(v)}</span>`};
const pfRateBadge=v=>pfBadge(v,90,75,false),pfParBadge=v=>pfBadge(v,5,10,true);

/* ----- period ----- */
const isoDay=d=>d.toISOString().slice(0,10);
function pfRange(){
  const now=new Date(),y=now.getUTCFullYear(),m=now.getUTCMonth();
  if(PF.preset==='month')return{from:isoDay(new Date(Date.UTC(y,m,1))),to:isoDay(now)};
  if(PF.preset==='30')return{from:isoDay(new Date(Date.now()-29*864e5)),to:isoDay(now)};
  if(PF.preset==='year')return{from:isoDay(new Date(Date.UTC(y,0,1))),to:isoDay(now)};
  if(PF.preset==='custom')return{from:PF.from||null,to:PF.to||null};
  return{from:null,to:null};
}
const pfKey=()=>{const r=pfRange();return [state.currency,r.from||'',r.to||''].join('|')};

/* ----- loading ----- */
let pfSeq=0;
async function loadPerformance(){
  const key=pfKey(),r=pfRange(),seq=++pfSeq;PF.inflight=key;PF.err='';
  const res=await state.sb.rpc('branch_metrics',{p_currency:state.currency,p_from:r.from,p_to:r.to});
  if(seq!==pfSeq)return;                                     // a newer request (currency/period changed) owns the screen
  PF.inflight=null;PF.key=key;
  if(res.error){PF.rows=null;PF.errKey=key;PF.err=isSchemaErr(res.error)?'Run the latest supabase/schema.sql in Supabase to enable branch performance.':res.error.message}
  else{PF.rows=res.data||[];PF.errKey=null}
  PF.officers=null;PF.officersKey='';
  if(state.view==='performance')performanceView($('content'));
  if(PF.open&&PF.rows)loadOfficers(PF.open);
}
async function loadOfficers(id){
  const key=pfKey()+'|'+id;if(PF.officersKey===key&&PF.officers)return;
  PF.open=id;PF.officersLoading=true;PF.officers=null;paintPerformance();
  const r=pfRange(),res=await state.sb.rpc('officer_metrics',{p_branch:id,p_currency:state.currency,p_from:r.from,p_to:r.to});
  if(PF.open!==id)return;
  PF.officersLoading=false;PF.officersKey=key;PF.officers=res.error?[]:(res.data||[]);
  if(res.error)toast(res.error.message);
  paintPerformance();
}
function paintPerformance(){if(state.view==='performance')performanceView($('content'))}

/* ----- exports ----- */
const PF_COLS=[
  {h:'Rank',t:'text',v:r=>String(r._rank||'')},{h:'Branch',t:'text',v:r=>r.name},{h:'Code',t:'text',v:r=>r.code},
  {h:'Borrowers',t:'text',v:r=>String(r.borrowers)},{h:'KYC verified %',t:'text',v:r=>pct1(r.kycPct)},{h:'Staff',t:'text',v:r=>String(r.officers)},
  {h:'Active loans',t:'text',v:r=>String(r.active_loans)},{h:'Loans per officer',t:'text',v:r=>r.perOfficer==null?'':r.perOfficer.toFixed(1)},
  {h:'Disbursed',t:'money',v:r=>r.disbursed_minor,c:()=>state.currency},{h:'Average loan',t:'money',v:r=>r.avg||0,c:()=>state.currency},
  {h:'Outstanding',t:'money',v:r=>r.outstanding_minor,c:()=>state.currency},{h:'Collected',t:'money',v:r=>r.collected_minor,c:()=>state.currency},
  {h:'Collection rate',t:'text',v:r=>pct1(r.rate)},{h:'PAR30',t:'text',v:r=>pct1(r.par)},
  {h:'Penalties outstanding',t:'money',v:r=>r.penalties_minor,c:()=>state.currency}];
const OF_COLS=[
  {h:'Name',t:'text',v:r=>r.name},{h:'Role',t:'text',v:r=>r.role||'—'},{h:'Loans created',t:'text',v:r=>String(r.loans_created)},
  {h:'Requested',t:'money',v:r=>r.requested_minor,c:()=>state.currency},{h:'Disbursed',t:'money',v:r=>r.disbursed_minor,c:()=>state.currency},
  {h:'Open loans',t:'text',v:r=>String(r.open_loans)},{h:'Outstanding',t:'money',v:r=>r.outstanding_minor,c:()=>state.currency},
  {h:'PAR30',t:'text',v:r=>pct1(Number(r.outstanding_minor)>0?Number(r.par30_minor)*100/Number(r.outstanding_minor):0)},{h:'KYC verified',t:'text',v:r=>String(r.kyc_verified)}];
const pfPeriodText=()=>{const r=pfRange();return r.from||r.to?`${r.from||'start'} to ${r.to||'today'}`:'all time'};
EXPORTS.performance=()=>({cols:PF_COLS,rows:pfRanked(PF.rows||[],PF.rank).map((r,i)=>({...r,_rank:i+1})),subtitle:`${state.currency}, ${pfPeriodText()}, ranked by ${PF_RANKS[PF.rank].l}`});
EXPORTS['officer-performance']=()=>({cols:OF_COLS,rows:PF.officers||[],subtitle:`${(PF.rows||[]).find(b=>b.branch_id===PF.open)?.name||'Branch'}, ${state.currency}, ${pfPeriodText()}`});

/* ----- view ----- */
function pfSetPreset(v){PF.err='';PF.preset=v;PF.rows=null;PF.officers=null;PF.officersKey='';paintPerformance()}
function pfSetDate(k,v){PF.err='';PF[k]=v;PF.rows=null;PF.officers=null;PF.officersKey='';paintPerformance()}
function pfSetRank(v){PF.rank=v;paintPerformance()}
function pfToggleOfficers(id){if(PF.open===id){PF.open=null;PF.officers=null;paintPerformance()}else loadOfficers(id)}

function pfBars(ranked){
  const k=PF.rank,vals=ranked.map(d=>pfValue(d,k)),max=Math.max(1,...vals.map(v=>v==null?0:v));
  const fmt=(d,v)=>v==null?'—':k==='rate'||k==='par'||k==='kyc'?pct1(v):k==='active'?String(v):mc(v,state.currency);
  return `<ul class="pf-bars" aria-label="${esc(PF_RANKS[k].l)} by branch">${ranked.map((d,i)=>{const v=vals[i];return `<li><span class="pf-name">${esc(d.name)}</span><span class="pf-track"><i style="width:${v==null?0:Math.max(2,Math.round(v*100/max))}%"></i></span><span class="pf-val">${esc(fmt(d,v))}</span></li>`}).join('')}</ul>`;
}
function performanceView(c){
  if(!canSeePerformance()){c.innerHTML='<div class="card panel"><div class="empty">Branch performance is available to administrators and branch managers with Reports access.</div></div>';return}
  if(PF.key!==pfKey()&&PF.inflight!==pfKey()&&PF.errKey!==pfKey())loadPerformance();
  const ready=PF.rows&&PF.key===pfKey();
  const presets=[['all','All time'],['month','This month'],['30','Last 30 days'],['year','This year'],['custom','Custom']];
  if(PF.errKey&&PF.errKey!==pfKey())PF.err='';
  const controls=`<div class="toolbar"><div><h3 style="margin:0">Branch performance</h3>${sub('Compare branches in one currency. Ratios are computed from the figures shown.')}</div><div class="tb">${curSwitch()}<select class="cursel" aria-label="Period" onchange="pfSetPreset(this.value)">${presets.map(([v,l])=>`<option value="${v}"${PF.preset===v?' selected':''}>${l}</option>`).join('')}</select>${PF.preset==='custom'?`<label class="dr"><input type="date" aria-label="From date" value="${esc(PF.from)}" onchange="pfSetDate('from',this.value)"> – <input type="date" aria-label="To date" value="${esc(PF.to)}" onchange="pfSetDate('to',this.value)"></label>`:''}<select class="cursel" aria-label="Rank by" onchange="pfSetRank(this.value)">${Object.entries(PF_RANKS).map(([k,o])=>`<option value="${k}"${PF.rank===k?' selected':''}>Rank by ${esc(o.l)}</option>`).join('')}</select>${ready&&PF.rows.length?exb('performance'):''}</div></div>`;
  if(PF.err){c.innerHTML=`<div class="card panel">${controls}<div class="alert bad" style="margin-top:14px">${esc(PF.err)}</div></div>`;return}
  if(!ready){c.innerHTML=`<div class="card panel">${controls}<div class="empty">Loading branch figures…</div></div>`;return}
  if(!PF.rows.length){c.innerHTML=`<div class="card panel">${controls}<div class="empty">No branches to compare yet.</div></div>`;return}
  const ranked=pfRanked(PF.rows,PF.rank),tot=pfTotals(PF.rows),cur=state.currency;
  const kpi=(l,v,s='')=>`<div class="metric"><small>${esc(l)}</small><div class="value">${v}</div>${s?`<div class="sub">${s}</div>`:''}</div>`;
  const strip=`<div class="pf-kpis">${kpi('Outstanding principal',mc(tot.outstanding_minor,cur),`${tot.active_loans} active loans`)}${kpi('Disbursed',mc(tot.disbursed_minor,cur),`${tot.disbursed_count} loans`)}${kpi('Collection rate',pct1(tot.rate),'paid vs due in period')}${kpi('PAR30',pct1(tot.par),'outstanding 30+ days late')}</div>`;
  const row=(d,i)=>`<tr><td class="num">${i+1}</td><td><b>${esc(d.name)}</b><div style="font-size:10px;color:var(--muted)">${esc(d.code)}${d.status==='Closed'?' · closed':''}</div></td><td class="num">${d.borrowers}<div style="font-size:10px;color:var(--muted)">${pct1(d.kycPct)} verified</div></td><td class="num">${d.active_loans}<div style="font-size:10px;color:var(--muted)">${d.perOfficer==null?'—':d.perOfficer.toFixed(1)} / officer</div></td><td class="num">${mc(d.disbursed_minor,cur)}<div style="font-size:10px;color:var(--muted)">avg ${d.avg==null?'—':mc(d.avg,cur)}</div></td><td class="num">${mc(d.outstanding_minor,cur)}</td><td class="num">${mc(d.collected_minor,cur)}</td><td>${pfRateBadge(d.rate)}</td><td>${pfParBadge(d.par)}</td><td class="num">${mc(d.penalties_minor,cur)}</td><td><button class="btn mini${PF.open===d.branch_id?' primary':''}" onclick="pfToggleOfficers('${d.branch_id}')">${PF.open===d.branch_id?'Hide':'Officers'}</button></td></tr>`;
  const table=`<div class="table-wrap" style="margin-top:14px"><table class="table"><thead><tr><th class="num">#</th><th>Branch</th><th class="num">Borrowers</th><th class="num">Active loans</th><th class="num">Disbursed</th><th class="num">Outstanding</th><th class="num">Collected</th><th>Collection</th><th>PAR30</th><th class="num">Penalties</th><th></th></tr></thead><tbody>${ranked.map(row).join('')}</tbody></table></div>`;
  let officers='';
  if(PF.open){
    const b=PF.rows.find(x=>x.branch_id===PF.open);
    const body=PF.officersLoading||!PF.officers?'<div class="empty">Loading…</div>':PF.officers.length?`<div class="table-wrap" style="margin-top:10px"><table class="table"><thead><tr><th>Name</th><th>Role</th><th class="num">Loans created</th><th class="num">Requested</th><th class="num">Disbursed</th><th class="num">Open loans</th><th class="num">Outstanding</th><th>PAR30</th><th class="num">KYC verified</th></tr></thead><tbody>${PF.officers.map(o=>{const par=Number(o.outstanding_minor)>0?Number(o.par30_minor)*100/Number(o.outstanding_minor):0;return `<tr><td><b>${esc(o.name)}</b></td><td>${esc(o.role||'—')}</td><td class="num">${o.loans_created}</td><td class="num">${mc(o.requested_minor,cur)}</td><td class="num">${mc(o.disbursed_minor,cur)}</td><td class="num">${o.open_loans}</td><td class="num">${mc(o.outstanding_minor,cur)}</td><td>${pfParBadge(par)}</td><td class="num">${o.kyc_verified}</td></tr>`}).join('')}</tbody></table></div>`:'<div class="empty">No staff in this branch yet.</div>';
    officers=`<div class="card panel" style="margin-top:17px"><div class="toolbar"><div><h3 style="margin:0">${esc(b?.name||'Branch')} · officers</h3>${sub('Loans are credited to the person who created them. Loans made before 1.8.1 appear as "Not recorded".')}</div><div class="tb">${PF.officers&&PF.officers.length?exb('officer-performance'):''}</div></div>${body}</div>`;
  }
  c.innerHTML=`${reconBanner()}<div class="card panel">${controls}${strip}${table}</div><div class="card panel" style="margin-top:17px"><h3 style="margin:0">Comparison</h3>${sub('Ranked by '+esc(PF_RANKS[PF.rank].l)+'. '+(PF_RANKS[PF.rank].hi?'Higher is better.':'Lower is better.'))}${pfBars(ranked)}</div>${targetsCard()}${officers}`;
}
