/* Core: state, permissions, navigation, UI primitives */

const NAV_ICONS={"performance": "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M4 20V10\"/><path d=\"M10 20V4\"/><path d=\"M16 20v-7\"/><path d=\"M22 20H2\"/></svg>", "branches": "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M3 21h18\"/><path d=\"M5 21V8l7-5 7 5v13\"/><path d=\"M9 12h2M13 12h2M9 16h2M13 16h2\"/></svg>", "dashboard": "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><rect width=\"7\" height=\"9\" x=\"3\" y=\"3\" rx=\"1\"/><rect width=\"7\" height=\"5\" x=\"14\" y=\"3\" rx=\"1\"/><rect width=\"7\" height=\"9\" x=\"14\" y=\"12\" rx=\"1\"/><rect width=\"7\" height=\"5\" x=\"3\" y=\"16\" rx=\"1\"/></svg>", "borrowers": "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\"/><circle cx=\"9\" cy=\"7\" r=\"4\"/><path d=\"M22 21v-2a4 4 0 0 0-3-3.87\"/><path d=\"M16 3.13a4 4 0 0 1 0 7.75\"/></svg>", "loans": "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><rect width=\"20\" height=\"12\" x=\"2\" y=\"6\" rx=\"2\"/><circle cx=\"12\" cy=\"12\" r=\"2\"/><path d=\"M6 12h.01M18 12h.01\"/></svg>", "repayments": "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M17 7 7 17\"/><path d=\"M17 17H7V7\"/></svg>", "ledger": "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z\"/><path d=\"M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z\"/></svg>", "reports": "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M3 3v18h18\"/><path d=\"M18 17V9\"/><path d=\"M13 17V5\"/><path d=\"M8 17v-3\"/></svg>", "capital": "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M3 22h18\"/><path d=\"M6 18v-7\"/><path d=\"M10 18v-7\"/><path d=\"M14 18v-7\"/><path d=\"M18 18v-7\"/><path d=\"m12 2 8 5H4z\"/></svg>", "audit": "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z\"/><path d=\"m9 12 2 2 4-4\"/></svg>", "settings": "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M20 7h-9\"/><path d=\"M14 17H5\"/><circle cx=\"17\" cy=\"17\" r=\"3\"/><circle cx=\"7\" cy=\"7\" r=\"3\"/></svg>"};

const esc=v=>String(v??'').replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]));

const badge=s=>`<span class="badge ${s==='Active'?'b-active':s==='Pending Approval'?'b-pending':s==='Defaulted'?'b-default':s==='Completed'?'b-complete':s==='Restructured'?'b-restructured':'b-written'}">${esc(s)}</span>`;

/* ---------- MarkLend 1.7 core: state, permissions, navigation, UI primitives ---------- */
const $=id=>document.getElementById(id);
const ls={
  get:k=>{try{return localStorage.getItem(k)}catch(_){return null}},
  set:(k,v)=>{try{localStorage.setItem(k,v)}catch(_){}},
  del:k=>{try{localStorage.removeItem(k)}catch(_){}}
};
let loaded=false;
const CURRENCIES=['MWK','USD','ZAR'];
const OPEN_STATUSES=['Active','Defaulted','Restructured'];
NAV_ICONS.invoices='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6"/><path d="M9 13h8M9 17h8"/></svg>';
NAV_ICONS.collections='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';

const state={
  view:'dashboard',sb:null,config:{},user:null,userProfile:null,permissions:{},
  currency:CURRENCIES.includes(ls.get('ml-cur'))?ls.get('ml-cur'):'MWK',
  borrowers:[],loans:[],repayments:[],metrics:null,series:null,
  branches:[],branchCounts:null,branchTeam:[],overdueList:[],overdue:{},pendingCount:0,nextDue:[],schemaErr:false,
  pg:{},staff:[],auditLogs:[],penaltyRule:null
};

