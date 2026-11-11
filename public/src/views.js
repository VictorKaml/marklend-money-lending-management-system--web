/* Screens */

/* ---------- MarkLend 1.7 views ---------- */
const sub=t=>`<span style="font-size:11px;color:var(--muted)">${t}</span>`;
const schemaBanner=()=>state.schemaErr?'<div class="alert bad" style="margin-bottom:14px"><b>Database update required.</b> Some 1.7 features need the latest <code>supabase/schema.sql</code> to be run in the Supabase SQL editor (it is safe to re-run). Until then, figures may be incomplete.</div>':'';
function sumBy(rows,f){const o={};for(const r of rows){const c=r.currency||'MWK';o[c]=(o[c]||0)+Number(f(r)||0)}return o}
const moneyMap=(o,empty='MWK')=>Object.keys(o).length?Object.entries(o).map(([c,v])=>mc(v,c)).join('<br>'):mc(0,empty);

/* ---------- dashboard ---------- */
function dashboard(c){
  if(state.userProfile?.role==='Borrower')return borrowerDashboard(c);
  const m=state.metrics||{},od=state.overdueList.filter(o=>o.currency===state.currency);
  const odSum=od.reduce((a,o)=>a+Number(o.overdue_minor||0),0);
  c.innerHTML=`${schemaBanner()}<div class="toolbar"><span style="font-size:12px;color:var(--muted)">Portfolio figures in</span>${curSwitch()}</div>${od.length?`<div class="alert warn" style="margin-bottom:14px"><b>${od.length} overdue loan${od.length>1?'s':''}</b> · ${mc(odSum,state.currency)} past due. <a href="#" class="lnk" onclick="go('collections');return false">Open collections →</a></div>`:''}<div class="cards"><div class="card metric capital-card"><div class="label">Available Lending Capital</div><div class="value green">${money(m.available_lending_capital)}</div><div class="foot">Capital currently available to approve and disburse</div>${trend('cap')}</div><div class="card metric"><div class="label">Pending Loan Requests</div><div class="value">${money(m.pending_principal)}</div><div class="foot">Principal awaiting approval</div>${trend('req')}</div><div class="card metric"><div class="label">Active Portfolio</div><div class="value">${money(m.active_portfolio)}</div><div class="foot">Outstanding principal</div>${trend('dis')}</div><div class="card metric"><div class="label">Collections</div><div class="value green">${money(m.collected_interest)}</div><div class="foot">Interest collected to date</div>${trend('col')}</div></div><div class="section-grid"><div class="card panel"><div class="toolbar"><div><h3 style="margin:0">Loan portfolio statistics</h3>${sub('Current loan lifecycle distribution')}</div><span class="badge b-active">Live</span></div>${loanStatisticsChart()}</div><div class="card panel"><h3>Capital position</h3><div class="capital-breakdown"><div><span>Available to lend</span><b>${money(m.available_lending_capital)}</b></div><div><span>Active principal</span><b>${money(m.active_portfolio)}</b></div><div><span>Pending requests</span><b>${money(m.pending_principal)}</b></div><div><span>Total capital funded</span><b>${money(m.total_capital_funded)}</b></div></div>${can('capital')?'<button class="btn primary" onclick="go(\'capital\')">Manage capital</button>':''}</div></div>${momChart()}<div class="card panel" style="margin-top:17px"><div class="toolbar"><div><h3 style="margin:0">Recent loans</h3>${sub('New loans remain Pending Approval until authorized')}</div>${can('loans','create')?'<button class="btn primary" onclick="openLoanModal()">+ New loan</button>':''}</div>${loanTable(state.loans.slice(0,8))}</div>`;
}
function loanStatisticsChart(){
  const m=state.metrics||{},rows=[['Pending Approval',m.pending_count],['Active',m.active_count],['Defaulted',m.defaulted_count],['Completed',m.completed_count]].map(([l,v])=>[l,Number(v||0)]),max=Math.max(1,...rows.map(x=>x[1]));
  return `<div class="stat-chart">${rows.map(([l,v])=>`<div class="stat-row"><div class="stat-head"><span>${l}</span><b>${v}</b></div><div class="stat-track"><span style="width:${Math.max(3,v/max*100)}%"></span></div></div>`).join('')}</div><div class="stat-footer"><span>Total loans <b>${Number(m.total_loans||0)}</b></span><span>Default rate <b>${Number(m.default_rate||0).toFixed(1)}%</b></span><span>PAR30 <b>${Number(m.par30||0).toFixed(1)}%</b></span><span>PAR90 <b>${Number(m.par90||0).toFixed(1)}%</b></span></div>`;
}

