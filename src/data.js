/* Data layer: loading, paging, tables, export */

/* ---------- MarkLend 1.7 data layer ---------- */
SupaClient.prototype.query=async function(table,o={}){
  const {select='*',filters=[],or=null,order=null,from=0,to=null,count=false}=o;
  let p=`/rest/v1/${table}?select=${encodeURIComponent(select)}`;
  for(const [k,op,v] of filters)p+=`&${encodeURIComponent(k)}=${op}.${encodeURIComponent(v)}`;
  if(or)p+=`&or=${encodeURIComponent('('+or+')')}`;
  if(order&&order.length)p+=`&order=${order.map(([c,asc])=>`${c}.${asc?'asc':'desc'}`).join(',')}`;
  const h={...this.headers(),Prefer:count?'count=exact':'return=representation'};
  if(to!=null){h['Range-Unit']='items';h.Range=`${from}-${to}`}
  const r=await fetch(this.url+p,{headers:h});
  const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{}
  let total=null;const cr=r.headers.get('content-range'),m=cr&&cr.match(/\/(\d+|\*)$/);
  if(m&&m[1]!=='*')total=Number(m[1]);
  if(r.status===416)return{data:[],count:total??0};
  if(!r.ok)throw new Error(data?.message||data?.error||text||`HTTP ${r.status}`);
  return{data:data||[],count:total??(data||[]).length};
};
SupaClient.prototype.resendSignup=async function(email){
  const r=await fetch(this.url+'/auth/v1/resend',{method:'POST',headers:{apikey:this.key,'Content-Type':'application/json'},body:JSON.stringify({type:'signup',email})});
  if(!r.ok){let d={};try{d=await r.json()}catch{}throw new Error(d.msg||d.message||d.error_description||'Could not resend the email')}
};
/* Make a user-typed term safe inside a PostgREST or=() ilike filter. */
const likeTerm=q=>'*'+String(q||'').replace(/[,()*%"\\:]/g,' ').trim().replace(/\s+/g,' ')+'*';
const isSchemaErr=e=>/schema cache|could not find the function|does not exist|PGRST20\d/i.test(e?.message||'');

/* ---------- headline data ---------- */
async function loadMetrics(){
  const c=state.currency;
  let m=await state.sb.rpc('portfolio_metrics',{p_currency:c});
  if(m.error&&isSchemaErr(m.error)){state.schemaErr=true;if(c==='MWK')m=await state.sb.rpc('portfolio_metrics',{})}
  state.metrics=m.error?(state.metrics||{}):(m.data||{});
  const s=await state.sb.rpc('portfolio_monthly',{p_currency:c,p_months:6});
  if(s.error&&isSchemaErr(s.error))state.schemaErr=true;
  state.series=s.error?null:(s.data||[]);
}
async function loadOverdue(){
  const {data,error}=await state.sb.rpc('overdue_loans',{});
  if(error&&isSchemaErr(error))state.schemaErr=true;
  state.overdueList=error?[]:(data||[]);
  state.overdue=Object.fromEntries(state.overdueList.map(o=>[o.loan_id,o]));
}
async function loadPending(){
  try{const r=await state.sb.query('loan_summary',{select:'id',filters:[['status','eq','Pending Approval']],count:true,from:0,to:0});state.pendingCount=r.count||0}catch(_){state.pendingCount=0}
}
async function loadData(){
  if(!state.sb||!state.sb.token)return false;
  if(state.userProfile?.role==='Borrower'){
    const [b,l,r,n]=await Promise.all([
      state.sb.from('borrower_summary').select('*').eq('user_id',state.user.id),
      state.sb.from('loan_summary').select('*').eq('borrower_user_id',state.user.id).order('created_at',{ascending:false}),
      state.sb.from('repayment_summary').select('*').eq('borrower_user_id',state.user.id).order('payment_date',{ascending:false}).limit(500),
      state.sb.rpc('borrower_next_due',{})]);
    if(!b.error)state.borrowers=b.data||[];
    if(!l.error)state.loans=l.data||[];
    if(!r.error)state.repayments=r.data||[];
    state.nextDue=n.error?[]:(n.data||[]).sort((a,c)=>String(a.due_date).localeCompare(String(c.due_date)));
    state.metrics={};
  }else{
    state.schemaErr=false;state.branchQueue=null;if(typeof RC!=='undefined')RC.key='';if(typeof BC!=='undefined')BC.key='';if(typeof TG!=='undefined')TG.key='';if(typeof AN!=='undefined'){AN.key='';AN.data=null;AN.errKey=null}if(typeof PF!=='undefined'){PF.key='';PF.rows=null;PF.errKey=null;PF.officers=null;PF.open=null}
    const recent=state.sb.from('loan_summary').select('*').order('created_at',{ascending:false}).limit(200);
    const [l]=await Promise.all([recent,loadMetrics(),loadOverdue(),loadPending(),loadBranches()]);
    if(!l.error)state.loans=l.data||[];
    Object.keys(state.pg).forEach(v=>{state.pg[v].stale=true});
  }
  loaded=true;renderNav();render();return true;
}

/* ---------- column definitions shared by tables and exports ---------- */
const lnk=(id,txt)=>`<a href="#" class="lnk" onclick="openLoanDetail('${id}');return false">${esc(txt)}</a>`;
function overdueBadge(id){const o=state.overdue[id];return o?` <span class="badge b-overdue" title="Oldest unpaid instalment was due ${esc(o.oldest_due)}">Overdue ${o.days_late}d</span>`:''}
const badgeRisk=s=>`<span class="badge ${s==='High'?'b-default':s==='Medium'?'b-pending':'b-active'}">${esc(s||'—')}</span>`;
const badgeKyc=s=>`<span class="badge ${s==='Verified'?'b-active':s==='Rejected'?'b-default':'b-pending'}">${esc(s||'Pending')}</span>`;
const COLS={
  loans:[
    {h:'Loan',t:'html',v:r=>lnk(r.id,r.loan_number),x:r=>r.loan_number},
    {h:'Borrower',t:'text',v:r=>r.borrower_name||''},
    {h:'Branch',t:'text',v:r=>branchName(r.branch_id)},
    {h:'Principal',t:'money',v:r=>r.principal_minor,c:r=>r.currency},
    {h:'Outstanding',t:'money',v:r=>r.outstanding_principal,c:r=>r.currency},
    {h:'Period',t:'text',v:r=>`${fdt(r.start_date||r.disbursement_date||r.created_at)} → ${fdt(r.maturity_date)}`},
    {h:'Status',t:'html',v:r=>badge(r.status)+overdueBadge(r.id)+(r.status==='Pending Approval'?' '+reviewControl(r,'btn mini'):'')+(isApproved(r)&&isStaff()?` <button class="btn mini" title="Download invoice (PDF)" onclick="downloadInvoice('${r.id}')">Invoice</button>`:''),
      x:r=>r.status+(state.overdue[r.id]?` (overdue ${state.overdue[r.id].days_late}d)`:'')}],
  borrowers:[
    {h:'Name',t:'html',v:r=>`<a href="#" class="lnk" onclick="openBorrowerAnalytics('${r.id}');return false"><b>${esc(r.full_name)}</b></a>`,x:r=>r.full_name},
    {h:'Phone',t:'text',v:r=>r.phone||''},
    {h:'Email',t:'text',v:r=>r.email||''},
    {h:'Branch',t:'text',v:r=>branchName(r.branch_id)},
    {h:'Risk',t:'html',v:r=>badgeRisk(r.risk_level),x:r=>r.risk_level},
    {h:'KYC',t:'html',v:r=>badgeKyc(r.kyc_status),x:r=>r.kyc_status},
    {h:'Active loans',t:'text',v:r=>String(r.active_loans??0),cls:'num'},
    {h:'',t:'html',v:r=>`<button class="btn mini" onclick="openBorrowerAnalytics('${r.id}')">Profile</button> `+(can('borrowers','edit')||can('borrowers','create')?`<button class="btn mini" onclick="openEditBorrowerModal('${r.id}')">Edit</button>`:'')+(canAssignBranch(r)?` <button class="btn mini" onclick="openAssignBorrowerModal('${r.id}')">${r.branch_id?'Transfer':'Assign branch'}</button>`:'')}],
  repayments:[
    {h:'Date',t:'text',v:r=>fdt(r.payment_date)},
    {h:'Loan',t:'html',v:r=>lnk(r.loan_id,r.loan_number),x:r=>r.loan_number},
    {h:'Amount',t:'money',v:r=>r.amount_minor,c:r=>r.currency},
    {h:'Fees',t:'money',v:r=>r.fee_component_minor,c:r=>r.currency},
    {h:'Penalty',t:'money',v:r=>r.penalty_component_minor,c:r=>r.currency},
    {h:'Interest',t:'money',v:r=>r.interest_component_minor,c:r=>r.currency},
    {h:'Principal',t:'money',v:r=>r.principal_component_minor,c:r=>r.currency}],
  ledger:[
    {h:'Time',t:'text',v:r=>fts(r.created_at)},
    {h:'Type',t:'text',v:r=>r.entry_type},
    {h:'Reference',t:'text',v:r=>r.reference||''},
    {h:'Debit',t:'text',v:r=>r.debit_account||''},
    {h:'Credit',t:'text',v:r=>r.credit_account||''},
    {h:'Amount',t:'money',v:r=>r.amount_minor,c:r=>r.currency}],
  invoices:[
    {h:'Number',t:'html',v:r=>`<b>${esc(r.invoice_number)}</b>`,x:r=>r.invoice_number},
    {h:'Customer',t:'text',v:r=>r.customer_name},
    {h:'Branch',t:'text',v:r=>branchName(r.branch_id)},
    {h:'Issued',t:'text',v:r=>fdt(r.issue_date)},
    {h:'Due',t:'text',v:r=>r.due_date?fdt(r.due_date):'—'},
    {h:'Total',t:'money',v:r=>r.total_minor,c:r=>r.currency},
    {h:'Status',t:'html',v:r=>r.status==='Void'?`<span class="badge b-default" title="${esc(r.void_reason||'')}">Void</span>`:'<span class="badge b-active">Issued</span>',x:r=>r.status},
    {h:'',t:'html',v:r=>`<button class="btn mini" onclick="manualInvoicePdf('${r.id}')">PDF</button>${r.status==='Issued'&&typeof canVoidInvoice==='function'&&canVoidInvoice()?` <button class="btn mini danger" onclick="openVoidInvoice('${r.id}')">Void</button>`:''}`,x:()=>''}],
  capital:[
    {h:'Time',t:'text',v:r=>fts(r.created_at)},
    {h:'Type',t:'text',v:r=>r.transaction_type},
    {h:'Source',t:'text',v:r=>r.source||''},
    {h:'Reference',t:'text',v:r=>r.reference||''},
    {h:'Amount',t:'money',v:r=>r.amount_minor,c:r=>r.currency}],
  audit:[
    {h:'Time',t:'text',v:r=>new Date(r.created_at).toLocaleString()},
    {h:'User',t:'html',v:r=>`${esc(r.actor_name||r.actor_email||'—')}<div style="font-size:9px;color:var(--muted)">${esc(r.actor_email||'')}</div>`,x:r=>r.actor_name||r.actor_email||''},
    {h:'Role',t:'text',v:r=>r.actor_role||'—'},
    {h:'Branch',t:'text',v:r=>r.branch_name||'—'},
    {h:'Action',t:'html',v:r=>`<span class="badge b-pending">${esc(r.action)}</span>`,x:r=>r.action},
    {h:'Entity',t:'text',v:r=>r.entity_type?`${r.entity_type}${r.entity_id?' '+r.entity_id:''}`:'—'},
    {h:'Details',t:'html',v:r=>`<code style="font-size:10px;white-space:normal">${esc(JSON.stringify(r.details||{}))}</code>`,x:r=>JSON.stringify(r.details||{})}]
};
const AUDIT_ACTIONS=['SIGN_IN','SIGN_OUT','SIGNUP','SESSION_LOCK','SESSION_UNLOCK','SESSION_REFRESH','SESSION_EXPIRED','CREATE','KYC_CHANGE','ASSIGN_BRANCH','CLOSE','REOPEN','APPROVE','REJECT','POST_REPAYMENT','APPLY_PENALTIES','CAPITAL_FUNDING','CAPITAL_WITHDRAWAL','UPDATE_ACCESS','UPDATE_PERMISSIONS','UPDATE_AVATAR'];
const filterOpts=f=>typeof f.opts==='function'?f.opts():f.opts;
const branchFilter={show:()=>isAdminUser(),k:'branch',label:'Branch',col:'branch_id',all:'All branches',opts:()=>['',...(state.branches||[]).map(b=>({v:b.id,l:b.name})),{v:'unassigned',l:'Unassigned'}]};
const curFilter={k:'currency',label:'Currency',col:'currency',opts:['',...CURRENCIES],all:'All currencies'};
const PGDEF={
  borrowers:{table:'borrower_summary',export:'borrowers',order:[['created_at',false]],search:['full_name','phone','email','business_name'],ph:'Search name, phone or email',empty:'No borrowers match.',
    filters:[{k:'kyc',label:'KYC',col:'kyc_status',opts:['','Pending','Verified','Rejected'],all:'Any KYC'},{k:'risk',label:'Risk',col:'risk_level',opts:['','Low','Medium','High'],all:'Any risk'},branchFilter]},
  loans:{table:'loan_summary',export:'loans',order:[['created_at',false]],search:['loan_number','borrower_name'],ph:'Search loan or borrower',empty:'No loans match.',
    filters:[{k:'status',label:'Status',col:'status',opts:['','Pending Approval','Active','Overdue','Defaulted','Restructured','Completed','Rejected','Written-Off','Voided'],all:'Any status'},curFilter,branchFilter],
    date:{col:'created_at',ts:true,label:'Requested'},rowCls:r=>state.overdue[r.id]?'is-overdue':''},
  repayments:{table:'repayment_summary',export:'repayments',order:[['payment_date',false],['created_at',false]],search:['loan_number'],ph:'Search loan number',empty:'No repayments match.',filters:[curFilter,branchFilter],date:{col:'payment_date',label:'Paid'}},
  invoices:{table:'manual_invoices',export:'invoices',order:[['created_at',false]],search:['invoice_number','customer_name'],ph:'Search number or customer',empty:'No invoices yet.',
    filters:[{k:'status',label:'Status',col:'status',opts:['','Issued','Void'],all:'Any status'},curFilter,branchFilter],date:{col:'issue_date',label:'Issued'}},
  ledger:{table:'ledger_entries',export:'ledger',order:[['created_at',false]],search:['reference','entry_type','debit_account','credit_account'],ph:'Search reference, type or account',empty:'No ledger entries match.',filters:[curFilter],date:{col:'created_at',ts:true,label:'Posted'}},
  capital:{table:'capital_transactions',export:'capital-transactions',order:[['created_at',false]],search:['reference','source','transaction_type'],ph:'Search reference or source',empty:'No capital transactions yet.',filters:[curFilter],date:{col:'created_at',ts:true,label:'Posted'}},
  audit:{table:'audit_log_view',export:'audit-log',order:[['created_at',false]],search:['actor_name','actor_email','action','entity_type'],ph:'Search user, action or entity',empty:'No audit records match.',
    filters:[{k:'action',label:'Action',col:'action',opts:['',...AUDIT_ACTIONS],all:'All actions'},branchFilter],date:{col:'created_at',ts:true,label:'When'}}
};

/* ---------- table rendering ---------- */
function cellHTML(c,r){
  if(c.t==='money')return `<td class="num">${mc(c.v(r),c.c?c.c(r):undefined)}</td>`;
  if(c.t==='html')return `<td>${c.v(r)}</td>`;
  return `<td${c.cls?` class="${c.cls}"`:''}>${esc(c.v(r)??'')}</td>`;
}
function tableHTML(cols,rows,o={}){
  if(!rows.length)return `<div class="empty">${o.empty||'No records found.'}</div>`;
  return `<div class="table-wrap"><table class="table"><thead><tr>${cols.map(c=>`<th class="${c.t==='money'||c.cls==='num'?'num':''}">${esc(c.h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr class="${o.rowCls?o.rowCls(r):''}">${cols.map(c=>cellHTML(c,r)).join('')}</tr>`).join('')}</tbody></table></div>`;
}
const loanTable=rows=>tableHTML(COLS.loans,rows,{empty:'No loans recorded yet.',rowCls:PGDEF.loans.rowCls});

/* ---------- server-side paging / search / filters ---------- */
function pgs(v){return state.pg[v]||(state.pg[v]={page:0,size:25,q:'',f:{},from:'',to:'',rows:[],total:0,loading:false,err:'',seq:0,stale:true,timer:null})}
function pgBuild(v,s){
  const d=PGDEF[v],filters=[];
  for(const f of d.filters||[]){
    const val=s.f[f.k];if(!val)continue;
    if(val==='unassigned'){filters.push([f.col,'is','null']);continue}
    if(v==='loans'&&f.k==='status'&&val==='Overdue'){
      const ids=Object.keys(state.overdue);filters.push(['id','in','('+(ids.length?ids.join(','):'00000000-0000-0000-0000-000000000000')+')']);
    }else filters.push([f.col,'eq',val]);
  }
  if(d.date){
    if(s.from)filters.push([d.date.col,'gte',s.from]);
    if(s.to){
      if(d.date.ts){const n=new Date(s.to+'T00:00:00Z');n.setUTCDate(n.getUTCDate()+1);filters.push([d.date.col,'lt',n.toISOString().slice(0,10)])}
      else filters.push([d.date.col,'lte',s.to]);
    }
  }
  const t=s.q.trim(),or=t?d.search.map(c=>`${c}.ilike.${likeTerm(t)}`).join(','):null;
  return{filters,or,order:d.order};
}
async function pgLoad(v){
  const s=pgs(v),d=PGDEF[v],seq=++s.seq;s.loading=true;s.err='';s.stale=false;pgPaint(v);
  try{
    const r=await state.sb.query(d.table,{...pgBuild(v,s),from:s.page*s.size,to:s.page*s.size+s.size-1,count:true});
    if(seq!==s.seq)return;
    s.rows=r.data;s.total=r.count;
    const last=Math.max(0,Math.ceil(s.total/s.size)-1);
    if(s.page>last&&s.total>0){s.page=last;return pgLoad(v)}
  }catch(e){if(seq!==s.seq)return;s.rows=[];s.total=0;s.err=e.message||'Could not load records.'}
  s.loading=false;pgPaint(v);
}
function pgPaint(v){
  const host=$('pg-'+v);if(!host)return;
  const s=pgs(v),d=PGDEF[v],cols=COLS[v];
  let body;
  if(s.loading&&!s.rows.length)body=skelRows(Math.min(s.size,8));
  else if(s.err)body=`<div class="alert bad">${esc(s.err)}</div>`;
  else body=tableHTML(cols,s.rows,{empty:s.q||Object.values(s.f).some(Boolean)||s.from||s.to?'No records match the current search and filters.':d.empty,rowCls:d.rowCls});
  const first=s.total?s.page*s.size+1:0,last=Math.min(s.total,(s.page+1)*s.size),pages=Math.max(1,Math.ceil(s.total/s.size));
  host.innerHTML=`<div class="${s.loading?'pg-busy':''}">${body}</div><div class="pager"><span>${s.total?`Showing ${first}–${last} of ${s.total.toLocaleString()}`:'No records'}</span><span class="pager-ctl"><button class="btn mini" ${s.page<=0?'disabled':''} onclick="pgGo('${v}',-1)">‹ Prev</button><span>Page ${s.page+1} of ${pages}</span><button class="btn mini" ${s.page>=pages-1?'disabled':''} onclick="pgGo('${v}',1)">Next ›</button><select class="cursel" aria-label="Rows per page" onchange="pgSize('${v}',this.value)">${[25,50,100].map(n=>`<option${n===s.size?' selected':''}>${n}</option>`).join('')}</select></span></div>`;
}
function pgBar(v){
  const s=pgs(v),d=PGDEF[v];
  return `<div class="listbar"><input class="search" id="pgq-${v}" placeholder="${esc(d.ph)}" value="${esc(s.q)}" oninput="pgSearch('${v}',this.value)">${(d.filters||[]).filter(f=>!f.show||f.show()).map(f=>`<select class="cursel" aria-label="${esc(f.label)}" onchange="pgFilter('${v}','${f.k}',this.value)">${filterOpts(f).map(o=>{const v=typeof o==='object'?o.v:o,l=typeof o==='object'?o.l:(o||f.all);return `<option value="${esc(v)}"${(s.f[f.k]||'')===v?' selected':''}>${esc(l)}</option>`}).join('')}</select>`).join('')}${d.date?`<label class="dr">${esc(d.date.label)} <input type="date" value="${esc(s.from)}" aria-label="From date" onchange="pgDate('${v}','from',this.value)"> – <input type="date" value="${esc(s.to)}" aria-label="To date" onchange="pgDate('${v}','to',this.value)"></label>`:''}</div>`;
}
function pgView(v){const s=pgs(v);if(s.stale||!s.rows.length&&!s.loading&&!s.err)pgLoad(v);else pgPaint(v)}
function pgSearch(v,val){const s=pgs(v);s.q=val;s.page=0;clearTimeout(s.timer);s.timer=setTimeout(()=>pgLoad(v),300)}
function pgFilter(v,k,val){const s=pgs(v);s.f[k]=val;s.page=0;pgLoad(v)}
function pgDate(v,k,val){const s=pgs(v);s[k]=val;s.page=0;pgLoad(v)}
function pgGo(v,d){const s=pgs(v);s.page=Math.max(0,s.page+d);pgLoad(v)}
function pgSize(v,n){const s=pgs(v);s.size=Number(n)||25;s.page=0;pgLoad(v)}
function pgRefresh(v){const s=pgs(v);s.stale=true;if($('pg-'+v))pgLoad(v)}
async function pgFetchAll(v,cap=20000){
  const s=pgs(v),d=PGDEF[v],out=[];
  for(let from=0;from<cap;from+=1000){
    const r=await state.sb.query(d.table,{...pgBuild(v,s),from,to:from+999,count:true});
    out.push(...r.data);if(out.length>=r.count||!r.data.length)break;
  }
  return out;
}

/* ---------- exports (CSV / PDF) built from column definitions ---------- */
const csvCell=v=>{v=String(v??'');if(/^[=+\-@\t\r]/.test(v)&&isNaN(Number(v)))v="'"+v;return/[",\n\r]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
function colText(c,r){if(c.t==='money')return (Number(c.v(r)||0)/100).toFixed(2);if(c.t==='html')return c.x?c.x(r):'';return String(c.v(r)??'')}
function download(name,blob){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),4000)}
async function exportRows(kind,name,cols,rows,subtitle=''){
  const use=cols.filter(c=>c.h&&(c.t!=='html'||c.x));
  if(!rows.length)return toast('No rows to export.');
  const fn=`marklend-${name}-${today()}`,moneyCol=use.find(c=>c.t==='money'),curOf=r=>moneyCol?.c?moneyCol.c(r):state.currency;
  if(kind==='csv'){
    const lines=[[...use.map(c=>c.h),...(moneyCol?['Currency']:[])],...rows.map(r=>[...use.map(c=>colText(c,r)),...(moneyCol?[curOf(r)]:[])])].map(r=>r.map(csvCell).join(','));
    download(fn+'.csv',new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'}));
    return toast(`CSV exported (${rows.length.toLocaleString()} rows)`);
  }
  const td=(c,r)=>c.t==='money'?`<td class="r">${esc(moneyText(c.v(r),c.c?c.c(r):undefined))}</td>`:`<td${c.cls==='num'?' class="r"':''}>${esc(c.t==='html'?c.x(r):c.v(r)??'')}</td>`;
  const html=`<!doctype html><meta charset="utf-8"><style>body{font:11px Inter,Arial,sans-serif;color:#101828;margin:0}h1{font-size:18px;margin:0}p{color:#667085;margin:4px 0 14px}table{border-collapse:collapse;width:100%}th{background:#f2f4f7;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.04em}th,td{padding:6px 8px;border-bottom:1px solid #e4e7ec}.r{text-align:right;white-space:nowrap}tr{break-inside:avoid}thead{display:table-header-group}</style><h1>MarkLend · ${esc(name.replace(/-/g,' '))}</h1><p>Generated ${new Date().toLocaleString()} · ${rows.length.toLocaleString()} rows${subtitle?' · '+esc(subtitle):''}</p><table><thead><tr>${use.map(c=>`<th${c.t==='money'?' class="r"':''}>${esc(c.h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${use.map(c=>td(c,r)).join('')}</tr>`).join('')}</tbody></table>`;
  try{const r=await window.marklendAPI.exportPDF({html,filename:fn+'.pdf'});if(r?.path)toast('PDF saved')}catch(e){toast('PDF export failed: '+e.message)}
}
const EXPORTS={};
const exb=name=>`<span class="exb"><button class="btn" onclick="doExport('${name}','csv')">CSV</button><button class="btn" onclick="doExport('${name}','pdf')">PDF</button></span>`;
async function doExport(name,kind){
  try{
    const v=Object.keys(PGDEF).find(k=>PGDEF[k].export===name);
    if(v){toast('Preparing export…');const s=pgs(v);const rows=await pgFetchAll(v);const sub=[s.q&&`search “${s.q}”`,...Object.entries(s.f).filter(e=>e[1]).map(e=>e.join(': ')),s.from&&`from ${s.from}`,s.to&&`to ${s.to}`].filter(Boolean).join(', ');return exportRows(kind,name,COLS[v],rows,sub)}
    const e=EXPORTS[name]?.();if(!e)return toast('Nothing to export.');
    return exportRows(kind,name,e.cols,e.rows,e.subtitle||'');
  }catch(err){toast('Export failed: '+err.message)}
}

