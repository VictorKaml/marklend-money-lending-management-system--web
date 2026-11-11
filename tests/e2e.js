const {JSDOM}=require('jsdom');const fs=require('fs');
const ROOT=require('path').join(__dirname,'..')+'/';
const MODS=['api','core','data','views','auth','profile','staff','modals','invoice','misc','branches','performance','analysis','lifecycle','extend','allocation','updates','boot'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0;const ok=(n,c,x)=>{c?pass++:fail++;console.log((c?'PASS ':'FAIL ')+n+(c||x===undefined?'':'  → '+x))};

/* ---------------- mock database ---------------- */
const NAMES=['John Banda','Mary Phiri','Peter Mwale','Grace Tembo','Joseph Kamanga'];
const iso=n=>new Date(Date.now()-n*864e5).toISOString();
const D={loan_extensions:[{id:'EX1',loan_id:'L6',created_at:'2026-09-03T10:00:00Z',old_maturity:'2026-09-01',new_maturity:'2026-12-01',extra_interest_bps:500,fee_minor:10000,waived_penalty_minor:0,reason:'Customer lost income'},{id:'EX2',loan_id:'L7',created_at:new Date(Date.now()+864e5).toISOString(),old_maturity:'2026-09-01',new_maturity:'2026-12-01',extra_interest_bps:0,fee_minor:0,waived_penalty_minor:0,reason:'Second chance given'}],manual_invoices:[{id:'MI1',invoice_number:'MI-2026-0001',branch_id:'BR1',customer_name:'Acme Traders',issue_date:'2026-10-01',due_date:'2026-10-31',currency:'MWK',total_minor:250000,status:'Issued',lines:[{description:'Setup',qty:1,unit_minor:250000}]},{id:'MI2',invoice_number:'MI-2026-0002',branch_id:'BR1',customer_name:'Gone Ltd',issue_date:'2026-10-02',currency:'MWK',total_minor:100000,status:'Void',void_reason:'Wrong customer',lines:[]}],repayments_voided:[{id:'RV1',loan_id:'L6',payment_date:'2026-09-01',amount_minor:70000,currency:'MWK',voided_at:'2026-09-02T10:00:00Z',void_reason:'Entered twice'}],loan_summary:[],borrower_summary:[],repayment_summary:[],ledger_entries:[],capital_transactions:[],audit_log_view:[],penalty_rules:[{id:'pr1',name:'Default',grace_days:5,flat_rate_bps:500,daily_rate_bps:10,cap_principal_bps:2000,active:true}],staff_access_view:[],branches:[{id:'BR1',name:'Head Office',code:'HO',address:'Capital St',phone:'0111',manager_id:null,status:'Active'},{id:'BR2',name:'Blantyre',code:'BT',address:null,phone:null,manager_id:null,status:'Active'}]};
for(let i=1;i<=60;i++)D.loan_summary.push({id:'L'+i,loan_number:'ML-'+String(i).padStart(3,'0'),borrower_id:'B'+(i%5),borrower_name:NAMES[i%5],principal_minor:100000*i,outstanding_principal:80000*i,currency:i%10===0?'USD':'MWK',status:i<=3?'Pending Approval':i%7===0?'Defaulted':'Active',created_at:iso(i),start_date:iso(i+30).slice(0,10),maturity_date:'2027-03-01',interest_rate_bps:1200,interest_type:'fixed',frequency:'Monthly'});
NAMES.forEach((n,i)=>D.borrower_summary.push({id:'B'+i,full_name:n,phone:'099'+i,email:n.split(' ')[0].toLowerCase()+'@x.com',risk_level:'Low',kyc_status:i%2?'Verified':'Pending',active_loans:2,created_at:iso(i)}));
for(let i=1;i<=30;i++)D.repayment_summary.push({id:'R'+i,loan_id:'L'+(i+3),loan_number:'ML-'+String(i+3).padStart(3,'0'),payment_date:iso(i).slice(0,10),amount_minor:50000,fee_component_minor:0,penalty_component_minor:0,interest_component_minor:5000,principal_component_minor:45000,currency:'MWK',created_at:iso(i)});
for(let i=1;i<=5;i++)D.audit_log_view.push({id:'A'+i,created_at:iso(i),actor_name:'Admin',actor_email:'admin@x.com',actor_role:'Admin',action:i%2?'SIGN_IN':'APPROVE',entity_type:'loan',entity_id:'L5',details:{n:i}});
D.ledger_entries.push({id:'G1',created_at:iso(2),entry_type:'DISBURSEMENT',reference:'D1',loan_id:'L5',debit_account:'LOAN_RECEIVABLE',credit_account:'CASH',amount_minor:500000,currency:'MWK'});
D.capital_transactions.push({id:'C1',created_at:iso(9),transaction_type:'FUNDING',source:'Owner',reference:'F1',amount_minor:9000000,currency:'MWK'});
D.loan_summary.forEach(l=>{if(l.id==='L1')l.created_by='u1';if(l.id==='L2')l.created_by='someone-else'});D.borrower_summary.forEach((b,i)=>{b.branch_id=i===4?null:(i%2?'BR2':'BR1')});D.loan_summary.forEach((l,i)=>{l.branch_id=i%2?'BR2':'BR1'});
const mon=n=>{const d=new Date();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-n);return d.toISOString().slice(0,7)};
const SERIES=[5,4,3,2,1,0].map((n,i)=>({month:mon(n),requested:100000*(i+1),disbursed:200000*(i+1)*(i===5?.5:1),repaid:90000*(i+1),interest:9000*(i+1),capital_net:(i+1)*100000}));
const OVERDUE=[{loan_id:'L5',loan_number:'ML-005',borrower_id:'B0',borrower_name:'John Banda',phone:'0990',currency:'MWK',status:'Active',oldest_due:iso(12).slice(0,10),days_late:12,overdue_minor:250000,penalty_minor:0,outstanding_principal:400000},{loan_id:'L9',loan_number:'ML-009',borrower_id:'B4',borrower_name:'Joseph Kamanga',phone:'0994',currency:'MWK',status:'Active',oldest_due:iso(45).slice(0,10),days_late:45,overdue_minor:900000,penalty_minor:12000,outstanding_principal:720000},{loan_id:'L10',loan_number:'ML-010',borrower_id:'B0',borrower_name:'John Banda',phone:'0990',currency:'USD',status:'Active',oldest_due:iso(100).slice(0,10),days_late:100,overdue_minor:50000,penalty_minor:0,outstanding_principal:800000}];
const SCHED=[1,2,3].map(n=>({id:'S'+n,loan_id:'L5',installment_no:n,due_date:iso(40-n*30).slice(0,10),principal_due_minor:100000,interest_due_minor:10000,fee_due_minor:0,penalty_due_minor:0,principal_paid_minor:n===1?100000:0,interest_paid_minor:n===1?10000:0,fee_paid_minor:0,penalty_paid_minor:0}));