/* ---------- borrower portal ---------- */
function borrowerDashboard(c){
  const loans=state.loans||[],reps=state.repayments||[],due=state.nextDue||[];
  const out=sumBy(loans.filter(x=>OPEN_STATUSES.includes(x.status)),x=>x.outstanding_principal),paid=sumBy(reps,x=>x.amount_minor);
  const dueCols=[{h:'Loan',t:'html',v:r=>lnk(r.loan_id,r.loan_number),x:r=>r.loan_number},{h:'Due date',t:'text',v:r=>fdt(r.due_date)},{h:'Amount due',t:'money',v:r=>r.amount_due_minor,c:r=>r.currency},{h:'',t:'html',v:r=>r.is_overdue?'<span class="badge b-overdue">Overdue</span>':'<span class="badge b-active">Upcoming</span>'}];
  const repCols=[{h:'Date',t:'text',v:r=>fdt(r.payment_date)},{h:'Loan',t:'text',v:r=>r.loan_number||''},{h:'Amount',t:'money',v:r=>r.amount_minor,c:r=>r.currency}];
  c.innerHTML=`<div class="cards"><div class="card metric"><div class="label">My loans</div><div class="value">${loans.length}</div><div class="foot">Loans linked to your borrower account</div></div><div class="card metric"><div class="label">Outstanding balance</div><div class="value" style="font-size:19px">${moneyMap(out)}</div><div class="foot">Current outstanding principal</div></div><div class="card metric"><div class="label">Repayments</div><div class="value green" style="font-size:19px">${moneyMap(paid)}</div><div class="foot">Payments recorded on your account</div></div><div class="card metric"><div class="label">KYC status</div><div class="value" style="font-size:20px">${esc(state.borrowers[0]?.kyc_status||'Pending')}</div><div class="foot">Verification status</div></div></div><div class="card panel" style="margin-top:17px"><div class="toolbar"><div><h3 style="margin:0">Next payments</h3>${sub('Your next unpaid instalment on each active loan')}</div><button class="btn" onclick="openStatement()">Download statement (PDF)</button></div>${tableHTML(dueCols,due,{empty:'No payments are due right now.'})}</div><div class="card panel" style="margin-top:17px"><h3>My loan account</h3>${loanTable(loans.slice(0,20))}</div><div class="card panel" style="margin-top:17px"><h3>My recent repayments</h3>${tableHTML(repCols,reps.slice(0,20),{empty:'No repayments recorded yet.'})}</div>`;
}