/* A staff permission row looks like {section, can_view, can_create, can_edit, can_approve}. */
function can(section,action='view'){
  const role=state.userProfile?.role;
  if(role==='Admin')return true;
  if(role==='Borrower')return section==='dashboard'||section==='settings';
  const p=state.permissions?.[section];
  return !!p&&p['can_'+action]===true;
}

const NAV=[['dashboard',NAV_ICONS.dashboard,'Dashboard'],['branches',NAV_ICONS.branches,'Branches'],['performance',NAV_ICONS.performance,'Performance'],['borrowers',NAV_ICONS.borrowers,'Borrowers'],['loans',NAV_ICONS.loans,'Loans'],['invoices',NAV_ICONS.invoices,'Invoices'],['collections',NAV_ICONS.collections,'Collections'],['repayments',NAV_ICONS.repayments,'Repayments'],['ledger',NAV_ICONS.ledger,'Ledger'],['reports',NAV_ICONS.reports,'Reports'],['capital',NAV_ICONS.capital,'Lending capital'],['audit',NAV_ICONS.audit,'Audit Logs'],['settings',NAV_ICONS.settings,'Settings']];
const SECTION_PERMS={dashboard:'dashboard',borrowers:'borrowers',loans:'loans',collections:'loans',invoices:'loans',repayments:'repayments',ledger:'ledger',reports:'reports',settings:'settings',capital:'capital',staff:'staff',audit:'reports'};
const SUBTITLES={dashboard:'Portfolio overview and collections',branches:'Branch offices, managers and their teams',performance:'Compare branches and officers',borrowers:'Manage borrower profiles, KYC and risk',loans:'Originate, monitor and service loans',collections:'Overdue loans, penalties and follow-up',invoices:'Invoices outside a loan, saved with a number or just a PDF',repayments:'Record repayments using the configured waterfall',ledger:'Immutable financial activity and audit trail',reports:'Portfolio performance and delinquency reporting',capital:'Manage lending funds, withdrawals and adjustments',audit:'Administrator-only security and activity history',settings:'Supabase connection and application settings'};