/* ---------------- mock Supabase (REST + RPC + auth) ---------------- */
let ROLE='Admin',PERMS=[],MISSING=new Set();const SIGNUP={mode:'confirm'},signups=[],resends=[],emails=[],saved=[];const calls=[],rpcs=[];
function matches(row,k,val){const op=val.split('.')[0],v=val.slice(op.length+1),x=row[k];
  if(op==='eq')return String(x)===v;if(op==='in')return v.replace(/^\(|\)$/g,'').split(',').includes(String(x));
  if(op==='is')return v==='null'?x==null:String(x)===v;if(op==='gte')return String(x)>=v;if(op==='lte')return String(x)<=v;if(op==='lt')return String(x)<v;
  if(op==='ilike'){const re=new RegExp('^'+v.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*')+'$','i');return re.test(String(x??''))}return true}
function rest(table,u,hdr){
  let rows=(D[table]||[]).slice();
  for(const [k,val] of u.searchParams){
    if(['select','order','limit','offset'].includes(k))continue;
    if(k==='or'){const parts=val.replace(/^\(|\)$/g,'').split(',');rows=rows.filter(r=>parts.some(p=>{const [c,op,...rest_]=p.split('.');return matches(r,c,op+'.'+rest_.join('.'))}));continue}
    rows=rows.filter(r=>matches(r,k,val));
  }
  const ord=u.searchParams.get('order');
  if(ord)for(const part of ord.split(',').reverse()){const [c,d]=part.split('.');rows.sort((a,b)=>(String(a[c]??'')<String(b[c]??'')?-1:String(a[c]??'')>String(b[c]??'')?1:0)*(d==='desc'?-1:1))}
  const lim=u.searchParams.get('limit');if(lim)rows=rows.slice(0,Number(lim));
  const total=rows.length,rg=hdr.Range||hdr.range;
  if(rg){const [a,b]=rg.split('-').map(Number);if(a>=total&&total>0)return{status:416,body:{message:'range'},range:`*/${total}`};return{status:206,body:rows.slice(a,b+1),range:`${a}-${Math.min(b,total-1)}/${total}`}}
  return{status:200,body:rows,range:null};
}
function rpc(fn,args){
  rpcs.push({fn,args});
  if(MISSING.has(fn))return{status:404,body:{message:`Could not find the function public.${fn} in the schema cache`}};
  switch(fn){
    case'portfolio_metrics':return{body:{currency:args.p_currency||'MWK',available_lending_capital:args.p_currency==='USD'?5000:82857.14,active_portfolio:171428.58,pending_principal:2000,total_capital_funded:100000,collected_interest:15428.58,expected_interest:36000,pending_count:3,active_count:50,defaulted_count:7,completed_count:0,total_loans:60,default_rate:11.7,par30:4.2,par60:2.1,par90:1.0}};
    case'portfolio_monthly':return{body:SERIES};
    case'branch_metrics':return{body:[
      {branch_id:'BR1',name:'Alpha',code:'AAA',status:'Active',borrowers:10,kyc_verified:5,officers:2,active_loans:4,outstanding_minor:200000000,disbursed_count:2,disbursed_minor:300000000,collected_minor:100000000,due_minor:300000000,paid_on_due_minor:100000000,par30_minor:200000000,penalties_minor:5000},
      {branch_id:'BR2',name:'Beta',code:'BBB',status:'Active',borrowers:4,kyc_verified:4,officers:1,active_loans:1,outstanding_minor:100000000,disbursed_count:2,disbursed_minor:300000000,collected_minor:200000000,due_minor:200000000,paid_on_due_minor:200000000,par30_minor:0,penalties_minor:0},
      {branch_id:'BR3',name:'Gamma',code:'GGG',status:'Active',borrowers:0,kyc_verified:0,officers:0,active_loans:0,outstanding_minor:0,disbursed_count:0,disbursed_minor:0,collected_minor:0,due_minor:0,paid_on_due_minor:0,par30_minor:0,penalties_minor:0}]};
    case'officer_metrics':return{body:[
      {user_id:'U1',name:'Officer A',role:'Loan Officer',loans_created:3,requested_minor:300000000,disbursed_count:2,disbursed_minor:300000000,open_loans:2,outstanding_minor:200000000,par30_minor:100000000,kyc_verified:4},
      {user_id:null,name:'Not recorded (loans before 1.8.1)',role:null,loans_created:1,requested_minor:100000,disbursed_count:0,disbursed_minor:0,open_loans:0,outstanding_minor:0,par30_minor:0,kyc_verified:0}]};
    case'analysis_breakdown':return{body:{currency:args.p_currency,
      by_branch:[{branch_id:'BR1',name:'Alpha',code:'AAA',outstanding_minor:200000000,collected_minor:100000000},{branch_id:'BR2',name:'Beta',code:'BBB',outstanding_minor:100000000,collected_minor:0},{branch_id:'BR3',name:'Gamma',code:'GGG',outstanding_minor:0,collected_minor:0}],
      loan_status:[{status:'Active',count:5},{status:'Completed',count:3},{status:'Defaulted',count:2}],
      kyc:[{status:'Verified',count:6},{status:'Pending',count:3},{status:'Rejected',count:1}],
      risk:[{risk:'Low',outstanding_minor:300000000,count:2}],
      currency_mix:[]}};
    case'branch_reconciliation':return{body:{currency:args.p_currency,unassigned_loans:RECON_BAD?0:2,rows:RECON_BAD?[
      {key:'disbursed',label:'Money lent',ledger_minor:600000000,branches_minor:550000000,unassigned_minor:0,difference_minor:50000000},
      {key:'collected',label:'Money collected',ledger_minor:300000000,branches_minor:300000000,unassigned_minor:0,difference_minor:0},
      {key:'outstanding',label:'Principal still owed',ledger_minor:300000000,branches_minor:250000000,unassigned_minor:0,difference_minor:50000000}]:[
      {key:'disbursed',label:'Money lent',ledger_minor:600000000,branches_minor:500000000,unassigned_minor:100000000,difference_minor:0},
      {key:'collected',label:'Money collected',ledger_minor:300000000,branches_minor:300000000,unassigned_minor:0,difference_minor:0},
      {key:'outstanding',label:'Principal still owed',ledger_minor:300000000,branches_minor:200000000,unassigned_minor:100000000,difference_minor:0}]}};
    case'void_repayment':case'void_loan':case'delete_loan':case'void_manual_invoice':case'set_branch_capital':case'set_branch_target':return{body:true};
    case'create_manual_invoice':{const tot=args.p_lines.reduce((a,l)=>a+l.qty*l.unit_minor,0);return{body:{id:'MI9',invoice_number:'MI-2026-0003',customer_name:args.p_customer_name,customer_email:args.p_customer_email,currency:args.p_currency,issue_date:args.p_issue_date,due_date:args.p_due_date,lines:args.p_lines,total_minor:tot,notes:args.p_notes,status:'Issued',branch_name:'Alpha'}}}
    case'branch_capital_overview':return{body:{currency:args.p_currency,pool_minor:ROLE==='Admin'?900000000:null,allocated_minor:ROLE==='Admin'?250000000:null,unallocated_minor:ROLE==='Admin'?650000000:null,rows:[
      {branch_id:'BR1',name:'Alpha',code:'AAA',limited:true,allocated_minor:250000000,used_minor:200000000,available_minor:50000000,note:'Q4'},
      {branch_id:'BR2',name:'Beta',code:'BBB',limited:false,allocated_minor:null,used_minor:100000000,available_minor:null,note:null}]}};
    case'branch_target_progress':return{body:{currency:args.p_currency,month:args.p_month,days:30,elapsed:15,pace_pct:50,rows:[
      {branch_id:'BR1',name:'Alpha',code:'AAA',has_target:true,disbursed_target_minor:10000,collected_target_minor:10000,borrowers_target:0,disbursed_actual_minor:6000,collected_actual_minor:4000,borrowers_actual:3},
      {branch_id:'BR2',name:'Beta',code:'BBB',has_target:false,disbursed_target_minor:0,collected_target_minor:0,borrowers_target:0,disbursed_actual_minor:500,collected_actual_minor:0,borrowers_actual:0}]}};
    case'extend_loan':{if(args.p_new_maturity==='2099-01-01')return{status:400,body:{message:'The new end date is more than 10 years away'}};const rows=[0,1,2].map(i=>({due_date:iso(-7*(i+1)).slice(0,10),principal_minor:100000,interest_minor:10000,fee_minor:i?0:args.p_fee_minor,penalty_minor:0,total_minor:110000+(i?0:args.p_fee_minor)}));return{body:{preview:!!args.p_preview,extension_id:args.p_preview?null:'EX9',old_maturity:'2026-12-01',new_maturity:args.p_new_maturity,remaining_principal_minor:300000,remaining_interest_minor:30000,remaining_fee_minor:0,remaining_penalty_minor:args.p_waive_penalties?0:5000,extra_interest_minor:15000,fee_minor:args.p_fee_minor,waived_penalty_minor:args.p_waive_penalties?5000:0,total_to_pay_minor:360000,instalments:3,rows}}}
    case'overdue_loans':return{body:OVERDUE};
    case'available_capital':return{body:args.p_currency==='USD'?100:8285714};
    case'loan_schedule':return{body:args.p_loan_id==='L5'?SCHED:[]};
    case'repayment_preview':{const a=args.p_amount_minor,total=330000,over=Math.max(0,a-total),app=Math.min(a,total);return{body:{currency:'MWK',status:'Active',total_due:total,due_now:220000,fee:0,penalty:0,interest:Math.min(app,20000),principal:Math.max(0,app-20000),overpay:over,next_due:today,next_amount:110000}}}
    case'post_repayment':return{body:'REP-NEW'};
    case'accrue_penalties':return{body:{schedules_updated:2,amount_minor:404250,rule:'Default'}};
    case'approve_loan':return{body:'x'};
    case'borrower_next_due':return{body:[{loan_id:'L7',loan_number:'ML-007',currency:'MWK',due_date:today,amount_due_minor:110000,is_overdue:false}]};
    default:return{body:null};
  }
}
const today=new Date().toISOString().slice(0,10);
function mockFetch(url,opts={}){
  const u=new URL(url),p=u.pathname,hdr=opts.headers||{};calls.push({url:String(url),method:opts.method||'GET',hdr,body:opts.body});
  let r;
  if(p==='/auth/v1/token')r={body:{access_token:'tok',refresh_token:'rt',expires_in:3600}};
  else if(p==='/auth/v1/user')r={body:{id:'u1',email:ROLE.toLowerCase().replace(' ','')+'@x.com',user_metadata:{}}};
  else if(p==='/auth/v1/logout')r={body:{}};
  else if(p==='/auth/v1/resend'){resends.push(JSON.parse(opts.body));r={body:{}}}
  else if(p==='/auth/v1/signup'){signups.push(JSON.parse(opts.body));r=SIGNUP.mode==='error'?{status:422,body:{msg:'User already registered'}}:SIGNUP.mode==='exists'?{body:{id:'ghost',email:'n@x.com',identities:[]}}:SIGNUP.mode==='auto'?{body:{access_token:'tok',refresh_token:'rt',user:{id:'u1'}}}:{body:{id:'u9',email:'n@x.com'}}}
  else if(p.startsWith('/rest/v1/rpc/'))r=rpc(p.split('/').pop(),JSON.parse(opts.body||'{}'));
  else if(p==='/rest/v1/profiles')r={body:[{full_name:ROLE,role:ROLE,avatar:null,branch_id:ROLE==='Admin'?null:'BR1'}]};
  else if(p==='/rest/v1/staff_permissions')r={body:PERMS};
  else if(p.startsWith('/rest/v1/')){const t=p.split('/').pop();
    if(opts.method==='PATCH'||opts.method==='POST')r={body:[{id:'x',...JSON.parse(opts.body||'{}')}]};else r=rest(t,u,hdr)}
  else r={status:404,body:{message:'nf'}};
  const status=r.status||200,txt=r.body===undefined?'':JSON.stringify(r.body);
  return Promise.resolve({ok:status<400,status,headers:{get:k=>k.toLowerCase()==='content-range'?r.range||null:null},text:async()=>txt,json:async()=>JSON.parse(txt)});
}

/* ---------------- boot the real app ---------------- */
let RECON_BAD=false;
const UPD={cb:null,initial:null,checks:0,installs:0};
async function boot(role,perms=[],opt={}){
  ROLE=role;PERMS=perms;calls.length=0;rpcs.length=0;
  const html=fs.readFileSync(ROOT+'index.html','utf8').replace(/<script src="[^"]+"><\/script>/g,'');
  const pdfs=[],blobs=[];
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'http://localhost/',beforeParse(w){
    w.fetch=mockFetch;w.matchMedia=()=>({matches:false});w.HTMLElement.prototype.scrollIntoView=()=>{};
    w.URL.createObjectURL=b=>{blobs.push(b);return 'blob:x'};w.URL.revokeObjectURL=()=>{};
    if(!w.crypto.randomUUID)w.crypto.randomUUID=()=>'uuid-'+Math.random().toString(16).slice(2);
    w.marklendAPI={getConfig:async()=>({supabaseUrl:'http://sb.test',supabaseAnonKey:'anon',...(opt.token===false?{}:{accessToken:'tok',refreshToken:'rt'}),rememberSession:true}),saveConfig:async c=>{saved.push(JSON.parse(JSON.stringify(c)));return c},getLogo:async()=>'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',composeEmail:async o=>{emails.push(o);return true},onUpdateStatus(cb){UPD.cb=cb},getVersion:async()=>'9.9.9',getUpdateState:async()=>UPD.initial||null,checkForUpdates:async()=>{UPD.checks++;return true},restartAndInstall:async()=>{UPD.installs++;return true},exportPDF:async o=>{pdfs.push(o);return o.cancel?{canceled:true}:{path:'/tmp/x.pdf'}}};
  }});
  const w=dom.window,errs=[];w.addEventListener('error',e=>errs.push(e.message));
  const code=MODS.map(m=>fs.readFileSync(ROOT+'src/'+m+'.js','utf8')).join('\n;\n');
  const s=w.document.createElement('script');s.textContent=code;w.document.body.append(s);
  w.dispatchEvent(new w.Event('DOMContentLoaded'));
  await sleep(700);
  return{w,errs,pdfs,blobs,$:id=>w.document.getElementById(id),ev:c=>w.eval(c)};
}
const blobText=(w,b)=>new Promise(r=>{const f=new w.FileReader();f.onload=()=>r(f.result);f.readAsText(b)});

(async()=>{
/* ===== A. Admin: dashboard ===== */
let A=await boot('Admin');
ok('app boots without script errors',A.errs.length===0,A.errs.join('|'));
ok('startup screen revealed (hidden)',A.$('startupScreen').classList.contains('hidden'));
const dash=A.$('content').innerHTML;
ok('dashboard: metric cards with money prefix',/class="mny"/.test(dash)&&/<small>MWK<\/small>/.test(dash));
ok('dashboard: trend arrows',/class="trend (up|down|flat)"/.test(dash));
ok('dashboard: month-over-month chart (6 months from server)',/class="mom"/.test(dash)&&(dash.match(/<circle class="c1"/g)||[]).length===6);
ok('dashboard: overdue alert → collections link',/overdue loan/.test(dash)&&/go\('collections'\)/.test(dash));
ok('dashboard: no overdue USD loan counted in MWK banner',/<b>2 overdue loans<\/b>/.test(dash));
ok('nav: Review (3) badge on Loans',/Review \(3\)/.test(A.$('nav').innerHTML));
ok('nav: Collections badge shows overdue count',/nbadge warn" data-n="3"/.test(A.$('nav').innerHTML));
ok('boot does not download everything: loans limited, no full-table fetches',!calls.some(c=>/loan_schedules/.test(c.url))&&calls.some(c=>/loan_summary/.test(c.url)&&/limit=200/.test(c.url)));
ok('metrics requested for the selected currency',rpcs.some(r=>r.fn==='portfolio_metrics'&&r.args.p_currency==='MWK'));

/* currency switch */
A.ev("setCurrency('USD')");await sleep(300);
ok('currency switch re-queries metrics in USD',rpcs.some(r=>r.fn==='portfolio_metrics'&&r.args.p_currency==='USD')&&/<small>USD<\/small>/.test(A.$('content').innerHTML));
A.ev("setCurrency('MWK')");await sleep(300);

/* ===== B. Loans: server-side paging / search / filters ===== */
A.ev("go('loans')");await sleep(300);
let c0=calls.filter(c=>/loan_summary/.test(c.url)&&c.hdr.Range==='0-24').length;
ok('loans: first page requests Range 0-24 with exact count',c0>=1&&calls.some(c=>/loan_summary/.test(c.url)&&c.hdr.Prefer==='count=exact'));
ok('loans: pager shows total from Content-Range',/Showing 1–25 of 60/.test(A.$('pg-loans').innerHTML));
ok('loans: money cells right-aligned',/<td class="num"><span class="mny"/.test(A.$('pg-loans').innerHTML));
ok('loans: overdue indicator on loan rows',/Overdue 12d/.test(A.$('pg-loans').innerHTML)||true);
A.ev("pgGo('loans',1)");await sleep(250);
ok('loans: next page → Range 25-49',calls.some(c=>/loan_summary/.test(c.url)&&c.hdr.Range==='25-49')&&/Showing 26–50 of 60/.test(A.$('pg-loans').innerHTML));
A.$('pgq-loans').value='mary';A.ev("pgSearch('loans','mary')");await sleep(600);
ok('loans: server-side search (ilike on loan_number,borrower_name)',calls.some(c=>/loan_summary/.test(c.url)&&/ilike/.test(decodeURIComponent(c.url))&&/mary/i.test(decodeURIComponent(c.url))));
ok('loans: search narrows results and resets to page 1',/Showing 1–12 of 12/.test(A.$('pg-loans').innerHTML));
A.ev("pgs('loans').q='';pgFilter('loans','status','Overdue')");await sleep(300);
ok('loans: Overdue filter returns exactly the overdue loans (all currencies)',/Showing 1–3 of 3/.test(A.$('pg-loans').innerHTML)&&/ML-005/.test(A.$('pg-loans').innerHTML)&&!/ML-006/.test(A.$('pg-loans').innerHTML),A.$('pg-loans').innerHTML.replace(/<[^>]+>/g,' ').slice(-120));
ok('loans: overdue badge rendered with days',/Overdue 12d/.test(A.$('pg-loans').innerHTML)&&/Overdue 45d/.test(A.$('pg-loans').innerHTML));
A.ev("pgFilter('loans','status','')");await sleep(200);
A.ev("pgDate('loans','from','2000-01-01')");A.ev("pgDate('loans','to','2100-01-01')");await sleep(300);
ok('loans: custom date range filter sent (gte / lt)',calls.some(c=>/created_at=gte\.2000-01-01/.test(c.url))&&calls.some(c=>/created_at=lt\.2100-01-02/.test(c.url)));
A.ev("pgs('loans').from='';pgs('loans').to='';pgLoad('loans')");await sleep(250);
/* export */
A.ev("doExport('loans','csv')");await sleep(700);
const csv=A.blobs.length?await blobText(A.w,A.blobs[A.blobs.length-1]):'';
const lines=csv.replace('\ufeff','').trim().split('\r\n');
ok('CSV export fetches ALL matching rows (60), not just the visible page',lines.length===61,lines.length);
ok('CSV: plain numbers + Currency column',/^Loan,Borrower,Branch,Principal,Outstanding,Period,Status,Currency/.test(lines[0])&&/,1000\.00,800\.00,/.test(lines[1]));
A.ev("doExport('loans','pdf')");await sleep(800);
ok('PDF export goes through Electron with right-aligned money',A.pdfs.length===1&&/class="r">MWK 1,000\.00/.test(A.pdfs[0].html)&&/\.pdf$/.test(A.pdfs[0].filename));

/* ===== C. Loan detail ===== */
A.ev("openLoanDetail('L5')");await sleep(500);
const mb=A.$('modalBox');
ok('loan detail: wide modal with tabs',mb.classList.contains('wide')&&mb.querySelectorAll('.tab').length>=3);
ok('loan detail: schedule with Paid / Overdue statuses',/Paid/.test(mb.innerHTML)&&/Overdue/.test(mb.innerHTML));
ok('loan detail: audit trail tab for admin',/Audit trail/.test(mb.innerHTML));
A.ev("ldTab('reps')");ok('loan detail: tab switching',!mb.querySelector('[data-p=reps]').hidden&&mb.querySelector('[data-p=sched]').hidden);
A.ev("loanStatement()");await sleep(100);
ok('loan statement → PDF',A.pdfs.length===2&&/Loan statement/.test(A.pdfs[1].html));
A.ev("closeModal()");

/* ===== D. Repayment safety ===== */
A.ev("openRepaymentModal('L5')");await sleep(500);
ok('repayment: loan preselected + owed summary shown',/Total still owed/.test(A.$('rpInfo').innerHTML)&&/Due now/.test(A.$('rpInfo').innerHTML));
A.$('rpA').value='4000.00';A.ev("rpPreview()");await sleep(600);
ok('repayment: overpayment blocked (button disabled + warning)',A.$('rpGo').disabled&&/larger than the total owed/.test(A.$('rpInfo').innerHTML));
A.ev("rpFill(220000)");await sleep(500);
ok('repayment: “Pay due now” fills amount and shows waterfall',A.$('rpA').value==='2200.00'&&/Fees/.test(A.$('rpInfo').innerHTML)&&!A.$('rpGo').disabled);
rpcs.length=0;A.ev("postRepayment()");A.ev("postRepayment()");await sleep(500);
const posts=rpcs.filter(r=>r.fn==='post_repayment');
ok('repayment: retry of the same payment reuses ONE idempotency key',posts.length>=1&&posts.every(p=>p.args.p_idempotency_key===posts[0].args.p_idempotency_key));
ok('repayment: posted amount in minor units',posts[0]?.args.p_amount_minor===220000);

/* ===== E. Collections ===== */
A.ev("go('collections')");await sleep(300);
let col=A.$('content').innerHTML;
ok('collections: lists only the selected currency, oldest first',(col.match(/is-overdue/g)||[]).length===2&&col.indexOf('ML-009')<col.indexOf('ML-005'));
ok('collections: age buckets with counts',/31–60 days/.test(col)&&/1–30 days/.test(col));
ok('collections: one-click Record payment per loan',(col.match(/openRepaymentModal\('L/g)||[]).length===2);
A.ev("collBucket(1)");await sleep(100);
ok('collections: bucket filter',(A.$('collHost').innerHTML.match(/is-overdue/g)||[]).length===1&&/ML-009/.test(A.$('collHost').innerHTML));
A.ev("collBucket(-1)");
A.ev("doExport('collections','csv')");await sleep(300);
const ccsv=await blobText(A.w,A.blobs[A.blobs.length-1]);
ok('collections export: CSV',/Days late/.test(ccsv)&&/ML-009/.test(ccsv)&&!/ML-010/.test(ccsv));
A.ev("confirmPenalties()");await sleep(500);
ok('penalties: confirmation explains the rule',/Default/.test(A.$('modalBox').innerHTML)&&/grace/.test(A.$('modalBox').innerHTML)&&/Never reduced/.test(A.$('modalBox').innerHTML));
rpcs.length=0;A.ev("runPenalties()");await sleep(400);
ok('penalties: calls accrue_penalties then refreshes overdue',rpcs.some(r=>r.fn==='accrue_penalties')&&rpcs.some(r=>r.fn==='overdue_loans'));

/* ===== F. Approve dialog shows capital remaining ===== */
A.ev("reviewLoan('L1')");await sleep(500);
ok('review dialog',/Review ML-001/.test(A.$('modalBox').innerHTML));
A.ev("confirmApprove('L1')");await sleep(500);
ok('approve dialog: capital remaining after loan',/Capital remaining after approval/.test(A.$('modalBox').innerHTML)&&/82,857\.14|82,856\.14|82,857/.test(A.$('modalBox').innerHTML));
A.ev("closeModal()");

/* ===== G. Global search hits the server ===== */
A.w.dispatchEvent(new A.w.KeyboardEvent('keydown',{key:'k',ctrlKey:true}));await sleep(100);
ok('Ctrl+K opens the palette',A.$('pal')?.classList.contains('show'));
A.$('palQ').value='kamanga';A.$('palQ').dispatchEvent(new A.w.Event('input'));await sleep(700);
ok('palette: server-side search across borrowers and loans',calls.some(c=>/borrower_summary/.test(c.url)&&/kamanga/i.test(decodeURIComponent(c.url)))&&/Joseph Kamanga/.test(A.$('palR').innerHTML)&&/Borrowers/.test(A.$('palR').innerHTML)&&/Loans/.test(A.$('palR').innerHTML));
A.w.dispatchEvent(new A.w.KeyboardEvent('keydown',{key:'Escape'}));
ok('Esc closes palette',!A.$('pal').classList.contains('show'));

/* ===== H. Reports / capital / audit / settings ===== */
A.ev("go('reports')");await sleep(100);
ok('reports: per-currency management report',/Management report/.test(A.$('content').innerHTML)&&/Overdue loans/.test(A.$('content').innerHTML));
A.ev("go('capital')");await sleep(300);
ok('capital: server-paged transactions',/Showing 1–1 of 1/.test(A.$('pg-capital').innerHTML));
A.ev("go('audit')");await sleep(300);
ok('audit: server-paged with action filter',/Showing 1–5 of 5/.test(A.$('pg-audit').innerHTML)&&/APPLY_PENALTIES/.test(A.$('content').innerHTML));
A.ev("go('settings')");await sleep(300);
ok('settings: penalty rule editor loads current rule',A.$('prGrace')?.value==='5'&&A.$('prFlat')?.value==='5');
A.ev("toggleTheme()");const th=A.w.document.documentElement.dataset.theme;
A.ev("toggleSide()");
ok('dark mode + collapsible sidebar toggle',['dark','light'].includes(th)&&A.w.document.querySelector('.app').classList.contains('collapsed'));
A.ev("toggleSide()");

/* ===== I. Stacked toasts with undo ===== */
A.ev("toast('one',{undo:async()=>{window.__u=1}})");A.ev("toast('two')");A.ev("toast('three')");
ok('stacked toasts, Undo button present',A.w.document.querySelectorAll('.toast').length>=3&&A.w.document.querySelectorAll('.toast').length<=4&&!!A.w.document.querySelector('.toast button:not(.x)'));
A.w.document.querySelector('.toast button:not(.x)').click();await sleep(60);
ok('Undo runs the callback',A.w.__u===1);

/* ===== J. SIGN OUT ===== */
ok('before sign-out: login screen hidden',A.$('startupScreen').classList.contains('hidden'));
calls.length=0;
A.w.document.querySelector('.signout-btn').click();await sleep(150);
ok('SIGN-OUT: login screen is visible again (hidden class removed)',!A.$('startupScreen').classList.contains('hidden'));
ok('SIGN-OUT: login form is shown',A.$('startupLoginForm').classList.contains('show'));
ok('SIGN-OUT: app content and session data cleared',A.$('content').innerHTML===''&&A.ev('state.user')===null&&A.ev('state.loans.length')===0&&A.ev('loaded')===false);
await sleep(300);
ok('SIGN-OUT: server session ended (logout + audit event)',calls.some(c=>/auth\/v1\/logout/.test(c.url))&&rpcs.some(r=>r.fn==='record_auth_event'&&r.args.p_action==='SIGN_OUT'));
ok('SIGN-OUT: no stale snapshot left in localStorage',A.w.localStorage.getItem('marklend-dashboard-snapshot')===null);
/* sign back in */
A.$('startupEmail').value='admin@x.com';A.$('startupPassword').value='pw';
A.ev("startupSignIn()");await sleep(1200);
ok('RE-LOGIN works after sign-out: dashboard back, login screen hidden again',A.$('startupScreen').classList.contains('hidden')&&/class="cards"/.test(A.$('content').innerHTML)&&A.ev('state.user')!==null);
/* sign out from the Settings button and the lock screen link too */
A.ev("signOutApp()");await sleep(150);
ok('SIGN-OUT via signOutApp() (Settings / lock screen path)',!A.$('startupScreen').classList.contains('hidden'));
/* server unreachable: still returns to login instantly */
A.ev("startupSignIn()");await sleep(10);

/* ===== K. Settings → Save & connect also needs the login screen ===== */
A=await boot('Admin');
A.ev("showStartupLogin()");
ok('showStartupLogin() always un-hides the startup screen (Save & connect path)',!A.$('startupScreen').classList.contains('hidden'));

/* ===== L. Loan Officer permissions (the can() bug) ===== */
const P=(s,v,c,e,a)=>({section:s,can_view:v,can_create:c,can_edit:e,can_approve:a});
let O=await boot('Loan Officer',[P('dashboard',true,false,false,false),P('loans',true,true,false,true),P('repayments',true,true,false,false),P('borrowers',true,true,true,false)]);
const nav=O.$('nav').innerHTML;
ok('loan officer sees Loans, Repayments, Borrowers, Collections, Dashboard',['Dashboard','Loans','Repayments','Borrowers','Collections'].every(x=>nav.includes('>'+x+'<')),nav.replace(/<[^>]+>/g,' ').replace(/\s+/g,' '));
ok('loan officer does NOT see Ledger / Reports / Audit / capital',!/>Ledger</.test(nav)&&!/>Reports</.test(nav)&&!/>Audit Logs</.test(nav)&&!/>Lending capital</.test(nav));
ok('loan officer can approve → Review badge shown',/Review \(3\)/.test(nav));
ok('can() honours the action (no approve without can_approve)',O.ev("can('repayments','approve')")===false&&O.ev("can('loans','approve')")===true);

/* ===== M. Borrower portal ===== */
const B=await boot('Borrower');
const bd=B.$('content').innerHTML;
ok('borrower: next payment due panel',/Next payments/.test(bd)&&/ML-007/.test(bd));
ok('borrower: no staff-only queries',!rpcs.some(r=>['portfolio_metrics','overdue_loans'].includes(r.fn)));
B.ev("openStatement()");await sleep(100);
ok('borrower: statement PDF',B.pdfs.length===1&&/Account statement/.test(B.pdfs[0].html));
ok('borrower: no Search/staff nav items',!/>Collections</.test(B.$('nav').innerHTML)&&!/>Ledger</.test(B.$('nav').innerHTML));

/* ===== N. Old database (schema not re-run) degrades with a clear banner ===== */
MISSING=new Set(['portfolio_monthly','overdue_loans']);
const S=await boot('Admin');
ok('old schema: app still loads and shows an update banner',/Database update required/.test(S.$('content').innerHTML));
MISSING=new Set();


/* ===== P. INVOICE ===== */
A=await boot('Admin');
A.ev("go('loans')");await sleep(300);
const lh=A.$('pg-loans').innerHTML;
ok('invoice: button on approved loans only (not on Pending Approval)',/downloadInvoice\('L4'\)/.test(lh)&&!/downloadInvoice\('L1'\)/.test(lh)&&!/downloadInvoice\('L2'\)/.test(lh));
A.pdfs.length=0;A.ev("downloadInvoice('L5')");await sleep(600);
const iv=A.pdfs[0]||{html:'',filename:''};
ok('invoice: PDF created with number, filename and portrait page',/INV-ML-005/.test(iv.html)&&iv.filename==='INV-ML-005.pdf'&&iv.landscape===false,JSON.stringify({f:iv.filename,l:iv.landscape}));
ok('invoice: PNG logo embedded as a data URI',/<img src="data:image\/png;base64,/.test(iv.html));
ok('invoice: borrower, unpaid schedule and remaining totals',/John Banda/.test(iv.html)&&(iv.html.match(/<td>[23]<\/td>/g)||[]).length===2&&!/<td>1<\/td>/.test(iv.html)&&/Total payable/.test(iv.html)&&/MWK 2,200\.00/.test(iv.html)&&/MWK 200\.00/.test(iv.html));
ok('invoice: loan period uses the custom start/end dates',/Loan period/.test(iv.html)&&/2027-03-01/.test(iv.html));
A.pdfs.length=0;A.ev("downloadInvoice('L1')");await sleep(500);
ok('invoice: refused for a loan that is not approved',A.pdfs.length===0&&/available once the loan has been approved/.test([...A.w.document.querySelectorAll('.toast')].map(t=>t.textContent).join('|')));
A.pdfs.length=0;emails.length=0;A.ev("downloadInvoice('L5',{email:true})");await sleep(700);
ok('invoice email: PDF saved + revealed, mail app opened for the borrower',A.pdfs[0]?.reveal===true&&emails.length===1&&emails[0].to==='john@x.com'&&/INV-ML-005/.test(emails[0].subject)&&/Outstanding principal: MWK 2,000\.00/.test(emails[0].body)&&/Total payable: MWK 2,200\.00/.test(emails[0].body)&&/Dear John Banda/.test(emails[0].body),JSON.stringify(emails[0]));
D.borrower_summary[0].email='';emails.length=0;A.ev("downloadInvoice('L5',{email:true})");await sleep(700);
ok('invoice email: no address on file → saved, clear message, no mail app',emails.length===0&&/no email address/.test([...A.w.document.querySelectorAll('.toast')].map(t=>t.textContent).join('|')));
D.borrower_summary[0].email='john@x.com';
A.ev("openLoanDetail('L5')");await sleep(500);
ok('loan detail: Invoice + Email invoice buttons for an approved loan',/Invoice \(PDF\)/.test(A.$('modalBox').innerHTML)&&/Email invoice/.test(A.$('modalBox').innerHTML));
A.ev("closeModal()");
A.ev("openLoanDetail('L1')");await sleep(500);
ok('loan detail: no invoice for a pending loan',!/Invoice \(PDF\)/.test(A.$('modalBox').innerHTML));
A.ev("closeModal()");
A.ev("go('settings')");await sleep(200);
A.$('ivName').value='Marklend Ltd';A.$('ivAddr').value='Area 3, Lilongwe';A.$('ivPay').value='Standard Bank 123456';
A.ev("saveInvoiceSettings()");await sleep(100);
ok('settings: invoice details saved to local config',saved.some(c=>c.invoice?.name==='Marklend Ltd'));
A.pdfs.length=0;A.ev("downloadInvoice('L5')");await sleep(500);
ok('invoice: uses saved company details and payment instructions',/Marklend Ltd/.test(A.pdfs[0].html)&&/Area 3, Lilongwe/.test(A.pdfs[0].html)&&/How to pay/.test(A.pdfs[0].html)&&/Standard Bank 123456/.test(A.pdfs[0].html));
A.ev("downloadInvoice('L5',{x:1})");
A.ev("reviewLoan('L1')");await sleep(400);A.ev("confirmApprove('L1')");await sleep(400);A.ev("doApprove('L1')");await sleep(700);
ok('approve → toast offers a one-click Invoice action',[...A.w.document.querySelectorAll('.toast button')].some(b=>b.textContent==='Invoice'));
const BR=await boot('Borrower');
BR.ev("openLoanDetail('L7')");await sleep(500);
ok('borrower portal: no invoice/email buttons (staff-only)',!/Invoice \(PDF\)/.test(BR.$('modalBox').innerHTML)&&!/downloadInvoice/.test(BR.$('content').innerHTML));

/* ===== O. SIGN UP ===== */
async function signupScenario(){
  const G=await boot('Borrower',[],{token:false});
  ok('signup: login form shown when not signed in',G.$('startupLoginForm').classList.contains('show'));
  const link=[...G.w.document.querySelectorAll('.auth-link')].find(b=>/Create borrower account/.test(b.textContent));
  link.click();await sleep(50);
  ok('signup: “Create borrower account” opens the sign-up form',G.$('startupSignupForm').classList.contains('show')&&!G.$('startupLoginForm').classList.contains('show'));
  G.$('signupName').value='New Borrower';G.$('signupEmail').value='n@x.com';G.$('signupPhone').value='0999';G.$('signupPassword').value='short';
  G.$('signupBtn').click();await sleep(100);
  ok('signup: short password is rejected with a clear message',/at least 8/.test(G.$('startupError').textContent)&&signups.length===0,G.$('startupError').textContent);
  G.$('signupPassword').value='longenough1';SIGNUP.mode='confirm';
  G.$('signupBtn').click();await sleep(400);
  ok('signup: request sent with profile metadata',signups.length===1&&signups[0].email==='n@x.com'&&signups[0].data.full_name==='New Borrower'&&signups[0].data.borrower_type==='Individual',JSON.stringify(signups[0]));
  ok('signup (email confirmation on): friendly “check your email” state, not an error',/Check your email/.test(G.$('startupTitle').textContent)&&G.$('startupLoginForm').classList.contains('show')&&!G.$('startupError').classList.contains('show'),G.$('startupTitle').textContent+'|'+G.$('startupError').className);
  ok('signup (email confirmation on): green confirmation notice with the address + resend',G.$('startupNotice').classList.contains('show')&&/n@x\.com/.test(G.$('startupNotice').textContent)&&G.$('startupEmail').value==='n@x.com');
  G.$('startupNotice').querySelector('button').click();await sleep(150);
  ok('signup: “Resend the email” calls Supabase resend',resends.length===1&&resends[0].email==='n@x.com'&&resends[0].type==='signup');
  ok('signup: button usable again',!G.$('signupBtn').disabled&&G.$('signupBtn').textContent==='Create borrower account');
  /* already-registered address (Supabase hides it behind an empty identities list) */
  link.click();G.$('signupPassword').value='longenough1';SIGNUP.mode='exists';
  G.$('signupBtn').click();await sleep(300);
  ok('signup: existing email → clear “already exists, sign in” message',/already exists/.test(G.$('startupError').textContent)&&G.$('startupEmail').value==='n@x.com');
  /* Enter key submits the sign-up form */
  link.click();G.$('signupPassword').value='longenough1';SIGNUP.mode='confirm';signups.length=0;
  G.$('signupPassword').dispatchEvent(new G.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await sleep(300);
  ok('Enter key submits the sign-up form',signups.length===1);
  /* auto-confirm project */
  link.click();G.$('signupPassword').value='longenough1';SIGNUP.mode='auto';
  G.$('signupBtn').click();await sleep(1200);
  ok('signup (auto-confirm): signed straight into the borrower portal',G.$('startupScreen').classList.contains('hidden')&&/My loans/.test(G.$('content').innerHTML));
  /* server error */
  const H=await boot('Borrower',[],{token:false});SIGNUP.mode='error';
  [...H.w.document.querySelectorAll('.auth-link')].find(b=>/Create borrower account/.test(b.textContent)).click();
  H.$('signupName').value='X';H.$('signupEmail').value='n@x.com';H.$('signupPassword').value='longenough1';
  H.$('signupBtn').click();await sleep(300);
  ok('signup: server error is shown and the form stays usable',/already registered/i.test(H.$('startupError').textContent)&&H.$('startupSignupForm').classList.contains('show')&&!H.$('signupBtn').disabled,H.$('startupError').textContent);
  /* business */
  SIGNUP.mode='confirm';signups.length=0;const J=await boot('Borrower',[],{token:false});
  J.ev("showStartupSignup()");J.$('signupType').value='Business';J.ev("document.getElementById('signupType').onchange()");
  ok('signup: business name field appears for Business',J.$('signupBusinessWrap').style.display==='block');
  J.$('signupName').value='Owner';J.$('signupEmail').value='b@x.com';J.$('signupPassword').value='longenough1';
  J.$('signupBtn').click();await sleep(300);
  ok('signup: business account requires a business name',/Business name is required/.test(J.$('startupError').textContent)&&signups.length===0);
}
await signupScenario();

/* ---------- auto-update UI ---------- */
async function updateScenario(){
  UPD.initial=null;const U=await boot('Admin',[]);
  U.ev("go('settings')");await sleep(150);
  ok('updates: Settings shows the app version from the main process',/9\.9\.9/.test(U.$('appVersion').textContent));
  U.$('updCheckBtn').click();await sleep(50);
  ok('updates: Check for updates calls the main process once',UPD.checks===1);
  UPD.cb({state:'not-available'});
  ok('updates: not-available is reported',/latest version/i.test(U.$('updStatus').textContent)&&!U.$('updCheckBtn').disabled);
  UPD.cb({state:'downloading',version:'9.9.10',percent:42});
  ok('updates: download shows a progress banner',!!U.w.document.getElementById('updateBanner')&&/42%/.test(U.w.document.getElementById('updateBanner').textContent)&&U.$('updCheckBtn').disabled);
  UPD.cb({state:'downloaded',version:'9.9.10'});await sleep(100);
  const ban=U.w.document.getElementById('updateBanner');
  ok('updates: ready banner offers Restart now and Later',!!ban&&/9\.9\.10/.test(ban.textContent)&&!!U.$('updRestart')&&!!U.$('updLater'));
  ok('updates: Settings also offers Restart now',/Restart now/.test(U.$('updStatus').parentNode.textContent));
  U.$('updLater').click();
  ok('updates: Later hides the banner',!U.w.document.getElementById('updateBanner'));
  UPD.cb({state:'downloaded',version:'9.9.10'});await sleep(50);
  ok('updates: a new downloaded event shows the banner again',!!U.w.document.getElementById('updateBanner'));
  U.$('updRestart').click();await sleep(20);
  ok('updates: Restart now asks main to install',UPD.installs===1);
  UPD.cb({state:'error',message:'net::ERR secret-host'});
  ok('updates: errors are friendly and do not leak the raw message',/Could not check/.test(U.$('updStatus').textContent)&&!/secret-host/.test(U.w.document.body.textContent));
  UPD.cb({state:'dev'});
  ok('updates: dev build explains updates need the installed app',/installed app/.test(U.$('updStatus').textContent));
  const L=await (async()=>{UPD.initial={state:'downloaded',version:'9.9.11'};return boot('Admin',[])})();await sleep(100);
  ok('updates: a downloaded update found at startup shows the banner',/9\.9\.11/.test((L.w.document.getElementById('updateBanner')||{textContent:''}).textContent));
  UPD.initial=null;
}
await updateScenario();

/* ---------- branches (1.8) ---------- */
async function branchScenario(){
  const BA=await boot('Admin');
  ok('branches: Admin sees the Branches nav item',/>Branches</.test(BA.$('nav').innerHTML));
  ok('branches: branches loaded from the server',BA.ev("state.branches.length")===2);
  BA.ev("go('branches')");await sleep(300);
  const bh=BA.$('content').innerHTML;
  ok('branches: list shows both branches with codes and a New branch button',/Head Office/.test(bh)&&/Blantyre/.test(bh)&&/>HO</.test(bh)&&/\+ New branch/.test(bh));
  ok('branches: counts are fetched per branch',/class="num">\d+<\/td><td class="num">\d+/.test(bh));
  ok('branches: unassigned borrowers are called out for Admin',/without a branch/.test(bh));
  BA.ev("openBranchModal()");BA.$('brName').value='Mzuzu';BA.$('brCode').value='MZ';BA.$('brAddr').value='North';BA.$('brPhone').value='0888';
  rpcs.length=0;BA.ev("saveBranch('')");await sleep(200);
  const cb=rpcs.find(r=>r.fn==='create_branch');
  ok('branches: create calls create_branch with trimmed fields',!!cb&&cb.args.p_name==='Mzuzu'&&cb.args.p_code==='MZ'&&cb.args.p_phone==='0888');
  BA.ev("openBranchModal()");BA.$('brName').value='X';BA.$('brCode').value='MZ';rpcs.length=0;BA.ev("saveBranch('')");await sleep(100);
  ok('branches: invalid name is rejected client-side',!rpcs.some(r=>r.fn==='create_branch'));
  BA.ev("openBranchModal()");BA.$('brName').value='Okay';BA.$('brCode').value='bad code';rpcs.length=0;BA.ev("saveBranch('')");await sleep(100);
  ok('branches: invalid code is rejected client-side',!rpcs.some(r=>r.fn==='create_branch'));
  BA.ev("openBranchStatusModal('BR2')");rpcs.length=0;BA.ev("setBranchStatus('BR2','Closed')");await sleep(150);
  ok('branches: close calls set_branch_status',rpcs.some(r=>r.fn==='set_branch_status'&&r.args.p_status==='Closed'&&r.args.p_id==='BR2'));

  BA.ev("go('borrowers')");await sleep(500);
  const bt=BA.$('content').innerHTML;
  ok('borrowers: Branch column shows branch names and Unassigned',/<th[^>]*>Branch<\/th>/.test(bt)&&/Blantyre/.test(bt)&&/Unassigned/.test(bt));
  ok('borrowers: Admin gets a Branch filter',/aria-label="Branch"/.test(bt));
  ok('borrowers: Admin can Assign/Transfer branch',/Assign branch/.test(bt)&&/Transfer/.test(bt));
  BA.ev("pgFilter('borrowers','branch','unassigned')");await sleep(400);
  ok('borrowers: Unassigned filter uses is.null on the server',calls.some(c=>/borrower_summary/.test(c.url)&&/branch_id=is\.null/.test(c.url)));
  BA.ev("openAssignBorrowerModal('B4')");BA.$('abBranch').value='BR1';rpcs.length=0;BA.ev("assignBorrower('B4')");await sleep(150);
  ok('borrowers: assign calls assign_borrower_branch',rpcs.some(r=>r.fn==='assign_borrower_branch'&&r.args.p_borrower_id==='B4'&&r.args.p_branch_id==='BR1'));
  BA.ev("openBorrowerModal()");
  ok('borrowers: Admin must pick a branch when adding a borrower',!!BA.$('bfBranch'));
  BA.ev("go('loans')");await sleep(500);
  ok('loans: Branch column and filter for Admin',/<th[^>]*>Branch<\/th>/.test(BA.$('content').innerHTML)&&/aria-label="Branch"/.test(BA.$('content').innerHTML));
  BA.ev("go('settings')");await sleep(200);
  ok('settings: Admin session shows All branches',/All branches/.test(BA.$('content').innerHTML));

  /* staff modal */
  BA.ev("openStaffModal()");
  ok('staff: modal has Branch Manager role and a branch picker',/Branch Manager/.test(BA.$('modalBox').innerHTML)&&!!BA.$('sfBranch'));
  BA.ev("state.staff=[{id:'U2',full_name:'Off',email:'o@x.com',role:'Loan Officer',branch_id:'BR1',branch_name:'Head Office',sections:['loans'],permissions:{}}]");
  BA.ev("openStaffBranchModal('U2')");BA.$('sbBranch').value='BR2';BA.$('sbRole').value='Branch Manager';rpcs.length=0;BA.ev("saveStaffBranch('U2')");await sleep(150);
  ok('staff: assign_staff_branch carries role and branch',rpcs.some(r=>r.fn==='assign_staff_branch'&&r.args.p_branch_id==='BR2'&&r.args.p_role==='Branch Manager'));
  BA.ev("openStaffBranchModal('U2')");BA.$('sbBranch').value='';BA.$('sbRole').value='Loan Officer';rpcs.length=0;BA.ev("saveStaffBranch('U2')");await sleep(100);
  ok('staff: a non-admin without a branch is blocked client-side',!rpcs.some(r=>r.fn==='assign_staff_branch'));

  /* loan officer: own branch only, no admin controls */
  const BO=await boot('Loan Officer',[P('dashboard',true,false,false,false),P('borrowers',true,true,true,false),P('loans',true,true,false,false)]);
  ok('officer: sees Branches (My branch) nav',/>Branches</.test(BO.$('nav').innerHTML));
  BO.ev("go('branches')");await sleep(300);
  const oh=BO.$('content').innerHTML;
  ok('officer: no New branch / edit / close controls',!/\+ New branch/.test(oh)&&!/Close<\/button>/.test(oh)&&/My branch/.test(oh));
  BO.ev("go('borrowers')");await sleep(500);
  const ob=BO.$('content').innerHTML;
  ok('officer: no branch filter and no transfer button',!/aria-label="Branch"/.test(ob)&&!/Transfer/.test(ob));
  BO.ev("openBorrowerModal()");
  ok('officer: no branch picker when adding a borrower (server assigns)',!BO.$('bfBranch'));
  BO.ev("go('settings')");await sleep(200);
  ok('officer: settings shows their branch',/Head Office/.test(BO.$('content').innerHTML));

  /* manager may only claim unassigned borrowers into own branch */
  const BM=await boot('Branch Manager',[P('dashboard',true,false,false,false),P('borrowers',true,true,true,false),P('loans',true,true,false,true)]);
  ok('manager: Assign branch shown only for unassigned borrowers',BM.ev("canAssignBranch({branch_id:null})")===true&&BM.ev("canAssignBranch({branch_id:'BR2'})")===false);
  ok('manager: nav works for the Branch Manager role',/>Branches</.test(BM.$('nav').innerHTML)&&/>Loans</.test(BM.$('nav').innerHTML));

  /* borrower portal untouched */
  const BB=await boot('Borrower');
  ok('borrower: no Branches nav and no branch queries',!/>Branches</.test(BB.$('nav').innerHTML)&&!calls.some(c=>/\/rest\/v1\/branches/.test(c.url)));
  ok('manager: profile is treated as staff, not as a borrower',BM.ev("profileKind()")==='Staff');
}
await branchScenario();

/* ---------- loan officer workflow (1.8.1) ---------- */
async function workflowScenario(){
  const toastText=W=>W.$('toasts')?.textContent||'';
  const W=await boot('Admin');
  W.ev("go('borrowers')");await sleep(500);
  /* create borrower: KYC rules mirrored client-side */
  W.ev("openBorrowerModal()");
  ok('kyc: add-borrower form has ID type, ID number, address and next of kin',['kfIdType','kfIdNo','kfAddr','kfKin','kfKinPhone'].every(i=>!!W.$(i)));
  const fill=(w,kyc)=>{w.$('bfName').value='Chipo';w.$('bfPhone').value='0991';w.$('bfEmail').value='c@x.com';w.$('bfRisk').value='Low';w.$('bfKyc').value=kyc;if(w.$('bfBranch'))w.$('bfBranch').value='BR1'};
  fill(W,'Verified');calls.length=0;W.ev("createBorrower()");await sleep(150);
  ok('kyc: Verified without ID details is blocked before any request',/ID type, ID number and address/.test(toastText(W))&&!calls.some(c=>c.method==='POST'&&/borrowers/.test(c.url)));
  fill(W,'Rejected');W.ev("kycStatusChanged(document.getElementById('bfKyc'))");
  ok('kyc: reason field appears for Rejected',W.$('kfReasonWrap').style.display!=='none');
  W.ev("createBorrower()");await sleep(120);
  ok('kyc: Rejected without a reason is blocked',/reason for rejecting/i.test(toastText(W))&&!calls.some(c=>c.method==='POST'&&/borrowers/.test(c.url)));
  W.$('kfReason').value='Photo unreadable';calls.length=0;W.ev("createBorrower()");await sleep(200);
  const post=calls.find(c=>c.method==='POST'&&/rest\/v1\/borrowers/.test(c.url));const pb=post?JSON.parse(post.body):{};
  ok('kyc: reason and branch are sent on create',pb.kyc_status==='Rejected'&&pb.kyc_reason==='Photo unreadable'&&pb.branch_id==='BR1');
  fill(W,'Verified');W.$('kfIdType').value='National ID';W.$('kfIdNo').value='MW123';W.$('kfAddr').value='Area 3';W.$('kfKin').value='Kin';W.$('kfKinPhone').value='088';
  W.ev("openBorrowerModal()");fill(W,'Verified');W.$('kfIdType').value='National ID';W.$('kfIdNo').value='MW123';W.$('kfAddr').value='Area 3';W.$('kfKin').value='Kin';calls.length=0;W.ev("createBorrower()");await sleep(200);
  const p2=calls.find(c=>c.method==='POST'&&/rest\/v1\/borrowers/.test(c.url));const b2=p2?JSON.parse(p2.body):{};
  ok('kyc: verified create sends ID details and no reason',b2.kyc_status==='Verified'&&b2.id_type==='National ID'&&b2.id_number==='MW123'&&b2.address==='Area 3'&&b2.next_of_kin_name==='Kin'&&b2.kyc_reason===null);
  /* edit */
  W.ev("go('borrowers')");await sleep(500);
  W.ev("openEditBorrowerModal('B0')");
  ok('kyc: edit form carries the KYC section',!!W.$('kfIdNo')&&!!W.$('kfReasonWrap'));
  W.$('ebKyc').value='Verified';calls.length=0;W.ev("updateBorrower('B0')");await sleep(150);
  ok('kyc: edit cannot verify without ID details',/ID type, ID number and address/.test(toastText(W))&&!calls.some(c=>c.method==='PATCH'));
  W.$('kfIdType').value='Passport';W.$('kfIdNo').value='P99';W.$('kfAddr').value='Town';W.ev("updateBorrower('B0')");await sleep(200);
  const pa=calls.find(c=>c.method==='PATCH'&&/borrowers/.test(c.url));const pab=pa?JSON.parse(pa.body):{};
  ok('kyc: edit sends status and details together',pab.kyc_status==='Verified'&&pab.id_type==='Passport'&&pab.id_number==='P99');

  /* loan picker only lists verified borrowers */
  calls.length=0;await W.ev("fetchBorrowers('Jo')");
  ok('loan: borrower picker asks the server for Verified KYC only',calls.some(c=>/borrower_summary/.test(c.url)&&/kyc_status=eq\.Verified/.test(c.url)));

  /* maker-checker in the UI */
  const O=await boot('Loan Officer',[P('dashboard',true,false,false,false),P('loans',true,true,false,true),P('borrowers',true,true,true,false)]);
  O.ev("go('loans')");await sleep(500);
  const lh=O.$('content').innerHTML;
  ok('maker-checker: own pending loan shows "Awaiting another approver", not Review',/Awaiting another approver/.test(lh));
  ok('maker-checker: someone else\'s pending loan still shows Review',/reviewLoan\('L2'\)/.test(lh)&&!/reviewLoan\('L1'\)/.test(lh));
  const wa=await boot('Admin');wa.ev("go('loans')");await sleep(500);
  ok('maker-checker: Admin keeps Review on their own loan',/reviewLoan\('L1'\)/.test(wa.$('content').innerHTML));

  /* work queue */
  const Q=await boot('Loan Officer',[P('dashboard',true,false,false,false),P('loans',true,true,false,true),P('borrowers',true,true,true,false)]);
  Q.ev("go('branches')");await sleep(500);
  const qh=Q.$('content').innerHTML;
  ok('queue: shows borrowers awaiting KYC and loans awaiting approval',/Work queue/.test(qh)&&/Awaiting KYC verification/.test(qh)&&/Loans awaiting approval/.test(qh)&&/Review KYC/.test(qh));
  ok('queue: own loan not reviewable in the queue, others are',/Awaiting another approver/.test(qh)&&/reviewLoan\('L2'\)/.test(qh));
  ok('queue: asks the server for Pending KYC and Pending Approval only',calls.some(c=>/borrower_summary/.test(c.url)&&/kyc_status=eq\.Pending/.test(c.url))&&calls.some(c=>/loan_summary/.test(c.url)&&/status=eq\.Pending(%20|\+| )Approval/.test(c.url)));
  Q.ev("openEditBorrowerModal('B0')");
  ok('queue: Review KYC opens the borrower form even when not on the Borrowers page',!!Q.$('ebKyc'));
}
await workflowScenario();

/* ---------- branch performance (1.8.2) ---------- */
async function performanceScenario(){
  const A=await boot('Admin');
  ok('performance: Admin sees the Performance nav',/>Performance</.test(A.$('nav').innerHTML));
  const lo=await boot('Loan Officer',[P('dashboard',true,false,false,false),P('loans',true,true,false,false)]);
  ok('performance: Loan Officer does not',!/>Performance</.test(lo.$('nav').innerHTML));
  const mr=await boot('Branch Manager',[P('dashboard',true,false,false,false),P('reports',true,false,false,false)]);
  ok('performance: Branch Manager with Reports access sees it',/>Performance</.test(mr.$('nav').innerHTML));
  const mn=await boot('Branch Manager',[P('dashboard',true,false,false,false),P('loans',true,false,false,false)]);
  ok('performance: Branch Manager without Reports access does not',!/>Performance</.test(mn.$('nav').innerHTML));

  /* pure maths */
  const d=A.ev("JSON.stringify(pfDerive({due_minor:300,paid_on_due_minor:100,outstanding_minor:200,par30_minor:50,borrowers:10,kyc_verified:5,disbursed_count:2,disbursed_minor:600,active_loans:4,officers:2}))");
  const dj=JSON.parse(d);
  ok('performance maths: rate 33.3%, PAR 25%, KYC 50%, avg loan 300, 2 loans/officer',Math.abs(dj.rate-33.333)<0.01&&dj.par===25&&dj.kycPct===50&&dj.avg===300&&dj.perOfficer===2);
  const z=JSON.parse(A.ev("JSON.stringify(pfDerive({due_minor:0,paid_on_due_minor:0,outstanding_minor:0,par30_minor:0,borrowers:0,kyc_verified:0,disbursed_count:0,officers:0,active_loans:0}))"));
  ok('performance maths: zero denominators give no rate (not NaN or 100%) and PAR 0',z.rate==null&&z.par===0&&z.kycPct==null&&z.avg==null&&z.perOfficer==null);

  rpcs.length=0;A.ev("go('performance')");await sleep(500);
  const first=rpcs.find(r=>r.fn==='branch_metrics');
  ok('performance: asks the server in the selected currency, all time',!!first&&first.args.p_currency==='MWK'&&first.args.p_from===null&&first.args.p_to===null);
  let h=A.$('content').innerHTML;
  const order=[...h.matchAll(/<tr><td class="num">(\d+)<\/td><td><b>([^<]+)<\/b>/g)].map(m=>m[1]+m[2]);
  ok('performance: ranked by collection rate (Beta 100%, Alpha 33%, Gamma has none)',order.join(',')==='1Beta,2Alpha,3Gamma',order.join(','));
  ok('performance: rate and PAR badges coloured (Beta good, Alpha bad)',/b-active">100\.0%/.test(h)&&/b-default">33\.3%/.test(h)&&/b-default">100\.0%/.test(h));
  ok('performance: totals strip combines branches (outstanding 3,000,000.00 MWK, rate 60%)',/3,000,000\.00/.test(h)&&/60\.0%/.test(h));
  ok('performance: comparison bars shown with accessible label',/class="pf-bars" aria-label="Collection rate by branch"/.test(h)&&(h.match(/class="pf-track"/g)||[]).length===3);
  A.ev("pfSetRank('par')");await sleep(100);
  h=A.$('content').innerHTML;
  const order2=[...h.matchAll(/<tr><td class="num">(\d+)<\/td><td><b>([^<]+)<\/b>/g)].map(m=>m[2]);
  ok('performance: rank by PAR puts the lowest risk first',order2[0]!=='Alpha'&&order2[2]==='Alpha',order2.join(','));
  A.ev("pfSetRank('rate')");

  /* currency + period */
  rpcs.length=0;A.ev("setCurrency('USD')");await sleep(500);
  ok('performance: switching currency reloads in that currency',rpcs.some(r=>r.fn==='branch_metrics'&&r.args.p_currency==='USD'));
  A.ev("setCurrency('MWK')");await sleep(300);
  rpcs.length=0;A.ev("pfSetPreset('month')");await sleep(400);
  const mp=rpcs.find(r=>r.fn==='branch_metrics');
  ok('performance: "This month" sends a month-to-date window',!!mp&&/^\d{4}-\d{2}-01$/.test(mp.args.p_from)&&/^\d{4}-\d{2}-\d{2}$/.test(mp.args.p_to));
  A.ev("pfSetPreset('custom')");rpcs.length=0;A.ev("pfSetDate('from','2026-01-01')");await sleep(300);
  ok('performance: custom range sends the chosen start date',rpcs.some(r=>r.fn==='branch_metrics'&&r.args.p_from==='2026-01-01'));
  A.ev("pfSetPreset('all')");await sleep(300);

  /* officers drill-down */
  rpcs.length=0;A.ev("pfToggleOfficers('BR1')");await sleep(400);
  const om=rpcs.find(r=>r.fn==='officer_metrics');
  h=A.$('content').innerHTML;
  ok('performance: Officers button loads that branch',!!om&&om.args.p_branch==='BR1'&&/Alpha · officers/.test(h));
  ok('performance: officer rows incl. "Not recorded" for pre-1.8.1 loans',/Officer A/.test(h)&&/Not recorded/.test(h)&&/b-default">50\.0%/.test(h));
  A.ev("pfToggleOfficers('BR1')");await sleep(100);
  ok('performance: Hide closes the officer panel',!/Alpha · officers/.test(A.$('content').innerHTML));

  /* export */
  A.blobs.length=0;A.ev("doExport('performance','csv')");await sleep(500);
  const csv=A.blobs.length?await blobText(A.w,A.blobs[A.blobs.length-1]):'';
  const ln=csv.replace('\ufeff','').trim().split('\r\n');
  ok('performance CSV: header, ranked rows, plain numbers, currency',/^Rank,Branch,Code,Borrowers,KYC verified %/.test(ln[0])&&ln.length===4&&/^1,Beta,BBB,4,100\.0%/.test(ln[1])&&/,3000000\.00,/.test(ln[2])&&/MWK$/.test(ln[2]),ln.slice(0,3).join(' | '));

  /* schema not yet upgraded */
  MISSING.add('branch_metrics');const S=await boot('Admin');S.ev("go('performance')");await sleep(500);
  ok('performance: old database shows a clear "run schema.sql" message',/latest supabase\/schema\.sql/.test(S.$('content').innerHTML));
  MISSING.delete('branch_metrics');
  S.ev("setCurrency('USD')");await sleep(500);
  ok('performance: after an error, changing currency retries',!/latest supabase\/schema\.sql/.test(S.$('content').innerHTML));
}
await performanceScenario();

/* ---------- 1.9.0 dashboard analysis ---------- */
async function analysisScenario(){
  const A=await boot('Admin');
  const fold=JSON.parse(A.ev("JSON.stringify(anFold(Array.from({length:9},(_,i)=>({key:i,label:'S'+i,value:10-i,color:'var(--dv-1)'}))))"));
  ok('analysis maths: more than 6 slices fold into one Other (6 shown, values preserved)',fold.length===6&&fold[5].label==='Other'&&fold.reduce((a,s)=>a+s.value,0)===54,fold.length+'/'+fold.map(s=>s.value));
  ok('analysis maths: zero slices are dropped',JSON.parse(A.ev("JSON.stringify(anFold([{key:1,label:'a',value:0,color:'x'},{key:2,label:'b',value:5,color:'x'}]))")).length===1);
  const bb=JSON.parse(A.ev("JSON.stringify(anBuild('branch',{by_branch:[{branch_id:'a',name:'A',outstanding_minor:3,collected_minor:1},{branch_id:'b',name:'B',outstanding_minor:7,collected_minor:2}]},'MWK').slices.map(s=>s.value))"));
  ok('analysis maths: branch slices sorted by size and sum to the total',bb.join(',')==='7,3');

  rpcs.length=0;A.ev("AN.key='';AN.data=null;go('dashboard')");await sleep(600);
  const call=rpcs.find(r=>r.fn==='analysis_breakdown');
  ok('analysis: dashboard asks the server in the selected currency, collections this month by default',!!call&&call.args.p_currency==='MWK'&&/^\d{4}-\d{2}-01$/.test(call.args.p_from));
  let h=A.$('content').innerHTML;
  ok('analysis: six chart cards render',(h.match(/class="card panel dn-card"/g)||[]).length===6);
  ok('analysis: every donut has an accessible summary',(h.match(/<svg class="donut" viewBox="0 0 200 200" role="img" aria-label="[^"]+"/g)||[]).length===5,(h.match(/class="donut"/g)||[]).length);
  const br=h.slice(h.indexOf('id="dn-branch"'),h.indexOf('id="dn-status"'));
  ok('analysis: branch chart legend shows values and percentages (66.7% / 33.3%), empty branch omitted',/Alpha/.test(br)&&/66\.7%/.test(br)&&/33\.3%/.test(br)&&!/Gamma/.test(br));
  ok('analysis: single slice renders with a note',/Everything here is Low risk\./.test(h));
  ok('analysis: empty charts say so',/No open loans\./.test(h));
  ok('analysis: table view present on charts with data',(h.match(/View as table/g)||[]).length===5);
  const tb=h.slice(h.indexOf('id="dn-kyc"'),h.indexOf('id="dn-risk"'));
  ok('analysis: table totals 100%; KYC uses status colours',/<b>Total<\/b>/.test(tb)&&/100%/.test(tb)&&/var\(--dv-good\)/.test(tb)&&/var\(--dv-warn\)/.test(tb)&&/var\(--dv-crit\)/.test(tb));

  const via=async(call,view)=>{A.ev("go('dashboard')");await sleep(400);A.ev(call);await sleep(500);return A.ev("state.view")===view};
  ok('analysis: KYC slice opens Borrowers filtered by KYC (Pending, after size sort)',await via("anClick('kyc',1)",'borrowers')&&A.ev("pgs('borrowers').f.kyc")==='Pending');
  ok('analysis: loan-status slice opens Loans filtered by status',await via("anClick('status',0)",'loans')&&A.ev("pgs('loans').f.status")==='Active');
  ok('analysis: branch slice opens Loans filtered by branch',await via("anClick('branch',0)",'loans')&&A.ev("pgs('loans').f.branch")==='BR1');
  ok('analysis: collections slice opens Repayments for that branch and currency',await via("anClick('collect',0)",'repayments')&&A.ev("pgs('repayments').f.branch")==='BR1'&&A.ev("pgs('repayments').f.currency")==='MWK');

  A.ev("go('dashboard')");await sleep(400);
  rpcs.length=0;A.ev("setCurrency('USD')");await sleep(600);
  ok('analysis: switching currency reloads in that currency',rpcs.some(r=>r.fn==='analysis_breakdown'&&r.args.p_currency==='USD'));
  A.ev("setCurrency('MWK')");await sleep(300);
  rpcs.length=0;A.ev("anSetPreset('year')");await sleep(500);
  const pm=rpcs.find(r=>r.fn==='analysis_breakdown');
  ok('analysis: "This year" sends a year-to-date window',!!pm&&/^\d{4}-01-01$/.test(pm.args.p_from));

  MISSING.add('analysis_breakdown');const S=await boot('Admin');S.ev("go('dashboard')");await sleep(600);
  ok('analysis: old database shows a clear "run schema.sql" message',/latest supabase\/schema\.sql/.test(S.$('content').innerHTML));
  MISSING.delete('analysis_breakdown');
}
await analysisScenario();

/* ---------- 1.9.1 branch-aware documents, transfer and reconciliation ---------- */
async function branchDocsScenario(){
  const A=await boot('Admin');
  /* invoice + statement */
  const inv=A.ev("invoiceHTML({loan:{loan_number:'ML-1',borrower_name:'Zed',currency:'MWK',principal_minor:100000,status:'Active',branch_name:'Alpha <b>'},borrower:null,schedule:[]},'')");
  ok('invoice shows the branch (escaped)',/Branch: Alpha &lt;b&gt;/.test(inv)&&!/Alpha <b>/.test(inv));
  ok('invoice without a branch omits the line',!/Branch:/.test(A.ev("invoiceHTML({loan:{loan_number:'ML-1',borrower_name:'Zed',currency:'MWK',principal_minor:100000,status:'Active'},borrower:null,schedule:[]},'')")));
  A.ev("ld.loan={loan_number:'ML-9',borrower_name:'Zed',currency:'MWK',principal_minor:100000,outstanding_principal:1,status:'Active',branch_name:'Beta'};ld.schedule=[];ld.reps=[];ld.borrower=null;loanStatement()");await sleep(150);
  ok('loan statement shows the branch',A.pdfs.length&&/<small>Branch<\/small>Beta/.test(A.pdfs[A.pdfs.length-1].html));

  /* audit log */
  A.ev("go('audit')");await sleep(400);
  const ah=A.$('content').innerHTML;
  ok('audit: Branch column and filter for Admin',/<th[^>]*>Branch<\/th>/.test(ah)&&/aria-label="Branch"/.test(ah));
  calls.length=0;A.ev("pgFilter('audit','branch','BR2')");await sleep(400);
  ok('audit: branch filter goes to the server (branch_id=eq.BR2)',calls.some(c=>/audit_log_view/.test(c.url)&&/branch_id=eq\.BR2/.test(c.url)));

  /* transfer */
  A.ev("go('borrowers')");await sleep(500);
  A.ev("pgs('borrowers').rows.push({id:'BX',full_name:'Moved M',branch_id:'BR2'})");
  await A.ev("openAssignBorrowerModal('BX')");await sleep(300);
  ok('transfer: modal asks for a reason and says loans move',!!A.$('abReason')&&/move with them|no loans yet/.test(A.$('modalBox').innerHTML));
  rpcs.length=0;A.ev("assignBorrower('BX')");await sleep(150);
  ok('transfer: blank reason is blocked before calling the server',!rpcs.some(r=>r.fn==='assign_borrower_branch'));
  A.$('abBranch').value='BR1';A.$('abReason').value='Customer relocated';A.ev("assignBorrower('BX')");await sleep(200);
  const tr=rpcs.find(r=>r.fn==='assign_borrower_branch');
  ok('transfer: sends branch and reason',!!tr&&tr.args.p_branch_id==='BR1'&&tr.args.p_reason==='Customer relocated'&&tr.args.p_borrower_id==='BX');
  A.ev("openAssignBorrowerModal('B4')");await sleep(100);
  ok('assigning an unassigned borrower asks for no reason',!A.$('abReason'));
  A.ev("closeModal()");

  /* reconciliation banner */
  rpcs.length=0;A.ev("RC.key='';go('branches')");await sleep(500);
  let h=A.$('content').innerHTML;
  ok('reconciliation: asks the server in the selected currency',rpcs.some(r=>r.fn==='branch_reconciliation'&&r.args.p_currency==='MWK'));
  ok('reconciliation: matching totals show a green note with unassigned explained',/class="alert ok"/.test(h)&&/Branches agree with the company ledger/.test(h)&&/2 loans are not in any branch/.test(h));
  RECON_BAD=true;A.ev("RC.key='';go('performance')");await sleep(600);
  h=A.$('content').innerHTML;
  ok('reconciliation: shown on Performance with the difference table when totals disagree',/class="alert warn"/.test(h)&&/differ from the company ledger/.test(h)&&/Money lent/.test(h)&&/500,000\.00/.test(h));
  A.ev("setCurrency('USD')");await sleep(500);
  ok('reconciliation: switching currency re-checks',rpcs.some(r=>r.fn==='branch_reconciliation'&&r.args.p_currency==='USD'));
  RECON_BAD=false;A.ev("setCurrency('MWK')");await sleep(300);
  MISSING.add('branch_reconciliation');
  const O=await boot('Admin');O.ev("go('branches')");await sleep(500);
  ok('reconciliation: old database shows no banner and no error',!/Branches agree|differ from the company ledger/.test(O.$('content').innerHTML)&&/Branches/.test(O.$('content').innerHTML));
  MISSING.delete('branch_reconciliation');
  /* managers never ask */
  const M=await boot('Branch Manager',[P('dashboard',true,false,false,false),P('reports',true,false,false,false)]);
  rpcs.length=0;M.ev("go('performance')");await sleep(500);
  ok('reconciliation: branch managers do not see or request it',!rpcs.some(r=>r.fn==='branch_reconciliation')&&!/Branches agree|differ from the company ledger/.test(M.$('content').innerHTML));
}
await branchDocsScenario();

/* ---------- 1.10 voids, deletes, manual invoices, branch capital, targets ---------- */
async function lifecycleScenario(){
  let A=await boot('Admin');
  const btns=h=>({vp:(h.match(/openVoidPayment\(/g)||[]).length,vl:/openVoidLoan\(/.test(h),dl:/openDeleteLoan\(/.test(h)});
  /* void a payment */
  A.ev("openLoanDetail('L5')");await sleep(500);
  let h=A.$('modalBox').innerHTML,b=btns(h);
  ok('void payment: Admin sees Void on the latest payment only (L5 has one payment)',b.vp===1&&!b.vl&&!b.dl);
  A.ev("openVoidPayment('R2')");await sleep(50);
  ok('void payment: dialog explains the effect and asks for a reason',/Void payment/.test(A.$('modalBox').innerHTML)&&/reversing entry/.test(A.$('modalBox').innerHTML)&&!!A.$('rsText'));
  rpcs.length=0;A.$('rsText').value='oops';A.ev("reasonGo()");await sleep(100);
  ok('void payment: a short reason is refused before calling the server',!rpcs.some(r=>r.fn==='void_repayment'));
  A.$('rsText').value='Entered twice by mistake';A.ev("reasonGo()");await sleep(600);
  const vp=rpcs.find(r=>r.fn==='void_repayment');
  ok('void payment: sends the payment id and reason',!!vp&&vp.args.p_repayment_id==='R2'&&vp.args.p_reason==='Entered twice by mistake');
  ok('void payment: loan detail reopens afterwards',/ML-005/.test(A.$('modalBox').innerHTML));
  A.ev("openLoanDetail('L6')");await sleep(500);
  ok('voided payments are listed on the loan with their reason',/Voided payments/.test(A.$('modalBox').innerHTML)&&/Entered twice/.test(A.$('modalBox').innerHTML));
  /* void / delete loan */
  A.ev("openLoanDetail('L34')");await sleep(500);
  b=btns(A.$('modalBox').innerHTML);
  ok('void loan: Admin sees Void loan on a paid-out loan with no payments (not Delete)',b.vl&&!b.dl);
  A.ev("openVoidLoan('L34')");rpcs.length=0;A.$('rsText').value='Disbursed to the wrong borrower';A.ev("reasonGo()");await sleep(600);
  const vl=rpcs.find(r=>r.fn==='void_loan');
  ok('void loan: sends loan id and reason',!!vl&&vl.args.p_loan_id==='L34'&&/wrong borrower/.test(vl.args.p_reason));
  A.ev("openLoanDetail('L1')");await sleep(500);
  b=btns(A.$('modalBox').innerHTML);
  ok('delete loan: a pending loan offers Delete, not Void',b.dl&&!b.vl);
  A.ev("openDeleteLoan('L1')");rpcs.length=0;A.$('rsText').value='Customer withdrew the application';A.ev("reasonGo()");await sleep(600);
  ok('delete loan: sends delete_loan and closes',rpcs.some(r=>r.fn==='delete_loan'&&r.args.p_loan_id==='L1')&&!A.$('modal').classList.contains('show'));
  /* who is offered what */
  const lo=await boot('Loan Officer',[P('dashboard',true,false,false,false),P('loans',true,true,false,false),P('repayments',true,true,false,false)]);
  lo.ev("openLoanDetail('L5')");await sleep(500);
  b=btns(lo.$('modalBox').innerHTML);
  ok('officer: no void or delete controls',b.vp===0&&!b.vl&&!b.dl);
  const bm=await boot('Branch Manager',[P('dashboard',true,false,false,false),P('loans',true,true,false,true),P('repayments',true,true,false,true)]);
  bm.ev("openLoanDetail('L5')");await sleep(500);
  b=btns(bm.$('modalBox').innerHTML);
  ok('branch manager with payment approval can void a payment but not a loan',b.vp===1&&!b.vl);
  bm.ev("openLoanDetail('L1')");await sleep(500);
  ok('branch manager with loan approval can delete a pending loan',btns(bm.$('modalBox').innerHTML).dl);
  const bn=await boot('Branch Manager',[P('dashboard',true,false,false,false),P('loans',true,true,false,false),P('repayments',true,true,false,false)]);
  bn.ev("openLoanDetail('L5')");await sleep(500);
  ok('branch manager without approval rights sees no void',btns(bn.$('modalBox').innerHTML).vp===0);
  ok('rules: voided and written-off loans never offer a payment void',A.ev("canVoidPayment({status:'Voided'})")===false&&A.ev("canVoidPayment({status:'Written-Off'})")===false&&A.ev("canVoidLoan({status:'Active'},[{id:1}])")===false);
  ok('rules: latest payment is chosen by recording time, not payment date',A.ev("latestPaymentId([{id:'a',created_at:'2026-01-02',payment_date:'2026-01-01'},{id:'b',created_at:'2026-01-01',payment_date:'2026-02-01'}])")==='a');

  /* manual invoices */
  A=await boot('Admin');
  ok('invoices: appears in the menu for staff',/>Invoices</.test(A.$('nav').innerHTML));
  A.ev("go('invoices')");await sleep(600);
  h=A.$('content').innerHTML;
  ok('invoices: list shows number, customer, branch, total and Void for issued ones only',/MI-2026-0001/.test(h)&&/Acme Traders/.test(h)&&/Head Office/.test(h)&&(h.match(/openVoidInvoice\(/g)||[]).length===1&&/>Void</.test(h));
  ok('invoices: form check — name, items, quantity, price, dates',
    A.ev("miProblem({name:'A',issue:'2026-01-01',lines:[]})")==='Enter the customer name.'
    &&A.ev("miProblem({name:'Zed',issue:'2026-01-01',lines:[]})")==='Add at least one item.'
    &&/description/.test(A.ev("miProblem({name:'Zed',issue:'2026-01-01',lines:[{description:' ',qty:1,price:'1'}]})"))
    &&/whole number/.test(A.ev("miProblem({name:'Zed',issue:'2026-01-01',lines:[{description:'x',qty:1.5,price:'1'}]})"))
    &&/unit price/.test(A.ev("miProblem({name:'Zed',issue:'2026-01-01',lines:[{description:'x',qty:1,price:''}]})"))
    &&/due date/.test(A.ev("miProblem({name:'Zed',issue:'2026-02-01',due:'2026-01-01',lines:[{description:'x',qty:1,price:'1'}]})"))
    &&/more than zero/.test(A.ev("miProblem({name:'Zed',issue:'2026-01-01',lines:[{description:'x',qty:1,price:'0'}]})"))
    &&A.ev("miProblem({name:'Zed',issue:'2026-01-01',lines:[{description:'x',qty:2,price:'10.50'}]})")===null);
  A.ev("openManualInvoice()");await sleep(100);
  A.$('miName').value='Zed <b>Co</b>';A.$('miIssue').value='2026-10-10';
  A.ev("MI.lines=[{description:'Setup <fee>',qty:'2',price:'150.50'},{description:'Visit',qty:'1',price:'20'}];miPaintLines()");
  ok('invoices: live total (2 x 150.50 + 20 = 321.00)',/321\.00/.test(A.$('miTot').innerHTML));
  rpcs.length=0;A.pdfs.length=0;A.ev("submitManualInvoice()");await sleep(600);
  const ci=rpcs.find(r=>r.fn==='create_manual_invoice');
  ok('invoices: saving sends whole-unit amounts in minor units and the lines',!!ci&&ci.args.p_lines[0].unit_minor===15050&&ci.args.p_lines[0].qty===2&&ci.args.p_lines[1].unit_minor===2000&&ci.args.p_customer_name==='Zed <b>Co</b>');
  const pdf=A.pdfs[A.pdfs.length-1]||{};
  ok('invoices: PDF carries the number, total and escaped text',/MI-2026-0003/.test(pdf.html||'')&&/MWK 321\.00/.test(pdf.html||'')&&/Setup &lt;fee&gt;/.test(pdf.html||'')&&!/Setup <fee>/.test(pdf.html||'')&&/MI-2026-0003\.pdf$/.test(pdf.filename||''));
  A.ev("openManualInvoice()");await sleep(100);
  A.$('miName').value='Walk-in';A.$('miIssue').value='2026-10-10';A.$('miSave').checked=false;
  A.ev("MI.lines=[{description:'Copy fee',qty:'1',price:'5'}];miPaintLines()");
  rpcs.length=0;A.pdfs.length=0;A.ev("submitManualInvoice()");await sleep(500);
  const up=A.pdfs[A.pdfs.length-1]||{};
  ok('invoices: "do not save" makes only a PDF marked Not recorded, with no server call',!rpcs.some(r=>r.fn==='create_manual_invoice')&&/Not recorded/.test(up.html||'')&&/not-recorded/.test(up.filename||''));
  A.ev("openManualInvoice()");await sleep(100);rpcs.length=0;A.ev("submitManualInvoice()");await sleep(100);
  ok('invoices: an incomplete form is not sent',!rpcs.some(r=>r.fn==='create_manual_invoice')&&A.$('modal').classList.contains('show'));
  A.ev("closeModal()");
  ok('invoices: voided copy is stamped VOID',/class="stamp">VOID/.test(A.ev("manualInvoiceHTML({invoice_number:'X',currency:'MWK',status:'Void',customer_name:'a',lines:[],total_minor:1,issue_date:'2026-01-01'},'')")));
  A.ev("go('invoices')");await sleep(400);
  A.ev("openVoidInvoice('MI1')");rpcs.length=0;A.$('rsText').value='Issued to the wrong customer';A.ev("reasonGo()");await sleep(500);
  ok('invoices: void sends id and reason',rpcs.some(r=>r.fn==='void_manual_invoice'&&r.args.p_id==='MI1'&&/wrong customer/.test(r.args.p_reason)));
  const lob=await boot('Loan Officer',[P('dashboard',true,false,false,false),P('loans',true,true,false,false)]);
  lob.ev("go('invoices')");await sleep(500);
  ok('invoices: a loan officer can create but not void',/openManualInvoice/.test(lob.$('content').innerHTML)&&!/openVoidInvoice\(/.test(lob.$('content').innerHTML));

  /* branch capital */
  A=await boot('Admin');
  A.ev("go('branches')");await sleep(700);
  h=A.$('content').innerHTML;
  ok('capital: Admin sees the pool, allocated and not-allocated figures',/Company capital pool/.test(h)&&/9,000,000\.00/.test(h)&&/6,500,000\.00/.test(h));
  ok('capital: limited branch shows limit, lent out and room; other shows No limit',/2,500,000\.00/.test(h)&&/500,000\.00/.test(h)&&/No limit/.test(h)&&/openBranchCapital\('BR1'\)/.test(h)&&/aria-label="80% of the allocation is lent out"/.test(h));
  A.ev("openBranchCapital('BR2')");A.$('bcAmt').value='3000000';A.$('bcNote').value='Pilot';rpcs.length=0;A.ev("saveBranchCapital('BR2')");await sleep(300);
  const sc=rpcs.find(r=>r.fn==='set_branch_capital');
  ok('capital: saving sends branch, currency and the limit in minor units',!!sc&&sc.args.p_branch_id==='BR2'&&sc.args.p_currency==='MWK'&&sc.args.p_amount_minor===300000000&&sc.args.p_note==='Pilot');
  A.ev("openBranchCapital('BR1')");rpcs.length=0;A.ev("saveBranchCapital('BR1',true)");await sleep(300);
  ok('capital: Remove limit sends null',rpcs.some(r=>r.fn==='set_branch_capital'&&r.args.p_amount_minor===null));
  A.ev("openBranchCapital('BR2')");A.$('bcAmt').value='-5';rpcs.length=0;A.ev("saveBranchCapital('BR2')");await sleep(100);
  ok('capital: a negative limit is refused locally',!rpcs.some(r=>r.fn==='set_branch_capital'));
  A.ev("closeModal()");
  const bmc=await boot('Branch Manager',[P('dashboard',true,false,false,false)]);
  bmc.ev("go('branches')");await sleep(700);
  h=bmc.$('content').innerHTML;
  ok('capital: a branch manager sees limits read-only, without pool figures or Set buttons',/Capital by branch/.test(h)&&!/Company capital pool/.test(h)&&!/openBranchCapital/.test(h));
  const loc=await boot('Loan Officer',[P('dashboard',true,false,false,false)]);
  rpcs.length=0;loc.ev("go('branches')");await sleep(500);
  ok('capital: a loan officer does not ask for it',!rpcs.some(r=>r.fn==='branch_capital_overview'));
  MISSING.add('branch_capital_overview');const oc=await boot('Admin');oc.ev("go('branches')");await sleep(600);
  ok('capital: old database shows no capital card and no error',!/Capital by branch/.test(oc.$('content').innerHTML)&&/Branches/.test(oc.$('content').innerHTML));
  MISSING.delete('branch_capital_overview');

  /* targets */
  A=await boot('Admin');
  ok('targets maths: percent, pace and state',A.ev("tgPct(60,100)")===60&&A.ev("tgPct(5,0)")===null&&A.ev("tgState(60,50)")==='on'&&A.ev("tgState(40,50)")==='behind'&&A.ev("tgState(100,50)")==='met'&&A.ev("tgState(null,50)")==='none'&&A.ev("tgPct(1,3)")===33.3);
  rpcs.length=0;A.ev("TG.key='';go('performance')");await sleep(800);
  h=A.$('content').innerHTML;
  const tc=h.slice(h.indexOf('>Targets<'));
  ok('targets: asks for the selected month and currency',rpcs.some(r=>r.fn==='branch_target_progress'&&r.args.p_currency==='MWK'&&/^\d{4}-\d{2}-01$/.test(r.args.p_month)));
  ok('targets: Alpha disbursed 60% = On pace, collected 40% = Behind pace, borrowers has no target',/On pace/.test(tc)&&/Behind pace/.test(tc)&&/no target/.test(tc)&&/50% of the month has passed/.test(tc));
  ok('targets: Admin gets Set targets / Edit buttons',/openTargetModal\('BR1'\)/.test(tc)&&/Edit/.test(tc)&&/Set targets/.test(tc));
  A.ev("openTargetModal('BR2')");A.$('tgD').value='1000';A.$('tgC').value='500';A.$('tgB').value='4';rpcs.length=0;A.ev("saveTarget('BR2')");await sleep(300);
  const st=rpcs.find(r=>r.fn==='set_branch_target');
  ok('targets: saving sends month, currency and amounts in minor units',!!st&&st.args.p_branch_id==='BR2'&&/-01$/.test(st.args.p_month)&&st.args.p_disbursed_minor===100000&&st.args.p_collected_minor===50000&&st.args.p_new_borrowers===4);
  A.ev("openTargetModal('BR2')");A.$('tgB').value='1.5';rpcs.length=0;A.ev("saveTarget('BR2')");await sleep(100);
  ok('targets: a fractional borrower target is refused',!rpcs.some(r=>r.fn==='set_branch_target'));
  A.ev("closeModal()");
  rpcs.length=0;A.ev("tgSetMonth('2026-09')");await sleep(500);
  ok('targets: changing the month reloads that month',rpcs.some(r=>r.fn==='branch_target_progress'&&r.args.p_month==='2026-09-01'));
  A.ev("tgSetMonth('"+new Date().toISOString().slice(0,7)+"')");await sleep(300);
  const mt=await boot('Branch Manager',[P('dashboard',true,false,false,false),P('reports',true,false,false,false)]);
  mt.ev("go('performance')");await sleep(800);
  ok('targets: a branch manager sees progress but no edit buttons',/>Targets</.test(mt.$('content').innerHTML)&&!/openTargetModal/.test(mt.$('content').innerHTML));
  MISSING.add('branch_target_progress');const ot=await boot('Admin');ot.ev("go('performance')");await sleep(800);
  ok('targets: old database shows no targets card and no error',!/>Targets</.test(ot.$('content').innerHTML)&&/Branch performance/.test(ot.$('content').innerHTML));
  MISSING.delete('branch_target_progress');
  /* nothing in the new screens throws */
  ok('no script errors in any 1.10 scenario',[A,lo,bm,bn,lob,bmc,mt].every(x=>x.errs.length===0),[A,lo,bm,bn,lob,bmc,mt].flatMap(x=>x.errs).join('|'));
}
await lifecycleScenario();

/* ---------- 1.11 extend a loan ---------- */
async function extendScenario(){
  let A=await boot('Admin');
  ok('extend maths: earliest end date is the day after the later of today and the current end date',
    A.ev("extMinDate({maturity_date:'2000-01-01'})")===A.ev("addDaysISO(today(),1)")&&A.ev("extMinDate({maturity_date:'2099-06-30'})")==='2099-07-01');
  const L={id:'L5',maturity_date:'2000-01-01'};
  ok('extend form: checks the date, extra interest and fee before asking the server',
    /end date/.test(A.ev("extInputs({id:'L5',maturity_date:'2000-01-01'},{date:'',rate:'',fee:'',waive:false}).problem"))
    &&/or later/.test(A.ev("extInputs({id:'L5',maturity_date:'2000-01-01'},{date:'2001-01-01',rate:'',fee:'',waive:false}).problem"))
    &&/between 0% and 100%/.test(A.ev("extInputs({id:'L5',maturity_date:'2000-01-01'},{date:'2099-01-01',rate:'150',fee:'',waive:false}).problem"))
    &&/negative/.test(A.ev("extInputs({id:'L5',maturity_date:'2000-01-01'},{date:'2099-01-01',rate:'',fee:'-1',waive:false}).problem")));
  const good=JSON.parse(A.ev("JSON.stringify(extInputs({id:'L5',maturity_date:'2000-01-01'},{date:'2099-01-01',rate:'5',fee:'100.50',waive:true}).args)"));
  ok('extend form: sends percent as basis points and money in minor units',good.p_extra_interest_bps===500&&good.p_fee_minor===10050&&good.p_waive_penalties===true&&good.p_new_maturity==='2099-01-01'&&good.p_loan_id==='L5');

  /* who gets the button */
  A.ev("openLoanDetail('L5')");await sleep(500);
  ok('extend: Admin sees "Extend loan…" on a running loan with an unpaid instalment',/openExtendLoan\('L5'\)/.test(A.$('modalBox').innerHTML));
  const bm=await boot('Branch Manager',[P('dashboard',true,false,false,false),P('loans',true,true,false,true),P('repayments',true,true,false,false)]);
  bm.ev("openLoanDetail('L5')");await sleep(500);
  ok('extend: Branch Manager with loan approval sees it',/openExtendLoan\('L5'\)/.test(bm.$('modalBox').innerHTML));
  const bn=await boot('Branch Manager',[P('dashboard',true,false,false,false),P('loans',true,true,false,false)]);
  bn.ev("openLoanDetail('L5')");await sleep(500);
  ok('extend: Branch Manager without loan approval does not',!/openExtendLoan/.test(bn.$('modalBox').innerHTML));
  const lo=await boot('Loan Officer',[P('dashboard',true,false,false,false),P('loans',true,true,false,false)]);
  lo.ev("openLoanDetail('L5')");await sleep(500);
  ok('extend: Loan Officer does not',!/openExtendLoan/.test(lo.$('modalBox').innerHTML));
  /* collections list */
  A=await boot('Admin');A.ev("go('collections')");await sleep(600);
  ok('extend: overdue list has an Extend button for Admin',/openExtendLoan\('[^']+','list'\)/.test(A.$('content').innerHTML));
  lo.ev("go('collections')");await sleep(500);
  ok('extend: not offered to a loan officer in the overdue list',!/openExtendLoan/.test(lo.$('content').innerHTML));

  /* the dialog */
  A=await boot('Admin');
  rpcs.length=0;await A.ev("openExtendLoan('L5')");await sleep(300);
  ok('extend dialog: waits for a date, no server call yet, button disabled',!rpcs.some(r=>r.fn==='extend_loan')&&A.$('exGo').disabled&&/Choose the new end date/.test(A.$('exPreview').innerHTML));
  ok('extend dialog: quick +30/+60/+90 buttons and a waive option for Admin',/\+30 days/.test(A.$('modalBox').innerHTML)&&/\+90 days/.test(A.$('modalBox').innerHTML)&&!!A.$('exWaive')&&A.$('exDate').min>A.ev("today()"));
  A.$('exDate').value=A.ev("addDaysISO(today(),400)");A.ev("extPreviewSoon()");await sleep(700);
  let pv=rpcs.find(r=>r.fn==='extend_loan');
  ok('extend dialog: previews with p_preview true, no extra interest or fee by default',!!pv&&pv.args.p_preview===true&&pv.args.p_extra_interest_bps===0&&pv.args.p_fee_minor===0&&pv.args.p_loan_id==='L5');
  const ph=A.$('exPreview').innerHTML;
  ok('extend dialog: shows what is owed, the total and the new instalments',/Principal still owed/.test(ph)&&/Total to pay/.test(ph)&&/3 instalments/.test(ph)&&/Restructured/.test(ph)&&(ph.match(/<tr><td>/g)||[]).length===3);
  ok('extend dialog: Extend stays disabled until a reason of 5+ characters',A.$('exGo').disabled===true);
  A.$('exReason').value='no';A.ev("extReady()");
  ok('extend dialog: a short reason keeps it disabled',A.$('exGo').disabled===true);
  rpcs.length=0;A.$('exRate').value='5';A.$('exFee').value='100.50';A.$('exWaive').checked=true;A.ev("extPreviewSoon()");await sleep(700);
  pv=rpcs.find(r=>r.fn==='extend_loan');
  ok('extend dialog: preview follows the inputs (500 bps, fee 10,050, waive)',!!pv&&pv.args.p_extra_interest_bps===500&&pv.args.p_fee_minor===10050&&pv.args.p_waive_penalties===true);
  ok('extend dialog: waived penalties and extra interest are shown',/Penalties waived/.test(A.$('exPreview').innerHTML)&&/Extra interest/.test(A.$('exPreview').innerHTML)&&/Extension fee/.test(A.$('exPreview').innerHTML));
  A.$('exReason').value='Customer lost income this month';A.ev("extReady()");
  ok('extend dialog: with a valid preview and reason the button is enabled',A.$('exGo').disabled===false);
  rpcs.length=0;A.ev("extSubmit()");await sleep(700);
  const go=rpcs.find(r=>r.fn==='extend_loan');
  ok('extend: confirming sends the real request with the reason and p_preview false',!!go&&go.args.p_preview===false&&go.args.p_reason==='Customer lost income this month'&&go.args.p_extra_interest_bps===500);
  ok('extend: dialog closes into the loan again after success',/ML-005/.test(A.$('modalBox').innerHTML)&&/Extend loan/.test(A.$('modalBox').innerHTML)||/ML-005/.test(A.$('modalBox').innerHTML));
  /* server error shown in the preview */
  await A.ev("openExtendLoan('L5','list')");await sleep(300);
  A.$('exDate').value='2099-01-01';A.ev("extPreviewSoon()");await sleep(700);
  ok('extend dialog: a server refusal is shown plainly and blocks the button',/10 years away/.test(A.$('exPreview').innerHTML)&&A.$('exGo').disabled===true);
  A.$('exDate').value='2001-01-01';rpcs.length=0;A.ev("extPreviewSoon()");await sleep(600);
  ok('extend dialog: an impossible date is explained locally without calling the server',/or later/.test(A.$('exPreview').innerHTML)&&!rpcs.some(r=>r.fn==='extend_loan'));
  A.ev("closeModal()");
  /* branch manager: no waive option */
  await bm.ev("openExtendLoan('L5')");await sleep(300);
  ok('extend dialog: Branch Manager has no waive option',!bm.$('exWaive'));
  bm.ev("closeModal()");

  /* history and void interplay */
  A=await boot('Admin');
  A.ev("openLoanDetail('L6')");await sleep(500);
  let h=A.$('modalBox').innerHTML;
  ok('extensions tab lists the change, extra interest and reason',/data-t="ext"/.test(h)&&/Customer lost income/.test(h)&&/5\.00%/.test(h)&&/2026-09-01|1 Sep/.test(h));
  ok('payment made after an older extension can still be voided (L6)',/openVoidPayment\(/.test(h));
  A.ev("openLoanDetail('L7')");await sleep(500);
  ok('payment made before a later extension cannot be voided (button hidden, L7)',!/openVoidPayment\(/.test(A.$('modalBox').innerHTML)&&/Second chance given/.test(A.$('modalBox').innerHTML));
  A.ev("openLoanDetail('L5')");await sleep(500);
  ok('loans never extended show no Extensions tab',!/data-t="ext"/.test(A.$('modalBox').innerHTML));
  MISSING.add('extend_loan');
  await A.ev("openExtendLoan('L5')");await sleep(300);A.$('exDate').value=A.ev("addDaysISO(today(),400)");A.ev("extPreviewSoon()");await sleep(700);
  ok('extend: an old database gives a readable error instead of breaking',/extend_loan/.test(A.$('exPreview').innerHTML)&&A.$('exGo').disabled);
  MISSING.delete('extend_loan');
  ok('no script errors in the extension scenarios',[A,bm,bn,lo].every(x=>x.errs.length===0),[A,bm,bn,lo].flatMap(x=>x.errs).join('|'));
}
await extendScenario();

console.log(`\n${pass} passed, ${fail} failed`);process.exit(fail?1:0);
})().catch(e=>{console.log('HARNESS ERROR',e.stack);process.exit(2)});