/* ---------- paged list screens ---------- */
function listCard(v,title,subtitle,actions=''){
  return `<div class="card panel"><div class="toolbar"><div><h3 style="margin:0">${title}</h3>${sub(subtitle)}</div><div class="tb">${exb(PGDEF[v].export)}${actions}</div></div>${pgBar(v)}<div id="pg-${v}"></div></div>`;
}
function borrowers(c){c.innerHTML=listCard('borrowers','Borrower directory','Profiles, KYC status and risk',can('borrowers','create')?'<button class="btn primary" onclick="openBorrowerModal()">+ Add borrower</button>':'');pgView('borrowers')}
function loans(c){c.innerHTML=listCard('loans','Loan portfolio','Lifecycle, balances and maturity',can('loans','create')?'<button class="btn primary" onclick="openLoanModal()">+ New loan</button>':'');pgView('loans')}
function repayments(c){c.innerHTML=listCard('repayments','Repayments','Waterfall: fees → penalties → interest → principal',can('repayments','create')?'<button class="btn primary" onclick="openRepaymentModal()">+ Record repayment</button>':'');pgView('repayments')}
function ledger(c){c.innerHTML=listCard('ledger','Immutable ledger','Every disbursement, repayment and capital movement is recorded as an entry.');pgView('ledger')}
function auditLogs(c){
  if(state.userProfile?.role!=='Admin'){c.innerHTML='<div class="empty">Administrator access required.</div>';return}
  c.innerHTML=listCard('audit','Audit logs','Security, authentication and lending activity recorded by MarkLend.','<button class="btn" onclick="pgRefresh(\'audit\')">Refresh</button>');pgView('audit');
}
function capital(c){
  const m=state.metrics||{};
  c.innerHTML=`${schemaBanner()}<div class="toolbar"><span style="font-size:12px;color:var(--muted)">Capital pool in</span>${curSwitch()}</div><div class="cards"><div class="card metric capital-card"><div class="label">Available lending capital</div><div class="value green">${money(m.available_lending_capital)}</div><div class="foot">Funds currently available for approved disbursements</div></div><div class="card metric"><div class="label">Total funded</div><div class="value">${money(m.total_capital_funded)}</div><div class="foot">Capital introduced into the lending pool</div></div><div class="card metric"><div class="label">Active principal</div><div class="value">${money(m.active_portfolio)}</div><div class="foot">Outstanding principal in the portfolio</div></div><div class="card metric"><div class="label">Pending requests</div><div class="value">${money(m.pending_principal)}</div><div class="foot">Requests not yet disbursed</div></div></div><div class="card panel" style="margin-top:17px"><div class="toolbar"><div><h3 style="margin:0">Capital controls</h3>${sub('Every movement requires a unique reference and is recorded in the ledger.')}</div><div class="tb">${exb('capital-transactions')}${can('capital','create')?'<button class="btn primary" onclick="openCapitalModal()">+ Fund capital</button> <button class="btn" onclick="openCapitalOutModal()">Withdraw</button>':''}</div></div><div class="capital-safety"><div><b>Approval gate</b><span>Pending loans do not consume capital. Approval checks the live pool before disbursement.</span></div><div><b>Principal recycling</b><span>Principal repayments return to available lending capital automatically.</span></div><div><b>Audit protection</b><span>Funding and withdrawals use unique references and immutable ledger entries.</span></div></div>${pgBar('capital')}<div id="pg-capital"></div></div>`;
  pgView('capital');
}

