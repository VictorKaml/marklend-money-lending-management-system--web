const today=new Date().toISOString().slice(0,10);
/* ---------------- mock database ---------------- */
const NAMES=['John Banda','Mary Phiri','Peter Mwale','Grace Tembo','Joseph Kamanga'];
const iso=n=>new Date(Date.now()-n*864e5).toISOString();
const D={loan_summary:[],borrower_summary:[],repayment_summary:[],ledger_entries:[],capital_transactions:[],audit_log_view:[],penalty_rules:[{id:'pr1',name:'Default',grace_days:5,flat_rate_bps:500,daily_rate_bps:10,cap_principal_bps:2000,active:true}],staff_access_view:[]};
for(let i=1;i<=60;i++)D.loan_summary.push({id:'L'+i,loan_number:'ML-'+String(i).padStart(3,'0'),borrower_id:'B'+(i%5),borrower_name:NAMES[i%5],principal_minor:100000*i,outstanding_principal:80000*i,currency:i%10===0?'USD':'MWK',status:i<=3?'Pending Approval':i%7===0?'Defaulted':'Active',created_at:iso(i),start_date:iso(i+30).slice(0,10),maturity_date:'2027-03-01',interest_rate_bps:1200,interest_type:'fixed',frequency:'Monthly'});
NAMES.forEach((n,i)=>D.borrower_summary.push({id:'B'+i,full_name:n,phone:'099'+i,email:n.split(' ')[0].toLowerCase()+'@x.com',risk_level:'Low',kyc_status:i%2?'Verified':'Pending',active_loans:2,created_at:iso(i)}));
for(let i=1;i<=30;i++)D.repayment_summary.push({id:'R'+i,loan_id:'L'+(i+3),loan_number:'ML-'+String(i+3).padStart(3,'0'),payment_date:iso(i).slice(0,10),amount_minor:50000,fee_component_minor:0,penalty_component_minor:0,interest_component_minor:5000,principal_component_minor:45000,currency:'MWK',created_at:iso(i)});
for(let i=1;i<=5;i++)D.audit_log_view.push({id:'A'+i,created_at:iso(i),actor_name:'Admin',actor_email:'admin@x.com',actor_role:'Admin',action:i%2?'SIGN_IN':'APPROVE',entity_type:'loan',entity_id:'L5',details:{n:i}});
D.ledger_entries.push({id:'G1',created_at:iso(2),entry_type:'DISBURSEMENT',reference:'D1',loan_id:'L5',debit_account:'LOAN_RECEIVABLE',credit_account:'CASH',amount_minor:500000,currency:'MWK'});
D.capital_transactions.push({id:'C1',created_at:iso(9),transaction_type:'FUNDING',source:'Owner',reference:'F1',amount_minor:9000000,currency:'MWK'});
const mon=n=>{const d=new Date();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-n);return d.toISOString().slice(0,7)};
const SERIES=[5,4,3,2,1,0].map((n,i)=>({month:mon(n),requested:100000*(i+1),disbursed:200000*(i+1)*(i===5?.5:1),repaid:90000*(i+1),interest:9000*(i+1),capital_net:(i+1)*100000}));
const OVERDUE=[{loan_id:'L5',loan_number:'ML-005',borrower_id:'B0',borrower_name:'John Banda',phone:'0990',currency:'MWK',status:'Active',oldest_due:iso(12).slice(0,10),days_late:12,overdue_minor:250000,penalty_minor:0,outstanding_principal:400000},{loan_id:'L9',loan_number:'ML-009',borrower_id:'B4',borrower_name:'Joseph Kamanga',phone:'0994',currency:'MWK',status:'Active',oldest_due:iso(45).slice(0,10),days_late:45,overdue_minor:900000,penalty_minor:12000,outstanding_principal:720000},{loan_id:'L10',loan_number:'ML-010',borrower_id:'B0',borrower_name:'John Banda',phone:'0990',currency:'USD',status:'Active',oldest_due:iso(100).slice(0,10),days_late:100,overdue_minor:50000,penalty_minor:0,outstanding_principal:800000}];
const SCHED=[1,2,3].map(n=>({id:'S'+n,loan_id:'L5',installment_no:n,due_date:iso(40-n*30).slice(0,10),principal_due_minor:100000,interest_due_minor:10000,fee_due_minor:0,penalty_due_minor:0,principal_paid_minor:n===1?100000:0,interest_paid_minor:n===1?10000:0,fee_paid_minor:0,penalty_paid_minor:0}));

/* ---------------- mock Supabase (REST + RPC + auth) ---------------- */
let ROLE='Admin',PERMS=[],MISSING=new Set();const calls=[],rpcs=[];
function matches(row,k,val){const op=val.split('.')[0],v=val.slice(op.length+1),x=row[k];
  if(op==='eq')return String(x)===v;if(op==='in')return v.replace(/^\(|\)$/g,'').split(',').includes(String(x));
  if(op==='gte')return String(x)>=v;if(op==='lte')return String(x)<=v;if(op==='lt')return String(x)<v;
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
function handle(url,method,hdr,bodyText){
  const opts={method,headers:hdr,body:bodyText};
  const u=new URL(url),p=u.pathname;
  let r;
  if(p==='/auth/v1/token')r={body:{access_token:'tok',refresh_token:'rt',expires_in:3600}};
  else if(p==='/auth/v1/user')r={body:{id:'u1',email:ROLE.toLowerCase().replace(' ','')+'@x.com',user_metadata:{}}};
  else if(p==='/auth/v1/logout')r={body:{}};
  else if(p.startsWith('/rest/v1/rpc/'))r=rpc(p.split('/').pop(),JSON.parse(opts.body||'{}'));
  else if(p==='/rest/v1/profiles')r={body:[{full_name:'Chikondi Banda',role:ROLE,avatar:null}]};
  else if(p==='/rest/v1/staff_permissions')r={body:PERMS};
  else if(p.startsWith('/rest/v1/')){const t=p.split('/').pop();
    if(method==='PATCH'||method==='POST')r={body:[{id:'x',...JSON.parse(opts.body||'{}')}]};else r=rest(t,u,hdr)}
  else r={status:404,body:{message:'nf'}};
  return{status:r.status||200,text:r.body===undefined?'':JSON.stringify(r.body),range:r.range||null};
}
module.exports={handle,setRole:(r,p)=>{ROLE=r;PERMS=p||[]}};