/* ---------- formatting ---------- */
const fmtMinor=m=>(Number(m||0)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const today=()=>new Date().toISOString().slice(0,10);
const fdt=d=>d?String(d).slice(0,10):'—';
const fts=d=>d?String(d).slice(0,19).replace('T',' '):'—';
/* Money cell: right-aligned by .num, small currency prefix, raw value kept for exports. */
function mc(minor,cur){const c=cur||state.currency;return `<span class="mny" data-v="${(Number(minor||0)/100).toFixed(2)}"><small>${esc(c)}</small>${fmtMinor(minor)}</span>`}
const money=(major,cur)=>mc(Math.round(Number(major||0)*100),cur);
const moneyText=(minor,cur)=>`${cur||state.currency} ${fmtMinor(minor)}`;

/* ---------- toasts: stacked, dismissible, optional Undo ---------- */
function toast(msg,o={}){
  let h=$('toasts');
  if(!h){h=document.createElement('div');h.id='toasts';h.setAttribute('aria-live','polite');document.body.append(h)}
  while(h.children.length>=4)h.firstChild.remove();
  const t=document.createElement('div');t.className='toast';t.innerHTML=`<span>${esc(msg)}</span>`;
  let tm;
  const kill=()=>{clearTimeout(tm);t.classList.add('out');setTimeout(()=>t.remove(),180)};
  const arm=()=>{tm=setTimeout(kill,o.undo||o.action?8000:4500)};
  if(o.undo){const b=document.createElement('button');b.textContent='Undo';b.onclick=async()=>{kill();try{await o.undo();toast('Change undone')}catch(e){toast('Could not undo: '+e.message)}};t.append(b)}
  if(o.action){const b=document.createElement('button');b.textContent=o.action.label;b.onclick=()=>{kill();o.action.fn()};t.append(b)}
  const x=document.createElement('button');x.className='x';x.textContent='×';x.setAttribute('aria-label','Dismiss');x.onclick=kill;t.append(x);
  t.onmouseenter=()=>clearTimeout(tm);t.onmouseleave=arm;h.append(t);arm();
}

/* ---------- modal ---------- */
function modal(html,o={}){const b=$('modalBox');b.className='modal-box'+(o.wide?' wide':'');b.innerHTML=html;$('modal').classList.add('show')}
function closeModal(){$('modal').classList.remove('show')}

/* ---------- navigation ---------- */
function renderNav(){
  const pend=can('loans','approve')?state.pendingCount:0,od=can('loans')?state.overdueList.length:0;
  const visible=([id])=>id==='performance'?canSeePerformance():id==='branches'?['Admin','Branch Manager','Loan Officer'].includes(state.userProfile?.role):id==='settings'?(can('settings')||can('capital')||can('staff')):id==='audit'?state.userProfile?.role==='Admin':id==='collections'?can('loans'):id==='invoices'?(can('loans')&&state.userProfile?.role!=='Borrower'):can(SECTION_PERMS[id]||id);
  $('nav').innerHTML=NAV.filter(visible).map(([id,ico,label])=>{
    let badgeHtml='';
    if(id==='loans'&&pend)badgeHtml=`<span class="nbadge" data-n="${pend}">Review (${pend})</span>`;
    if(id==='collections'&&od)badgeHtml=`<span class="nbadge warn" data-n="${od}">${od}</span>`;
    return `<button class="${state.view===id?'active':''}" title="${label}" onclick="go('${id}')"><span class="ico">${ico}</span><span class="lbl">${label}</span>${badgeHtml}</button>`;
  }).join('');
}
function go(v){
  if(v==='audit'&&state.userProfile?.role!=='Admin')return toast('Only administrators can view audit logs.');
  state.view=v;renderNav();
  $('title').textContent=NAV.find(x=>x[0]===v)?.[2]||'MarkLend';
  $('subtitle').textContent=SUBTITLES[v]||'';
  render();
}
function render(){
  const c=$('content');
  if(!loaded&&state.view!=='settings'){c.innerHTML=skel(state.view);return}
  const V={dashboard:dashboardWithAnalysis,branches:branchesView,performance:performanceView,borrowers,loans,invoices:invoicesView,collections,repayments,ledger,reports,capital,audit:auditLogs,settings};
  (V[state.view]||dashboard)(c);
  requestAnimationFrame(fitMetrics);
}
/* Very large amounts shrink a little instead of overflowing their card. */
function fitMetrics(){
  document.querySelectorAll('.metric .value').forEach(el=>{
    el.style.fontSize='';let s=parseFloat(getComputedStyle(el).fontSize);
    while(el.scrollWidth>el.clientWidth+1&&s>13){s-=1;el.style.fontSize=s+'px'}
  });
}

/* ---------- skeleton loading ---------- */
function skelRows(n=8){return '<div class="sk-row"><div class="sk"></div><div class="sk"></div><div class="sk"></div><div class="sk"></div></div>'.repeat(n)}
function skel(v){
  const card='<div class="card metric"><div class="sk" style="width:55%;height:11px"></div><div class="sk" style="width:75%;height:26px;margin-top:14px"></div><div class="sk" style="width:40%;height:10px;margin-top:12px"></div></div>';
  const cards=['dashboard','reports','capital'].includes(v)?`<div class="cards">${card.repeat(4)}</div><div style="height:17px"></div>`:'';
  return `${cards}<div class="card panel"><div class="sk" style="width:180px;height:16px;margin-bottom:16px"></div>${skelRows(8)}</div>`;
}

/* ---------- currency switcher ---------- */
function curSwitch(){return `<select class="cursel" aria-label="Currency" onchange="setCurrency(this.value)">${CURRENCIES.map(c=>`<option${c===state.currency?' selected':''}>${c}</option>`).join('')}</select>`}
async function setCurrency(c){
  if(!CURRENCIES.includes(c))return;
  state.currency=c;ls.set('ml-cur',c);loaded=false;render();
  await loadMetrics();loaded=true;render();
}

/* ---------- trend arrows + month-over-month chart (server series, minor units) ---------- */
const TREND_FIELD={cap:'capital_net',req:'requested',dis:'disbursed',col:'interest'};
const TREND_LABEL={cap:'net capital flow',req:'requests raised',dis:'principal disbursed',col:'interest collected'};
function trend(k){
  const s=state.series;if(!s||s.length<2)return '';
  const f=TREND_FIELD[k],p=Number(s[s.length-2][f]||0),c=Number(s[s.length-1][f]||0);
  let cl='flat',a='▬',t='no change';
  if(c!==p){cl=c>p?'up':'down';a=c>p?'▲':'▼';t=p?Math.abs((c-p)/Math.abs(p)*100).toFixed(0)+'%':'new'}
  return `<div class="trend ${cl}" title="Monthly ${TREND_LABEL[k]}, this month vs last month (${state.currency})">${a} ${t} <span>vs last month</span></div>`;
}
function momChart(){
  const s=state.series;if(!s||!s.length)return '';
  const W=640,H=210,L=50,B=26,T=12,R=12,n=s.length;
  const max=Math.max(1,...s.map(m=>Math.max(Number(m.disbursed||0),Number(m.repaid||0))));
  const x=i=>L+(n>1?i*(W-L-R)/(n-1):0),y=v=>T+(H-T-B)*(1-v/max);
  const P=f=>s.map((m,i)=>`${x(i).toFixed(1)},${y(Number(m[f]||0)).toFixed(1)}`).join(' ');
  const D=(f,c,l)=>s.map((m,i)=>`<circle class="${c}" cx="${x(i).toFixed(1)}" cy="${y(Number(m[f]||0)).toFixed(1)}" r="3.5"><title>${l} ${m.month}: ${state.currency} ${fmtMinor(m[f])}</title></circle>`).join('');
  const K=v=>{v/=100;return v>=1e6?(v/1e6).toFixed(1)+'M':v>=1e3?Math.round(v/1e3)+'K':Math.round(v)};
  return `<div class="card panel" style="margin-top:17px"><div class="toolbar"><div><h3 style="margin:0">Month over month</h3><span style="font-size:11px;color:var(--muted)">Disbursed vs repaid · ${state.currency} · last ${n} months</span></div><div class="legend"><i class="l1"></i>Disbursed<i class="l2"></i>Repaid</div></div><svg class="mom" viewBox="0 0 ${W} ${H}" role="img" aria-label="Month over month disbursed versus repaid">${[0,.25,.5,.75,1].map(f=>`<line class="g" x1="${L}" x2="${W-R}" y1="${y(max*f)}" y2="${y(max*f)}"/><text x="${L-6}" y="${y(max*f)+3}" text-anchor="end">${K(max*f)}</text>`).join('')}${s.map((m,i)=>`<text x="${x(i)}" y="${H-8}" text-anchor="middle">${new Date(m.month+'-01T00:00').toLocaleString('en',{month:'short'})}</text>`).join('')}<polyline class="p1" points="${P('disbursed')}"/><polyline class="p2" points="${P('repaid')}"/>${D('disbursed','c1','Disbursed')}${D('repaid','c2','Repaid')}</svg></div>`;
}

/* ---------- theme + sidebar ---------- */
function applyUI(){
  const th=ls.get('ml-theme')||(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');
  document.documentElement.dataset.theme=th;
  document.querySelector('.app').classList.toggle('collapsed',ls.get('ml-side')==='1');
  const b=$('themeBtn');if(b)b.textContent=th==='dark'?'☀ Light':'☾ Dark';
}
function toggleTheme(){ls.set('ml-theme',document.documentElement.dataset.theme==='dark'?'light':'dark');applyUI()}
function toggleSide(){ls.set('ml-side',document.querySelector('.app').classList.contains('collapsed')?'0':'1');applyUI()}