/* ---------- collections ---------- */
const BUCKETS=[['1–30 days',1,30],['31–60 days',31,60],['61–90 days',61,90],['90+ days',91,1e9]];
const bucketOf=d=>BUCKETS.findIndex(b=>d>=b[1]&&d<=b[2]);
state.collB=-1;state.collQ='';
function collRows(){
  const q=state.collQ.trim().toLowerCase();
  return state.overdueList.filter(o=>o.currency===state.currency)
    .filter(o=>state.collB<0||bucketOf(o.days_late)===state.collB)
    .filter(o=>!q||[o.loan_number,o.borrower_name,o.phone].join(' ').toLowerCase().includes(q))
    .sort((a,b)=>b.days_late-a.days_late);
}
const COLL_COLS=[
  {h:'Loan',t:'html',v:o=>lnk(o.loan_id,o.loan_number),x:o=>o.loan_number},
  {h:'Borrower',t:'text',v:o=>o.borrower_name||''},
  {h:'Phone',t:'text',v:o=>o.phone||''},
  {h:'Days late',t:'html',v:o=>`<span class="badge b-d${bucketOf(o.days_late)+1}">${o.days_late}d</span>`,x:o=>String(o.days_late)},
  {h:'Overdue amount',t:'money',v:o=>o.overdue_minor,c:o=>o.currency},
  {h:'Penalty due',t:'money',v:o=>o.penalty_minor,c:o=>o.currency},
  {h:'Outstanding principal',t:'money',v:o=>o.outstanding_principal,c:o=>o.currency},
  {h:'Oldest due',t:'text',v:o=>fdt(o.oldest_due)},
  {h:'',t:'html',v:o=>`${can('repayments','create')?`<button class="btn mini primary" onclick="openRepaymentModal('${o.loan_id}')">Record payment</button> `:''}${typeof canExtendLoan==='function'&&canExtendLoan()?`<button class="btn mini" onclick="openExtendLoan('${o.loan_id}','list')">Extend</button> `:''}<button class="btn mini" onclick="openLoanDetail('${o.loan_id}')">Open</button>`}
];
EXPORTS.collections=()=>({cols:COLL_COLS,rows:collRows(),subtitle:`${state.currency} overdue loans`});
function collections(c){
  const all=state.overdueList.filter(o=>o.currency===state.currency);
  const agg=BUCKETS.map((b,i)=>{const r=all.filter(o=>bucketOf(o.days_late)===i);return{n:r.length,amt:r.reduce((a,o)=>a+Number(o.overdue_minor||0),0)}});
  const canPen=state.userProfile?.role==='Admin'||can('loans','edit');
  c.innerHTML=`${schemaBanner()}<div class="card panel"><div class="toolbar"><div><h3 style="margin:0">Overdue loans</h3>${sub('Loans with an unpaid instalment past its due date, oldest first')}</div><div class="tb">${curSwitch()}${exb('collections')}${canPen?'<button class="btn" onclick="confirmPenalties()">Apply penalty rules</button>':''}</div></div><div class="buckets"><button class="bucket${state.collB<0?' sel':''}" onclick="collBucket(-1)"><small>All overdue</small><b>${all.length}</b><span>${mc(all.reduce((a,o)=>a+Number(o.overdue_minor||0),0))}</span></button>${BUCKETS.map((b,i)=>`<button class="bucket b${i+1}${state.collB===i?' sel':''}" onclick="collBucket(${i})"><small>${b[0]}</small><b>${agg[i].n}</b><span>${mc(agg[i].amt)}</span></button>`).join('')}</div><div class="listbar"><input class="search" id="collQ" placeholder="Search loan, borrower or phone" value="${esc(state.collQ)}" oninput="collSearch(this.value)"></div><div id="collHost"></div></div>`;
  collPaint();
}
function collPaint(){
  const h=$('collHost');if(!h)return;const r=collRows();
  h.innerHTML=tableHTML(COLL_COLS,r.slice(0,300),{empty:state.overdueList.length?'No overdue loans match.':'No overdue loans. Everything is up to date. 🎉',rowCls:()=>'is-overdue'})+(r.length>300?`<div class="pager"><span>Showing the 300 most overdue of ${r.length}. Export for the full list.</span></div>`:'');
}
function collBucket(i){state.collB=i;render()}
function collSearch(v){state.collQ=v;clearTimeout(collSearch.t);collSearch.t=setTimeout(collPaint,150)}
async function loadPenaltyRule(){
  const {data,error}=await state.sb.from('penalty_rules').select('*').order('name').limit(20);
  const rules=error?[]:(data||[]);state.penaltyRule=rules.find(r=>r.active)||null;return state.penaltyRule;
}
async function confirmPenalties(){
  modal('<div class="modal-head"><h2>Apply penalty rules?</h2><button class="close" onclick="closeModal()">×</button></div><div id="penBody" class="cf-sub">Loading the active rule…</div>');
  const r=await loadPenaltyRule();
  if(!r){$('penBody').innerHTML=`<div class="alert bad">No active penalty rule is configured.${state.userProfile?.role==='Admin'?' Set one up under <a href="#" class="lnk" onclick="closeModal();go(\'settings\');return false">Settings → Penalty rule</a>.':' Ask an administrator to configure one.'}</div><div class="cf-act"><button class="btn" onclick="closeModal()">Close</button></div>`;return}
  const pc=b=>(Number(b||0)/100).toFixed(2).replace(/\.?0+$/,'')+'%';
  $('penBody').innerHTML=`<p class="cf-sub">Rule <b>${esc(r.name)}</b>: ${r.grace_days} grace day${r.grace_days===1?'':'s'}, ${pc(r.flat_rate_bps)} flat + ${pc(r.daily_rate_bps)} per day on the overdue principal and interest${r.cap_principal_bps!=null?`, capped at ${pc(r.cap_principal_bps)} of the instalment principal`:''}.</p><div class="cf-math"><div><span>Applies to</span><b>All overdue instalments, every currency</b></div><div><span>Existing penalties</span><b>Never reduced</b></div><div class="cf-rem"><span>Safe to re-run</span><b>Yes. The total is recalculated, not added</b></div></div><p class="cf-sub">Penalties are paid before interest and principal when a repayment is recorded.</p><div class="cf-act"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="penGo" onclick="runPenalties()">Apply now</button></div>`;
}
async function runPenalties(){
  const b=$('penGo');b.disabled=true;
  const {data,error}=await state.sb.rpc('accrue_penalties',{});
  if(error){b.disabled=false;return toast(error.message)}
  closeModal();await loadOverdue();renderNav();render();
  toast(data.schedules_updated?`Penalties updated on ${data.schedules_updated} instalment${data.schedules_updated>1?'s':''} (totals differ by currency; see Collections).`:'Penalties are already up to date.');
}

/* ---------- reports ---------- */
function reportRows(m){
  const p=x=>Number(x||0).toFixed(1)+'%',mn=v=>({html:money(v),text:moneyText(Math.round(Number(v||0)*100))});
  const R=[['Available lending capital',mn(m.available_lending_capital)],['Active portfolio',mn(m.active_portfolio)],['Pending principal',mn(m.pending_principal)],['Total capital funded',mn(m.total_capital_funded)],['Expected interest',mn(m.expected_interest)],['Collected interest',mn(m.collected_interest)]].map(([label,o])=>({label,...o}));
  const T=[['Default rate',p(m.default_rate)],['PAR 30 / 60 / 90',`${p(m.par30)} / ${p(m.par60)} / ${p(m.par90)}`],['Loans (total)',String(m.total_loans||0)],['Active / Pending / Defaulted / Completed',[m.active_count,m.pending_count,m.defaulted_count,m.completed_count].map(x=>x||0).join(' / ')]].map(([label,text])=>({label,text,html:esc(text)}));
  const od=state.overdueList.filter(o=>o.currency===state.currency);
  T.push({label:'Overdue loans',text:String(od.length),html:String(od.length)});
  return[...R,...T];
}
EXPORTS['management-report']=()=>({cols:[{h:'Metric',t:'text',v:r=>r.label},{h:'Value',t:'text',v:r=>r.text}],rows:reportRows(state.metrics||{}),subtitle:state.currency});
function reports(c){
  const rows=reportRows(state.metrics||{});
  c.innerHTML=`${schemaBanner()}<div class="card panel"><div class="toolbar"><div><h3 style="margin:0">Management report</h3>${sub(state.currency+' · as of '+today())}</div><div class="tb">${curSwitch()}${exb('management-report')}</div></div><div class="table-wrap"><table class="table"><thead><tr><th>Metric</th><th class="num">Value</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.label)}</td><td class="num">${r.html}</td></tr>`).join('')}</tbody></table></div></div>`;
}

/* ---------- settings (adds the penalty rule editor) ---------- */
function settings(c){
  const exp=state.config.sessionExpiresAt?new Date(state.config.sessionExpiresAt).toLocaleString():'—',started=state.config.sessionStartedAt?new Date(state.config.sessionStartedAt).toLocaleString():'—';
  const admin=state.userProfile?.role==='Admin';
  c.innerHTML=`${profileCard()}${can('staff')?`<div class="card panel" style="margin-top:17px"><div class="toolbar"><div><h3 style="margin:0">Staff access</h3>${sub('Create staff accounts and edit their operational section access.')}</div>${admin?'<button class="btn primary" onclick="openStaffModal()">+ Add staff</button>':''}</div>${staffTable()}</div>`:''}${admin?`<div class="card panel" style="margin-top:17px"><h3>Penalty rule</h3>${sub('Used by Collections → Apply penalty rules. One active rule applies to all overdue instalments.')}<div class="formgrid" style="margin-top:12px"><div class="field"><label>Rule name</label><input id="prName" value="Default"></div><div class="field"><label>Grace days</label><input id="prGrace" type="number" min="0" step="1" value="0"></div><div class="field"><label>Flat penalty (% of overdue amount)</label><input id="prFlat" type="number" min="0" step="0.01" value="0"></div><div class="field"><label>Daily penalty (% per day)</label><input id="prDaily" type="number" min="0" step="0.01" value="0"></div><div class="field"><label>Cap (% of instalment principal, blank = none)</label><input id="prCap" type="number" min="0" step="0.01"></div><div class="field"><label>Active</label><select id="prActive"><option value="1">Yes</option><option value="0">No</option></select></div></div><div style="margin-top:14px"><button class="btn primary" onclick="savePenaltyRule()">Save penalty rule</button></div></div>`:''}${isStaff()?invoiceSettingsCard():''}<div class="card panel" style="margin-top:17px"><h3>Current user session</h3><div class="session-grid"><div><small>User</small><b>${esc(state.user?.email||'—')}</b></div><div><small>Started</small><b>${esc(started)}</b></div><div><small>Token expires</small><b>${esc(exp)}</b></div><div><small>Remember me</small><b>${state.config.rememberSession===false?'No':'Yes'}</b></div><div><small>Role</small><b>${esc(state.userProfile?.role||'—')}</b></div><div><small>Branch</small><b>${esc(admin?'All branches':branchName(state.userProfile?.branch_id))}</b></div><div><small>Status</small><b class="green">Authenticated</b></div></div><div style="margin-top:14px"><button class="btn" onclick="lockApp()">Lock MarkLend</button> <button class="btn danger" onclick="signOutApp()">Sign out</button> ${admin?'<button class="btn primary" onclick="go(\'audit\')">View audit logs</button>':''}</div></div><div class="card panel" style="margin-top:17px"><h3>Supabase connection</h3><div class="alert info">The desktop app connects directly to your Supabase project using the public anon key. Financial mutations are protected by PostgreSQL RLS and transactional RPC functions.</div><div class="formgrid"><div class="field"><label>Supabase URL</label><input id="sbUrl" value="${esc(state.config.supabaseUrl||'')}"></div><div class="field"><label>Supabase anon key</label><input id="sbKey" type="password" value="${esc(state.config.supabaseAnonKey||'')}"></div></div><div style="margin-top:15px"><button class="btn primary" onclick="saveSettings()">Save & connect</button></div></div><div class="card panel" style="margin-top:17px"><h3>Application</h3>${applicationCard()}<div class="alert info" style="margin-top:12px">Administrator MFA/2FA is reserved for a future security update.</div></div>`;
  if(admin)loadPenaltyRule().then(r=>{if(!r||!$('prName'))return;$('prName').value=r.name;$('prGrace').value=r.grace_days;$('prFlat').value=r.flat_rate_bps/100;$('prDaily').value=r.daily_rate_bps/100;$('prCap').value=r.cap_principal_bps==null?'':r.cap_principal_bps/100;$('prActive').value=r.active?'1':'0'});
}
async function savePenaltyRule(){
  const bps=id=>Math.round(Number($(id).value||0)*100),capv=$('prCap').value.trim();
  const row={name:$('prName').value.trim()||'Default',grace_days:Math.max(0,parseInt($('prGrace').value||'0',10)),flat_rate_bps:bps('prFlat'),daily_rate_bps:bps('prDaily'),cap_principal_bps:capv===''?null:Math.round(Number(capv)*100),active:$('prActive').value==='1'};
  if([row.flat_rate_bps,row.daily_rate_bps].some(x=>x<0||x>100000))return toast('Penalty percentages must be between 0 and 1000.');
  const {data:ex}=await state.sb.from('penalty_rules').select('id,active').order('name').limit(50);
  const id=(ex?.find(r=>r.active)||ex?.[0])?.id;
  const r=id?await state.sb.from('penalty_rules').update(row).eq('id',id).execute():await state.sb.from('penalty_rules').insert(row).single();
  if(r.error)return toast('Could not save the rule: '+r.error.message);
  state.penaltyRule=null;toast('Penalty rule saved.');
}

