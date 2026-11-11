/* Dialogs, loan detail and statements */

async function addCapital(){const amount=Number(document.getElementById('capAmount').value),currency=document.getElementById('capCurrency').value,source=document.getElementById('capSource').value.trim(),ref=document.getElementById('capRef').value.trim();if(!amount||amount<=0||!source||!ref)return toast('Amount, source and reference are required.');const {error}=await state.sb.rpc('add_capital',{p_amount_minor:Math.round(amount*100),p_currency:currency,p_source:source,p_reference:ref});if(error)return toast(error.message);closeModal();await loadData();go('capital');toast('Lending capital added.')}

async function withdrawCapital(){const amount=Number(document.getElementById('capOutAmount').value),currency=document.getElementById('capOutCurrency').value,source=document.getElementById('capOutSource').value.trim(),ref=document.getElementById('capOutRef').value.trim();if(!amount||amount<=0||!source||!ref)return toast('Amount, reason and reference are required.');const {error}=await state.sb.rpc('withdraw_capital',{p_amount_minor:Math.round(amount*100),p_currency:currency,p_source:source,p_reference:ref});if(error)return toast(error.message);closeModal();await loadData();go('capital');toast('Capital withdrawal recorded.')}

/* ---------- borrower form (create + edit share the KYC section) ---------- */
const ID_TYPES=['National ID','Passport','Driving licence','Other'];
function kycFields(b={}){
  return `<div class="kyc-box"><b>KYC details</b>${sub('Needed before a borrower can be Verified.')}<div class="formgrid" style="margin-top:10px"><div class="field"><label>ID type</label><select id="kfIdType"><option value="">Select</option>${ID_TYPES.map(x=>`<option${b.id_type===x?' selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>ID number</label><input id="kfIdNo" value="${esc(b.id_number||'')}"></div><div class="field"><label>Address</label><input id="kfAddr" value="${esc(b.address||'')}"></div><div class="field"><label>Next of kin</label><input id="kfKin" value="${esc(b.next_of_kin_name||'')}"></div><div class="field"><label>Next of kin phone</label><input id="kfKinPhone" type="tel" value="${esc(b.next_of_kin_phone||'')}"></div></div></div>`;
}
const kycReasonField=(b={})=>`<div class="field" id="kfReasonWrap" style="${b.kyc_status==='Rejected'?'':'display:none'}"><label>Reason for rejection <span class="required">*</span></label><input id="kfReason" value="${esc(b.kyc_reason||'')}" placeholder="e.g. ID photo unreadable"></div>`;
function kycValues(){
  const v=id=>($(id)?.value||'').trim();
  return {id_type:v('kfIdType')||null,id_number:v('kfIdNo')||null,address:v('kfAddr')||null,next_of_kin_name:v('kfKin')||null,next_of_kin_phone:v('kfKinPhone')||null};
}
/* Mirrors the server rules so the user gets a clear message before the round trip. */
function kycProblem(status,k,reason){
  if(status==='Verified'&&(!k.id_type||!k.id_number||!k.address))return 'Record the ID type, ID number and address before verifying this borrower.';
  if(status==='Rejected'&&!(reason||'').trim())return 'Give a reason for rejecting this borrower\'s KYC.';
  return '';
}
function kycStatusChanged(sel){const w=$('kfReasonWrap');if(w)w.style.display=sel.value==='Rejected'?'':'none'}
function openBorrowerModal(){
  modal(`<div class="modal-head"><div><h2 style="margin-bottom:4px">Add borrower</h2>${sub('Name, phone and email are required. Complete the KYC details to verify them.')}</div>${CLOSE_BTN}</div><div class="formgrid"><div class="field"><label>Full name <span class="required">*</span></label><input id="bfName" required autocomplete="name" placeholder="e.g. John Banda"></div><div class="field"><label>Phone <span class="required">*</span></label><input id="bfPhone" required type="tel" autocomplete="tel" placeholder="e.g. 0999 000 000"></div><div class="field"><label>Email <span class="required">*</span></label><input id="bfEmail" required type="email" autocomplete="email" placeholder="borrower@example.com"></div><div class="field"><label>Risk level <span class="required">*</span></label><select id="bfRisk" required><option value="" selected disabled>Select risk</option><option>Low</option><option>Medium</option><option>High</option></select></div><div class="field"><label>KYC status <span class="required">*</span></label><select id="bfKyc" required onchange="kycStatusChanged(this)"><option value="" selected disabled>Select KYC status</option><option>Pending</option><option>Verified</option><option>Rejected</option></select></div>${kycReasonField()}${isAdminUser()?FIELD('Branch',`<select id="bfBranch"><option value="" selected disabled>Select branch</option>${branchOpts('')}</select>`):''}</div>${kycFields()}<div class="cf-act"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="createBorrower()">Create borrower</button></div>`);
}

/* ---------- MarkLend 1.7 modals, loan detail, statements ---------- */
const FIELD=(l,b)=>`<div class="field"><label>${l} <span class="required">*</span></label>${b}</div>`;
const CLOSE_BTN='<button class="close" onclick="closeModal()" aria-label="Close">×</button>';
const safeQ=(table,o)=>state.sb.query(table,o).catch(e=>({data:[],count:0,error:e}));
async function getLoan(id,fresh){
  const hit=fresh?null:state.loans.find(l=>l.id===id);if(hit)return hit;
  return (await safeQ('loan_summary',{filters:[['id','eq',id]],from:0,to:0})).data[0]||null;
}

/* ---------- type-ahead picker (server-side search, so it scales past a few hundred records) ---------- */
const PICK={};
function pickerHTML(id,cfg){PICK[id]=cfg;return `<div class="picker"><input id="${id}Q" placeholder="${esc(cfg.ph)}" autocomplete="off" oninput="pickInput('${id}')" onfocus="pickFocus('${id}')"><input type="hidden" id="${id}"><div class="picker-list" id="${id}L"></div></div>`}
function pickFocus(id){if(!$(id).value)pickInput(id,true)}
function pickInput(id,keep){
  const cfg=PICK[id];if(!keep){$(id).value='';cfg.onClear&&cfg.onClear()}
  clearTimeout(cfg.t);
  cfg.t=setTimeout(async()=>{
    const seq=cfg.seq=(cfg.seq||0)+1;let rows=[];
    try{rows=await cfg.fetch($(id+'Q')?.value||'')}catch(_){}
    if(seq!==cfg.seq||!$(id+'L'))return;
    cfg.rows=rows;
    $(id+'L').innerHTML=rows.length?rows.map((r,i)=>`<div class="pal-i" onclick="pickChoose('${id}',${i})"><span>${esc(r.title)}</span><small>${esc(r.sub||'')}</small></div>`).join(''):'<div class="empty" style="padding:10px">No matches</div>';
  },keep?0:200);
}
function pickChoose(id,i){const cfg=PICK[id],r=cfg.rows[i];if(!r)return;$(id).value=r.id;$(id+'Q').value=r.title;$(id+'L').innerHTML='';cfg.onPick&&cfg.onPick(r)}
const fetchBorrowers=async q=>{const t=q.trim(),r=await state.sb.query('borrower_summary',{filters:[['kyc_status','eq','Verified']],or:t?['full_name','phone','email'].map(c=>`${c}.ilike.${likeTerm(t)}`).join(','):null,order:[['full_name',true]],from:0,to:7});return r.data.map(b=>({id:b.id,title:b.full_name,sub:[b.phone,b.kyc_status].filter(Boolean).join(' · ')}))};
const fetchOpenLoans=async q=>{const t=q.trim(),r=await state.sb.query('loan_summary',{filters:[['status','in','('+OPEN_STATUSES.join(',')+')']],or:t?['loan_number','borrower_name'].map(c=>`${c}.ilike.${likeTerm(t)}`).join(','):null,order:[['created_at',false]],from:0,to:7});return r.data.map(l=>({id:l.id,title:l.loan_number,sub:`${l.borrower_name||''} · ${l.currency}`}))};

/* ---------- new loan (custom period: from date to date) ---------- */
function openLoanModal(){
  const t=today();
  modal(`<div class="modal-head"><div><h2 style="margin-bottom:4px">New loan request</h2>${sub('Stays Pending Approval until another person authorises it; no capital is used yet. Only borrowers with verified KYC are listed.')}</div>${CLOSE_BTN}</div><div class="formgrid">${FIELD('Borrower',pickerHTML('lnB',{ph:'Search name, phone or email',fetch:fetchBorrowers}))}${FIELD('Principal','<input id="lnP" type="number" min="0.01" step="0.01">')}${FIELD('Currency',`<select id="lnC">${CURRENCIES.map(c=>`<option${c===state.currency?' selected':''}>${c}</option>`).join('')}</select>`)}${FIELD('Interest type','<select id="lnT"><option value="fixed">Fixed (flat % over the term)</option><option value="declining">Declining (% per instalment)</option></select>')}${FIELD('Interest rate (%)','<input id="lnR" type="number" min="0" step="0.01">')}${FIELD('Repayment frequency','<select id="lnF"><option>Monthly</option><option>Weekly</option><option>Daily</option><option>Lumpsum</option></select>')}${FIELD('Loan period: from',`<input id="lnS" type="date" value="${t}" onchange="lnTerm()">`)}${FIELD('Loan period: to','<input id="lnE" type="date" onchange="lnTerm()">')}</div><div class="card panel" style="margin-top:14px"><h3>Collateral (optional)</h3>${sub('Record the asset securing this loan. Leave blank if the loan is unsecured.')}<div class="formgrid" style="margin-top:10px"><div class="field"><label>Collateral type</label><select id="lnColType"><option value="">Not provided</option><option>Vehicle</option><option>Property</option><option>Land</option><option>Equipment</option><option>Household item</option><option>Other</option></select></div><div class="field"><label>Estimated value</label><input id="lnColValue" type="number" min="0" step="0.01" placeholder="0.00"></div><div class="field"><label>Reference / registration number</label><input id="lnColRef" maxlength="120" placeholder="e.g. vehicle registration or title number"></div><div class="field" style="grid-column:1/-1"><label>Description</label><textarea id="lnColDesc" maxlength="1000" placeholder="Describe the collateral, make/model, location and identifying details"></textarea></div></div></div><div class="cf-sub" id="lnTerm"></div><div class="cf-act"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="lnGo" onclick="createLoan()">Create request</button></div>`);
}
function lnTerm(){const s=$('lnS').value,e=$('lnE').value;$('lnTerm').textContent=s&&e?(e>s?`Term: ${Math.round((new Date(e)-new Date(s))/864e5)} days`:'The end date must be after the start date.'):''}
async function createLoan(){
  const b=$('lnB').value,pr=Number($('lnP').value),rate=parseFloat($('lnR').value),s=$('lnS').value,e=$('lnE').value;
  if(!b||!(pr>0)||isNaN(rate)||rate<0||!s||!e)return toast('Choose a borrower and complete all required loan fields.');
  if(e<=s)return toast('The end date must be after the start date.');
  const btn=$('lnGo');btn.disabled=true;
  const collateralType=$('lnColType').value.trim()||null,collateralDescription=$('lnColDesc').value.trim()||null,collateralReference=$('lnColRef').value.trim()||null,collateralValue=$('lnColValue').value.trim()===''?null:Number($('lnColValue').value);if(collateralValue!==null&&(!Number.isFinite(collateralValue)||collateralValue<0)){btn.disabled=false;return toast('Collateral value must be zero or more.')}if((collateralType||collateralReference||collateralValue!==null)&&!collateralDescription){btn.disabled=false;return toast('Add a collateral description when recording collateral details.')}const a={p_borrower_id:b,p_principal_minor:Math.round(pr*100),p_interest_type:$('lnT').value,p_interest_rate_bps:Math.round(rate*100),p_frequency:$('lnF').value,p_currency:$('lnC').value,p_maturity_date:e,p_collateral_type:collateralType,p_collateral_description:collateralDescription,p_collateral_value_minor:collateralValue===null?null:Math.round(collateralValue*100),p_collateral_reference:collateralReference};
  let r=await state.sb.rpc('create_loan',{...a,p_start_date:s});
  if(r.error&&/p_start_date|schema cache/i.test(r.error.message||'')){
    if(s!==today()){btn.disabled=false;return toast('Apply the updated supabase/schema.sql to use a custom start date.')}
    r=await state.sb.rpc('create_loan',a);
  }
  if(r.error){btn.disabled=false;return toast(r.error.message)}
  closeModal();await loadData();go('loans');toast('Loan request created and pending approval.');
}

/* ---------- repayment with live waterfall preview ---------- */
const rp={loan:null,pv:null,seq:0,sig:'',key:'',busy:false};
function openRepaymentModal(loanId){
  rp.loan=null;rp.pv=null;rp.sig='';
  modal(`<div class="modal-head"><div><h2 style="margin-bottom:4px">Record repayment</h2>${sub('Waterfall: fees → penalties → interest → principal')}</div>${CLOSE_BTN}</div><div class="field"><label>Loan <span class="required">*</span></label>${pickerHTML('rpL',{ph:'Search loan number or borrower',fetch:fetchOpenLoans,onPick:r=>rpSelect(r.id),onClear:()=>{rp.loan=null;rp.pv=null;rpPaint()}})}</div><div class="formgrid" style="margin-top:12px">${FIELD('Amount','<input id="rpA" type="number" min="0.01" step="0.01" oninput="rpPreview()">')}${FIELD('Payment date',`<input id="rpD" type="date" value="${today()}" max="${today()}">`)}</div><div id="rpInfo"></div><div class="cf-act"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="rpGo" disabled onclick="postRepayment()">Record repayment</button></div>`);
  if(loanId)rpSelect(loanId,true);
}
async function rpSelect(id,fillPicker){
  const l=await getLoan(id);if(!l)return toast('Loan not found.');
  rp.loan=l;$('rpL').value=id;if(fillPicker||!$('rpLQ').value)$('rpLQ').value=l.loan_number;
  await rpPreview(true);
}
let rpTimer;
function rpPreview(now){
  clearTimeout(rpTimer);
  return new Promise(res=>{rpTimer=setTimeout(async()=>{
    if(!rp.loan||!$('rpA')){res();return}
    const seq=++rp.seq,amt=Math.round(Number($('rpA').value||0)*100);
    const {data,error}=await state.sb.rpc('repayment_preview',{p_loan_id:rp.loan.id,p_amount_minor:Math.max(0,amt)});
    if(seq!==rp.seq)return res();
    rp.pv=error?{error:error.message}:data;rpPaint();res();
  },now===true?0:250)});
}
function rpFill(minor){$('rpA').value=(minor/100).toFixed(2);rpPreview(true)}
function rpPaint(){
  const h=$('rpInfo'),go_=$('rpGo');if(!h)return;
  const pv=rp.pv,amt=Math.round(Number($('rpA')?.value||0)*100);
  if(!rp.loan||!pv){h.innerHTML=rp.loan?'<div class="cf-sub">Checking what is owed…</div>':'';if(go_)go_.disabled=true;return}
  if(pv.error){h.innerHTML=`<div class="alert bad">${esc(pv.error)}</div>`;go_.disabled=true;return}
  const c=pv.currency,over=Number(pv.overpay||0)>0,done=Number(pv.total_due||0)<=0;
  h.innerHTML=`<div class="cf-math" style="margin-top:14px"><div><span>Total still owed</span><b>${mc(pv.total_due,c)}</b></div><div><span>Due now (including overdue)</span><b>${mc(pv.due_now,c)}</b></div>${pv.next_due?`<div><span>Next instalment</span><b>${mc(pv.next_amount,c)} · ${esc(fdt(pv.next_due))}</b></div>`:''}</div>${done?'<div class="alert info">This loan has nothing left to pay.</div>':`<div class="chips"><button class="btn mini" onclick="rpFill(${pv.due_now})" ${Number(pv.due_now)>0?'':'disabled'}>Pay due now</button><button class="btn mini" onclick="rpFill(${pv.total_due})">Pay in full</button></div>`}${amt>0?`<div class="cf-math"><div><span>Fees</span><b>${mc(pv.fee,c)}</b></div><div><span>Penalty</span><b>${mc(pv.penalty,c)}</b></div><div><span>Interest</span><b>${mc(pv.interest,c)}</b></div><div><span>Principal</span><b>${mc(pv.principal,c)}</b></div>${over?`<div class="cf-rem bad"><span>More than is owed by</span><b>${mc(pv.overpay,c)}</b></div>`:''}</div>`:''}${over?'<div class="alert bad">This payment is larger than the total owed. Reduce the amount or choose “Pay in full”.</div>':''}`;
  go_.disabled=!(amt>0&&!over&&!done&&!rp.busy);
}
async function postRepayment(){
  const l=rp.loan,a=Math.round(Number($('rpA').value||0)*100),d=$('rpD').value;
  if(!l||!(a>0)||!d)return toast('Loan, amount and date are required.');
  if(d>today())return toast('The payment date cannot be in the future.');
  if(rp.pv&&Number(rp.pv.overpay||0)>0)return toast('The amount is more than is owed.');
  const sig=`${l.id}|${a}|${d}`;if(sig!==rp.sig){rp.sig=sig;rp.key=crypto.randomUUID()}   // retries of the same payment reuse one key, so it can never post twice
  rp.busy=true;$('rpGo').disabled=true;
  const {data:repaymentId,error}=await state.sb.rpc('post_repayment',{p_loan_id:l.id,p_amount_minor:a,p_payment_date:d,p_idempotency_key:rp.key});
  rp.busy=false;
  if(error){rpPaint();return toast(/exceeds/i.test(error.message)?'That payment is more than is owed. Reduce the amount.':error.message)}
  closeModal();await loadData();toast('Repayment recorded in the ledger.');
  if(repaymentId)await generatePaymentReceipt(repaymentId);
}

/* ---------- approve / reject ---------- */
async function availCap(c){const {data,error}=await state.sb.rpc('available_capital',{p_currency:c});return error?null:Number(data)}
async function reviewLoan(id){
  modal(`<div class="modal-head"><h2>Loan review</h2>${CLOSE_BTN}</div><div class="cf-sub">Loading…</div>`);
  const x=await getLoan(id);if(!x)return closeModal(),toast('Loan not found.');
  const [sch,bor]=await Promise.all([state.sb.rpc('loan_schedule',{p_loan_id:id}),safeQ('borrower_summary',{filters:[['id','eq',x.borrower_id]],from:0,to:0})]);
  const interest=(sch.data||[]).reduce((a,r)=>a+Number(r.interest_due_minor||0),0),risk=bor.data[0]?.risk_level||'—';
  modal(`<div class="modal-head"><div><h2 style="margin-bottom:4px">Review ${esc(x.loan_number)}</h2>${sub('Loan request awaiting authorization')}</div>${CLOSE_BTN}</div><div class="review-grid"><div><small>Borrower</small><b>${esc(x.borrower_name)}</b></div><div><small>Principal</small><b>${mc(x.principal_minor,x.currency)}</b></div><div><small>Interest</small><b>${mc(interest,x.currency)}</b></div><div><small>Period</small><b>${esc(fdt(x.start_date||x.created_at))} → ${esc(fdt(x.maturity_date))}</b></div><div><small>Frequency</small><b>${esc(x.frequency)}</b></div><div><small>Risk</small><b>${esc(risk)}</b></div></div><div class="alert info" style="margin-top:14px">Approval checks the live capital pool and records the disbursement atomically. Rejection leaves the capital pool untouched.</div><div class="cf-act"><button class="btn" onclick="openLoanDetail('${id}')">Full details</button><button class="btn" onclick="closeModal()">Close</button><button class="btn danger" onclick="confirmReject('${id}')">Reject…</button><button class="btn primary" onclick="confirmApprove('${id}')">Approve…</button></div>`);
}
async function confirmApprove(id){
  const x=await getLoan(id);if(!x)return;
  modal(`<div class="modal-head"><h2>Approve ${esc(x.loan_number)}?</h2>${CLOSE_BTN}</div><div id="cfBody" class="cf-sub">Checking live ${esc(x.currency)} capital…</div>`);
  const a=await availCap(x.currency),p=Number(x.principal_minor),r=a==null?null:a-p,bad=r!=null&&r<0;
  $('cfBody').innerHTML=`<p class="cf-sub">${esc(x.borrower_name)} · disburses <b>${mc(p,x.currency)}</b> now.</p><div class="cf-math"><div><span>Available ${esc(x.currency)} capital</span><b>${a==null?'—':mc(a,x.currency)}</b></div><div><span>This loan</span><b>− ${mc(p,x.currency)}</b></div><div class="cf-rem ${bad?'bad':''}"><span>Capital remaining after approval</span><b>${r==null?'Unavailable':mc(r,x.currency)}</b></div></div>${bad?`<div class="alert bad">Shortfall of ${mc(-r,x.currency)}. Fund capital before approving.</div>`:`<p class="cf-sub">${r==null?'Live balance unavailable; the server still enforces the limit. ':''}This posts the disbursement to the ledger and cannot be undone.</p>`}<div class="cf-act"><button class="btn" onclick="reviewLoan('${id}')">Back</button><button class="btn primary" id="cfGo" ${bad?'disabled':''} onclick="doApprove('${id}')">Approve &amp; disburse</button></div>`;
}
async function doApprove(id){
  if(!can('loans','approve'))return toast('You do not have approval permission.');
  const b=$('cfGo');b.disabled=true;const x=await getLoan(id),{error}=await state.sb.rpc('approve_loan',{p_loan_id:id});
  if(error){b.disabled=false;return toast(error.message)}
  closeModal();await loadData();toast(`Loan ${x.loan_number} approved and disbursed.`,{action:{label:'Invoice',fn:()=>downloadInvoice(id)}});
}
async function confirmReject(id){
  const x=await getLoan(id);if(!x)return;const a=await availCap(x.currency);
  modal(`<div class="modal-head"><h2>Reject ${esc(x.loan_number)}?</h2>${CLOSE_BTN}</div><p class="cf-sub">${esc(x.borrower_name)} · ${mc(x.principal_minor,x.currency)}. No capital is released${a==null?'':`; the ${esc(x.currency)} pool stays at ${mc(a,x.currency)}`}.</p><div class="field"><label>Reason <span class="required">*</span></label><textarea id="rjReason" placeholder="Shown in the audit log"></textarea></div><div class="cf-act"><button class="btn" onclick="reviewLoan('${id}')">Back</button><button class="btn danger" id="cfGo" onclick="doReject('${id}')">Reject request</button></div>`);
  $('rjReason').focus();
}
async function doReject(id){
  if(!can('loans','approve'))return toast('You do not have approval permission.');
  const r=$('rjReason').value.trim();if(!r)return toast('A rejection reason is required.');
  const b=$('cfGo');b.disabled=true;const {error}=await state.sb.rpc('reject_loan',{p_loan_id:id,p_reason:r});
  if(error){b.disabled=false;return toast(error.message)}
  closeModal();await loadData();toast('Loan request rejected and audit record created.');
}

/* ---------- loan detail: schedule, repayments, ledger, audit trail ---------- */
const ld={};
function schedStatus(r){
  const due=Number(r.principal_due_minor)+Number(r.interest_due_minor)+Number(r.fee_due_minor)+Number(r.penalty_due_minor),paid=Number(r.principal_paid_minor)+Number(r.interest_paid_minor)+Number(r.fee_paid_minor)+Number(r.penalty_paid_minor),bal=due-paid;
  const st=bal<=0?['Paid','b-active']:String(r.due_date)<today()?['Overdue','b-overdue']:String(r.due_date)===today()?['Due today','b-pending']:paid>0?['Part paid','b-pending']:['Upcoming','b-written'];
  return{due,paid,bal,st};
}
function schedCols(cur){return[
  {h:'#',t:'text',v:r=>String(r.installment_no)},{h:'Due date',t:'text',v:r=>fdt(r.due_date)},
  {h:'Principal',t:'money',v:r=>r.principal_due_minor,c:()=>cur},{h:'Interest',t:'money',v:r=>r.interest_due_minor,c:()=>cur},
  {h:'Fees',t:'money',v:r=>r.fee_due_minor,c:()=>cur},{h:'Penalty',t:'money',v:r=>r.penalty_due_minor,c:()=>cur},
  {h:'Total due',t:'money',v:r=>schedStatus(r).due,c:()=>cur},{h:'Paid',t:'money',v:r=>schedStatus(r).paid,c:()=>cur},{h:'Balance',t:'money',v:r=>schedStatus(r).bal,c:()=>cur},
  {h:'Status',t:'html',v:r=>{const s=schedStatus(r).st;return `<span class="badge ${s[1]}">${s[0]}</span>`},x:r=>schedStatus(r).st[0]}]}
async function openLoanDetail(id){
  modal(`<div class="modal-head"><h2>Loan details</h2>${CLOSE_BTN}</div>${skelRows(6)}`,{wide:true});
  const isB=state.userProfile?.role==='Borrower',admin=state.userProfile?.role==='Admin';
  const loan=await getLoan(id);if(!loan){closeModal();return toast('Loan not found.')}
  const [sch,reps,led,aud,bor,vp,exs]=await Promise.all([
    state.sb.rpc('loan_schedule',{p_loan_id:id}),
    safeQ('repayment_summary',{filters:[['loan_id','eq',id]],order:[['payment_date',false],['created_at',false]],from:0,to:199}),
    isB||can('ledger')?safeQ('ledger_entries',{filters:[['loan_id','eq',id]],order:[['created_at',false]],from:0,to:199}):{data:[]},
    admin?safeQ('audit_log_view',{filters:[['entity_id','eq',id]],order:[['created_at',false]],from:0,to:99}):{data:[]},
    isB?{data:[]}:safeQ('borrower_summary',{filters:[['id','eq',loan.borrower_id]],from:0,to:0}),
    isB?{data:[]}:safeQ('repayments_voided',{filters:[['loan_id','eq',id]],order:[['voided_at',false]],from:0,to:49}),
    isB?{data:[]}:safeQ('loan_extensions',{filters:[['loan_id','eq',id]],order:[['created_at',false]],from:0,to:49})]);
  const schedule=sch.data||[];Object.assign(ld,{loan,borrower:bor.data[0]||null,schedule,reps:reps.data});
  const cur=loan.currency,next=schedule.find(r=>schedStatus(r).bal>0),od=state.overdue[id];
  const paneTabs=[['sched','Schedule',schedule.length],['reps','Repayments',reps.data.length],...(isB||can('ledger')?[['led','Ledger',led.data.length]]:[]),...((exs.data||[]).length?[['ext','Extensions',exs.data.length]]:[]),...(admin?[['aud','Audit trail',aud.data.length]]:[])];
  const ledCols=[{h:'Time',t:'text',v:r=>fts(r.created_at)},{h:'Type',t:'text',v:r=>r.entry_type},{h:'Debit',t:'text',v:r=>r.debit_account},{h:'Credit',t:'text',v:r=>r.credit_account},{h:'Amount',t:'money',v:r=>r.amount_minor,c:r=>r.currency}];
  const latestId=latestPaymentId(reps.data),latestRep=reps.data.find(r=>r.id===latestId),extLater=!!latestRep&&(exs.data||[]).some(e=>String(e.created_at)>String(latestRep.created_at)),repC=[...COLS.repayments.filter(c=>c.h!=='Loan'),...(canVoidPayment(loan)&&!extLater?[{h:'',t:'html',x:()=>'',v:r=>r.id===latestId?`<button class="btn mini danger" onclick="openVoidPayment('${r.id}')">Void</button>`:''}]:[])];
  const extCols=[{h:'When',t:'text',v:r=>fts(r.created_at)},{h:'End date',t:'text',v:r=>`${fdt(r.old_maturity)} → ${fdt(r.new_maturity)}`},{h:'Period rate',t:'text',v:r=>(Number(r.extra_interest_bps)/100).toFixed(2)+'%'},{h:'Fee',t:'money',v:r=>r.fee_minor,c:()=>cur},{h:'Penalties waived',t:'money',v:r=>r.waived_penalty_minor,c:()=>cur},{h:'Reason',t:'text',v:r=>r.reason}];
  const voidedCols=[{h:'Paid',t:'text',v:r=>fdt(r.payment_date)},{h:'Amount',t:'money',v:r=>r.amount_minor,c:r=>r.currency},{h:'Voided',t:'text',v:r=>fts(r.voided_at)},{h:'Reason',t:'text',v:r=>r.void_reason||''}];
  const rate=`${(Number(loan.interest_rate_bps||0)/100).toFixed(2)}% ${loan.interest_type==='declining'?'declining':'fixed'}`;
  const actions=[!isB&&can('repayments','create')&&OPEN_STATUSES.includes(loan.status)?`<button class="btn primary" onclick="openRepaymentModal('${id}')">Record payment</button>`:'',reviewControl(loan,'btn primary'),isApproved(loan)&&!isB?`<button class="btn" onclick="downloadInvoice('${id}')">Invoice (PDF)</button> <button class="btn" onclick="downloadInvoice('${id}',{email:true})">Email invoice…</button>`:'',`<button class="btn" onclick="loanStatement()">Statement (PDF)</button>`,canExtendLoan()&&OPEN_STATUSES.includes(loan.status)&&next?`<button class="btn" onclick="openExtendLoan('${id}')">Extend loan…</button>`:'',canVoidLoan(loan,reps.data)?`<button class="btn danger" onclick="openVoidLoan('${id}')">Void loan…</button>`:'',canDeleteLoan(loan)?`<button class="btn danger" onclick="openDeleteLoan('${id}')">Delete loan…</button>`:'','<button class="btn" onclick="closeModal()">Close</button>'].join(' ');
  modal(`<div class="modal-head"><div><h2 style="margin-bottom:4px">${esc(loan.loan_number)} ${badge(loan.status)}${od?` <span class="badge b-overdue">Overdue ${od.days_late}d</span>`:''}</h2>${sub(esc(loan.borrower_name||''))}${ld.borrower?.phone?sub(' · '+esc(ld.borrower.phone)):''}</div>${CLOSE_BTN}</div><div class="review-grid"><div><small>Principal</small><b>${mc(loan.principal_minor,cur)}</b></div><div><small>Outstanding principal</small><b>${mc(loan.outstanding_principal,cur)}</b></div><div><small>Interest</small><b>${esc(rate)}</b></div><div><small>Frequency</small><b>${esc(loan.frequency)}</b></div><div><small>Period</small><b>${esc(fdt(loan.start_date||loan.disbursement_date||loan.created_at))} → ${esc(fdt(loan.maturity_date))}</b></div><div><small>Next instalment</small><b>${next?`${mc(schedStatus(next).bal,cur)} · ${esc(fdt(next.due_date))}`:'—'}</b></div>${loan.collateral_description?`<div style="grid-column:1/-1"><small>Collateral</small><b>${esc([loan.collateral_type,loan.collateral_description,loan.collateral_reference?`Ref: ${loan.collateral_reference}`:''].filter(Boolean).join(' · '))}${loan.collateral_value_minor!=null?` · ${mc(loan.collateral_value_minor,cur)}`:''}</b></div>`:''}${od?`<div><small>Overdue now</small><b class="red">${mc(od.overdue_minor,cur)}</b></div>`:''}</div><div class="tabs">${paneTabs.map(([k,l,n],i)=>`<button class="tab${i?'':' sel'}" data-t="${k}" onclick="ldTab('${k}')">${l} <span>${n}</span></button>`).join('')}</div><div class="ld-pane" data-p="sched">${tableHTML(schedCols(cur),schedule,{empty:'No schedule available yet (generated when the loan is approved).',rowCls:r=>schedStatus(r).st[0]==='Overdue'?'is-overdue':''})}</div><div class="ld-pane" data-p="reps" hidden>${tableHTML(repC,reps.data,{empty:'No repayments yet.'})}${(vp.data||[]).length?`<h3 class="t" style="margin:16px 0 6px;font-size:13px">Voided payments</h3>${tableHTML(voidedCols,vp.data)}`:''}</div><div class="ld-pane" data-p="led" hidden>${tableHTML(ledCols,led.data,{empty:'No ledger entries.'})}</div><div class="ld-pane" data-p="ext" hidden>${tableHTML(extCols,exs.data||[],{empty:'This loan has not been extended.'})}</div><div class="ld-pane" data-p="aud" hidden>${tableHTML(COLS.audit.filter(c=>c.h!=='Entity'),aud.data,{empty:'No audit records for this loan.'})}</div>${loan.rejection_reason?`<div class="alert bad" style="margin-top:12px">Rejected: ${esc(loan.rejection_reason)}</div>`:''}<div class="cf-act">${actions}</div>`,{wide:true});
}
function ldTab(k){document.querySelectorAll('#modalBox .tab').forEach(b=>b.classList.toggle('sel',b.dataset.t===k));document.querySelectorAll('#modalBox .ld-pane').forEach(p=>{p.hidden=p.dataset.p!==k})}

/* ---------- payment receipts: immutable payment reference + live outstanding balances ---------- */
async function generatePaymentReceipt(repaymentId){
  try{
    const [rr]=await Promise.all([safeQ('repayment_summary',{filters:[['id','eq',repaymentId]],from:0,to:0})]);
    const r=rr.data?.[0];if(!r)throw new Error('Payment record was not found or is not accessible.');
    const [loan,borrower,sch,all,extQ]=await Promise.all([
      getLoan(r.loan_id,true),
      safeQ('borrower_summary',{filters:[['id','eq',r.borrower_id]],from:0,to:0}),
      state.sb.rpc('loan_schedule',{p_loan_id:r.loan_id}),
      safeQ('repayment_summary',{filters:[['loan_id','eq',r.loan_id]],order:[['payment_date',true],['created_at',true]],from:0,to:999}),
      safeQ('loan_extensions',{filters:[['loan_id','eq',r.loan_id]],order:[['created_at',true]],from:0,to:99})
    ]);
    if(!loan)throw new Error('The linked loan could not be loaded.');
    const b=borrower.data?.[0]||{},rows=sch.data||[],extensions=extQ.data||[],sum=f=>rows.reduce((n,x)=>n+Number(x[f]||0),0);
    const principalDue=sum('principal_due_minor'),principalPaid=sum('principal_paid_minor');
    const interestDue=sum('interest_due_minor'),interestPaid=sum('interest_paid_minor');
    const feeDue=sum('fee_due_minor'),feePaid=sum('fee_paid_minor'),penDue=sum('penalty_due_minor'),penPaid=sum('penalty_paid_minor');
    const outstandingPrincipal=Math.max(0,principalDue-principalPaid),outstandingInterest=Math.max(0,interestDue-interestPaid);
    const outstandingFees=Math.max(0,feeDue-feePaid),outstandingPenalties=Math.max(0,penDue-penPaid);
    const outstanding=outstandingPrincipal+outstandingInterest+outstandingFees+outstandingPenalties;
    const payments=all.data||[],cumulative=payments.reduce((n,x)=>n+Number(x.amount_minor||0),0);
    const cur=r.currency||loan.currency,m=v=>esc(moneyText(v,cur)),rate=(Number(loan.interest_rate_bps||0)/100).toFixed(2)+'%';
    const full=outstanding===0;
    const reference='RCT-'+String(r.id).replace(/-/g,'').slice(0,12).toUpperCase();
    const company=typeof companyInfo==='function'?companyInfo():{name:'MarkLend Financial Services',footer:'Thank you.'};
    const body=`<div style="display:flex;justify-content:space-between;align-items:start;border-bottom:3px solid #ff7a1f;padding-bottom:12px"><div><h1>${esc(company.name)}</h1><p>OFFICIAL PAYMENT RECEIPT</p></div><div style="text-align:right"><h1 style="color:${full?'#039855':'#b54708'}">${full?'PAID IN FULL':'PARTIALLY PAID'}</h1><b>${reference}</b><p>Invoice: INV-${esc(loan.loan_number)}</p></div></div>
    <h2>Borrower and loan</h2><div class="kv"><div><small>Borrower</small>${esc(loan.borrower_name||b.full_name||'')}</div><div><small>Phone</small>${esc(b.phone||'—')}</div><div><small>Loan reference</small>${esc(loan.loan_number)}</div><div><small>Payment date</small>${esc(fdt(r.payment_date))}</div><div><small>Original principal</small>${m(loan.principal_minor)}</div><div><small>Applied interest rate</small>${rate} (${esc(loan.interest_type||'fixed')})</div><div><small>Loan period</small>${esc(fdt(loan.start_date||loan.disbursement_date||loan.created_at))} → ${esc(fdt(loan.maturity_date))}</div><div><small>Loan status</small>${esc(loan.status)}</div></div>
    ${extensions.length?`<h2>Extension history</h2>${pdfTable([{h:'Previous maturity',t:'text',v:x=>fdt(x.old_maturity)},{h:'Extended to',t:'text',v:x=>fdt(x.new_maturity)},{h:'Period rate',t:'text',v:x=>(Number(x.extra_interest_bps||0)/100).toFixed(2)+'%'},{h:'Reason',t:'text',v:x=>x.reason}],extensions)}`:''}
    <h2>Payment received in this transaction</h2>${pdfTable([{h:'Component',t:'text',v:x=>x.n},{h:'Amount',t:'money',v:x=>x.v,c:()=>cur}],[{n:'Fees',v:r.fee_component_minor},{n:'Penalties',v:r.penalty_component_minor},{n:'Interest',v:r.interest_component_minor},{n:'Principal',v:r.principal_component_minor},{n:'TOTAL RECEIVED',v:r.amount_minor}])}
    <h2>Account position after this payment</h2>${pdfTable([{h:'Balance component',t:'text',v:x=>x.n},{h:'Outstanding',t:'money',v:x=>x.v,c:()=>cur}],[{n:'Principal outstanding',v:outstandingPrincipal},{n:'Interest outstanding',v:outstandingInterest},{n:'Fees outstanding',v:outstandingFees},{n:'Penalties outstanding',v:outstandingPenalties},{n:'TOTAL OUTSTANDING',v:outstanding}])}
    <div class="tot"><div><span>This payment</span><b>${m(r.amount_minor)}</b></div><div><span>Cumulative payments received</span><b>${m(cumulative)}</b></div><div class="g"><span>${full?'Settlement balance':'Remaining amount outstanding'}</span><span>${m(outstanding)}</span></div></div>
    <p style="margin-top:18px">Payment transaction: ${esc(r.idempotency_key||r.id)}<br>Receipt reference: ${reference}<br>Generated: ${esc(new Date().toLocaleString())}</p><p>${full?'This loan has been fully settled. No amount remains outstanding.':'This is a partial payment receipt. The borrower remains liable for the outstanding balance shown above.'}</p><p>${esc(company.footer||'Thank you.')}</p>`;
    const out=await window.marklendAPI.exportPDF({html:`<!doctype html><meta charset="utf-8"><style>${PDF_CSS}.tot{margin:14px 0 0 auto;width:68%;border:1px solid #e4e7ec;border-radius:8px;overflow:hidden}.tot div{display:flex;justify-content:space-between;padding:7px 10px;border-bottom:1px solid #e4e7ec}.tot .g{background:#101828;color:#fff;font-weight:700}</style>${body}`,filename:`receipt-${loan.loan_number}-${reference}.pdf`});
    if(out?.path)toast('Payment receipt saved.');
  }catch(e){toast('Receipt could not be generated: '+e.message)}
}

/* ---------- printable statements (PDF) ---------- */
const PDF_CSS='body{font:11px Inter,Arial,sans-serif;color:#101828;margin:0}h1{font-size:20px;margin:0}h2{font-size:13px;margin:18px 0 6px}p{color:#667085;margin:3px 0}table{border-collapse:collapse;width:100%}th{background:#f2f4f7;text-align:left;font-size:9px;text-transform:uppercase}th,td{padding:5px 7px;border-bottom:1px solid #e4e7ec}.r{text-align:right;white-space:nowrap}.kv{display:flex;gap:28px;margin:10px 0}.kv div small{display:block;color:#667085;font-size:9px;text-transform:uppercase}';
const pdfTable=(cols,rows)=>`<table><thead><tr>${cols.filter(c=>c.h).map(c=>`<th${c.t==='money'?' class="r"':''}>${esc(c.h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${cols.filter(c=>c.h).map(c=>c.t==='money'?`<td class="r">${esc(moneyText(c.v(r),c.c?c.c(r):undefined))}</td>`:`<td>${esc(c.t==='html'?(c.x?c.x(r):''):c.v(r)??'')}</td>`).join('')}</tr>`).join('')||'<tr><td>None</td></tr>'}</tbody></table>`;
async function savePdf(body,filename,title='ACCOUNT STATEMENT'){
  const co=companyInfo(),logo=await window.marklendAPI.getLogo().catch(()=>null);
  const lines=[co.address,co.phone,co.email].filter(Boolean).map(esc).join('<br>');
  const head=`<div class="stmt-head"><div class="stmt-brand">${logo?`<img src="${logo}" alt="Company logo">`:''}<div><h1>${esc(co.name)}</h1><p>${lines}</p></div></div><div class="stmt-meta"><b>${esc(title)}</b><span>Generated ${esc(new Date().toLocaleString())}</span></div></div>`;
  const foot=`<div class="stmt-foot">${esc(co.footer||'Thank you for choosing MarkLend.')} · Generated by MarkLend</div>`;
  const html=`<!doctype html><meta charset="utf-8"><style>${PDF_CSS}.stmt-head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;border-bottom:3px solid #ff751f;padding:0 0 13px;margin-bottom:15px}.stmt-brand{display:flex;align-items:center;gap:12px;min-width:0}.stmt-brand img{width:68px;height:68px;object-fit:contain}.stmt-brand h1{font-size:17px;margin:0 0 4px}.stmt-brand p{font-size:9px;line-height:1.5}.stmt-meta{text-align:right;display:grid;gap:5px;font-size:10px}.stmt-meta b{font-size:17px;color:#ff751f;letter-spacing:.04em}.stmt-foot{margin-top:22px;padding-top:9px;border-top:1px solid #e4e7ec;color:#667085;text-align:center;font-size:9px}</style>${head}${body}${foot}`;
  try{const r=await window.marklendAPI.exportPDF({html,filename});if(r?.path)toast('Statement saved')}catch(e){toast('PDF export failed: '+e.message)}
}
async function loanStatement(){
  const {loan,borrower,schedule,reps}=ld;if(!loan)return;const cur=loan.currency;
  return await savePdf(`<p><b>Statement reference:</b> ${esc(loan.loan_number)} · <b>Borrower:</b> ${esc(loan.borrower_name||'')}</p><div class="kv"><div><small>Phone</small>${esc(borrower?.phone||'—')}</div><div><small>Principal</small>${esc(moneyText(loan.principal_minor,cur))}</div><div><small>Outstanding principal</small>${esc(moneyText(loan.outstanding_principal,cur))}</div><div><small>Status</small>${esc(loan.status)}</div>${loan.branch_name?`<div><small>Branch</small>${esc(loan.branch_name)}</div>`:''}<div><small>Period</small>${esc(fdt(loan.start_date||loan.disbursement_date||loan.created_at))} → ${esc(fdt(loan.maturity_date))}</div></div><h2>Repayment schedule</h2>${pdfTable(schedCols(cur),schedule)}<h2>Payments received</h2>${pdfTable(COLS.repayments.filter(c=>c.h!=='Loan'),reps)}`,`marklend-statement-${loan.loan_number}.pdf`,'Loan statement');
}
async function openStatement(){
  const loans=state.loans,reps=state.repayments,name=state.borrowers[0]?.full_name||state.user?.email||'';
  const lc=[{h:'Loan',t:'text',v:r=>r.loan_number},{h:'Status',t:'text',v:r=>r.status},{h:'Principal',t:'money',v:r=>r.principal_minor,c:r=>r.currency},{h:'Outstanding',t:'money',v:r=>r.outstanding_principal,c:r=>r.currency},{h:'Maturity',t:'text',v:r=>fdt(r.maturity_date)}];
  const rc=[{h:'Date',t:'text',v:r=>fdt(r.payment_date)},{h:'Loan',t:'text',v:r=>r.loan_number||''},{h:'Amount',t:'money',v:r=>r.amount_minor,c:r=>r.currency}];
  const currencies=[...new Set([...loans.map(x=>x.currency),...reps.map(x=>x.currency)].filter(Boolean))].sort();
  const sections=currencies.map(cur=>{const ll=loans.filter(x=>x.currency===cur),rr=reps.filter(x=>x.currency===cur),lent=ll.filter(l=>!['Pending Approval','Rejected','Voided'].includes(l.status)).reduce((a,l)=>a+Number(l.principal_minor||0),0),out=ll.filter(l=>OPEN_STATUSES.includes(l.status)).reduce((a,l)=>a+Number(l.outstanding_principal||0),0),paid=rr.reduce((a,r)=>a+Number(r.amount_minor||0),0);return `<h2>${esc(cur)} account summary</h2><div class="kv"><div><small>Total principal disbursed</small>${esc(moneyText(lent,cur))}</div><div><small>Outstanding principal</small>${esc(moneyText(out,cur))}</div><div><small>Total repayments received</small>${esc(moneyText(paid,cur))}</div><div><small>Number of loans</small>${ll.length}</div></div><h2>${esc(cur)} loans</h2>${pdfTable(lc,ll)}<h2>${esc(cur)} payments received</h2>${pdfTable(rc,rr)}`}).join('');
  return await savePdf(`<p><b>Borrower:</b> ${esc(name)} · <b>Statement period:</b> All available records · <b>As at:</b> ${esc(today())}</p>${sections||'<p>No loan or repayment activity is recorded on this account.</p>'}`,`marklend-statement-${today()}.pdf`,'Account statement');
}

/* ---------- borrower financial profile & explainable internal risk indicator ---------- */
function borrowerDonut(title,parts,cur){
  const total=parts.reduce((a,x)=>a+Math.max(0,x.value),0),colors=['#ff751f','#168b68','#3678d8','#e0a126','#9b6bd3'];let angle=0;
  const stops=parts.map((x,i)=>{const pct=total?Math.max(0,x.value)/total*100:0,start=angle;angle+=pct;return `${colors[i%colors.length]} ${start.toFixed(2)}% ${angle.toFixed(2)}%`}).join(',');
  return `<div class="card panel br-chart"><h3>${esc(title)}</h3><div class="br-chart-row"><div class="br-donut" style="background:${total?`conic-gradient(${stops})`:'var(--line)'}"><div><b>${esc(total?moneyText(total,cur):'0')}</b><small>Total</small></div></div><ul>${parts.map((x,i)=>`<li><i style="background:${colors[i%colors.length]}"></i><span>${esc(x.label)}</span><b>${esc(moneyText(x.value,cur))}</b></li>`).join('')}</ul></div></div>`;
}
function borrowerRiskAssessment(b,loans,reps,overdue){
  let score=100,reasons=[],tips=[];
  if(!loans.length){score=65;reasons.push('Insufficient loan history to assess repayment behaviour')}
  if(b.kyc_status==='Rejected'){score-=30;reasons.push('KYC is rejected')}else if(b.kyc_status!=='Verified'){score-=12;reasons.push('KYC is not verified');tips.push('Complete and verify borrower KYC before approving further credit.')}
  if(b.risk_level==='High'){score-=24;reasons.push('Existing risk classification is High')}else if(b.risk_level==='Medium'){score-=10;reasons.push('Existing risk classification is Medium')}
  const overdueAmt=overdue.reduce((a,x)=>a+Number(x.overdue_minor||0),0),lateDays=Math.max(0,...overdue.map(x=>Number(x.days_late||0)));
  if(overdue.length){score-=Math.min(35,12+overdue.length*4+Math.floor(lateDays/30)*3);reasons.push(`${overdue.length} overdue instalment${overdue.length===1?'':'s'}; oldest is ${lateDays} days late`);tips.push('Contact the borrower and agree a documented arrears-clearance plan.')}
  const totalDue=loans.filter(l=>!['Pending Approval','Rejected','Voided'].includes(l.status)).reduce((a,l)=>a+Number(l.principal_minor||0),0),paidPrincipal=reps.reduce((a,r)=>a+Number(r.principal_component_minor||0),0),repayRatio=totalDue?Math.min(1,paidPrincipal/totalDue):0;
  if(loans.length&&repayRatio>=.75){score+=5;reasons.push('Strong cumulative repayment progress')}else if(loans.length&&repayRatio<.25){score-=8;reasons.push('Limited repayment progress relative to disbursed principal')}
  const secured=loans.some(l=>Number(l.collateral_value_minor||0)>0);if(!secured&&loans.some(l=>Number(l.outstanding_principal||0)>0))tips.push('Consider suitable collateral or a guarantor before increasing exposure.');
  if(!loans.length)tips.push('No loan history yet; begin with standard affordability and identity checks.');
  score=Math.max(0,Math.min(100,score));const band=score>=80?'Lower risk':score>=60?'Moderate risk':'Higher risk';
  if(!tips.length)tips.push('Continue routine monitoring and keep repayment records up to date.');
  return{score,band,reasons:reasons.length?reasons:['No material warning indicators found in the available records.'],tips,overdueAmt,lateDays,repayRatio};
}
function brDate(value){if(!value)return null;const d=new Date(String(value).length===10?`${value}T00:00:00`:value);return Number.isNaN(d.getTime())?null:d}
function brMoneyMinor(n,cur){return moneyText(Math.max(0,Number(n)||0),cur)}
function brScheduleRemaining(r){return Math.max(0,Number(r.principal_due_minor||0)-Number(r.principal_paid_minor||0))+Math.max(0,Number(r.interest_due_minor||0)-Number(r.interest_paid_minor||0))+Math.max(0,Number(r.fee_due_minor||0)-Number(r.fee_paid_minor||0))+Math.max(0,Number(r.penalty_due_minor||0)-Number(r.penalty_paid_minor||0))}
function brBuildWarnings(loans,schedules,cur){
  const now=brDate(today()),soon=new Date(now);soon.setDate(soon.getDate()+14);
  const loanById=new Map(loans.map(l=>[l.id,l])),overdue=[],upcoming=[];
  for(const r of schedules){const left=brScheduleRemaining(r);if(!left)continue;const due=brDate(r.due_date),loan=loanById.get(r.loan_id);if(!due||!loan||!OPEN_STATUSES.includes(loan.status))continue;
    const item={loan,date:r.due_date,amount:left,days:Math.floor((now-due)/86400000)};
    if(due<now)overdue.push(item);else if(due<=soon)upcoming.push(item);
  }
  const maturity=loans.filter(l=>OPEN_STATUSES.includes(l.status)&&Number(l.outstanding_principal||0)>0).map(l=>({loan:l,date:l.maturity_date,days:Math.floor((brDate(l.maturity_date)-now)/86400000)})).filter(x=>x.date&&x.days>=0&&x.days<=14);
  overdue.sort((a,b)=>a.date.localeCompare(b.date));upcoming.sort((a,b)=>a.date.localeCompare(b.date));maturity.sort((a,b)=>a.days-b.days);
  return {overdue,upcoming,maturity,overdueTotal:overdue.reduce((a,x)=>a+x.amount,0)};
}
function brWarningPanel(w,cur,available=true){
  if(!available)return `<div class="card panel br-section"><h3>Early warning alerts</h3><div class="alert warn">Instalment schedule data could not be loaded. No conclusion can be made about overdue or upcoming instalments. Check the staff loan-view permission and try again.</div></div>`;
  const rows=[...w.overdue.map(x=>({kind:'Overdue instalment',loan:x.loan,date:x.date,amount:x.amount,detail:`${x.days} day${x.days===1?'':'s'} late`,tone:'bad'})),...w.upcoming.map(x=>({kind:'Instalment due soon',loan:x.loan,date:x.date,amount:x.amount,detail:'Due within 14 days',tone:'warn'})),...w.maturity.map(x=>({kind:'Loan maturity approaching',loan:x.loan,date:x.date,amount:Number(x.loan.outstanding_principal||0),detail:`Matures in ${x.days} day${x.days===1?'':'s'}`,tone:'warn'}))];
  return `<div class="card panel br-section"><div class="br-section-head"><div><h3>Early warning alerts</h3><p>Overdue instalments, upcoming payments and approaching maturities</p></div><span class="br-count">${rows.length} alert${rows.length===1?'':'s'}</span></div>${rows.length?`<div class="br-alert-list">${rows.map(x=>`<div class="br-alert ${x.tone}"><div><b>${esc(x.kind)}</b><small>${esc(x.loan.loan_number)} · ${esc(x.loan.status)} · ${esc(fdt(x.date))}</small></div><div class="br-alert-right"><b>${esc(moneyText(x.amount,cur))}</b><small>${esc(x.detail)}</small></div><button class="btn mini" onclick="openLoanDetail('${x.loan.id}')">View loan</button></div>`).join('')}</div>`:'<div class="br-clear">No overdue instalments or payments/maturities due in the next 14 days.</div>'}</div>`;
}
function brRecommendations(risk,repeat,warning,collateral,out,loans,cur,scheduleAvailable=true){
  const actions=[];
  if(!scheduleAvailable)actions.push({level:'warn',title:'Verify the repayment schedule before a lending decision',body:'The application could not read instalment schedules. Confirm overdue status and upcoming dues from the loan record before approving further credit.'});
  if(warning.overdue.length)actions.push({level:'urgent',title:'Pause additional lending until arrears are addressed',body:`There are ${warning.overdue.length} overdue instalment(s) totalling ${moneyText(warning.overdueTotal,cur||loans[0]?.currency||'MWK')}. Agree and record an arrears-clearance plan before considering new credit.`});
  if(risk.band==='Higher risk')actions.push({level:'urgent',title:'Refer for management review',body:'Do not rely on the score alone. Review repayment conduct, current exposure, KYC and verified affordability before any further disbursement.'});
  else if(risk.band==='Moderate risk')actions.push({level:'warn',title:'Use a controlled repeat-loan assessment',body:'Require updated income and expense information, confirm other debts and obtain management approval before increasing exposure.'});
  else if(repeat.completed>0)actions.push({level:'good',title:'Consider repeat-borrower terms',body:`${repeat.completed} loan(s) are recorded as completed. Consider a repeat facility only after affordability, KYC and current obligations are rechecked.`});
  if(out>0&&collateral<=0)actions.push({level:'warn',title:'Review security for the current exposure',body:'No collateral value is recorded against this borrower’s loans. Consider suitable collateral or a guarantor where policy requires it.'});
  else if(out>0&&collateral>0){const cover=collateral/out*100;actions.push({level:cover>=100?'good':'warn',title:'Check collateral coverage',body:`Recorded collateral is ${cover.toFixed(1)}% of outstanding principal. Confirm ownership, valuation and enforceability before relying on the security.`})}
  if(!loans.length)actions.push({level:'info',title:'Complete first-loan checks',body:'There is no loan history. Complete KYC and affordability checks before approving a first facility.'});
  if(scheduleAvailable&&!warning.overdue.length&&!warning.upcoming.length&&!warning.maturity.length)actions.push({level:'good',title:'Maintain routine monitoring',body:'No current schedule or maturity warning was identified in the available records. Keep borrower contact and payment records current.'});
  return actions;
}
async function openBorrowerAnalytics(id,currency=state.currency){
  if(!can('borrowers'))return toast('You do not have permission to view borrower profiles.');
  modal(`<div class="modal-head"><div><h2 style="margin:0">Borrower financial profile</h2><span style="font-size:11px;color:var(--muted)">Loading borrower history and monitoring indicators…</span></div>${CLOSE_BTN}</div><div class="empty">Loading borrower, loan, repayment and schedule records…</div>`,{wide:true});
  try{
    const [br,lr,rr]=await Promise.all([safeQ('borrower_summary',{filters:[['id','eq',id]],from:0,to:0}),safeQ('loan_summary',{filters:[['borrower_id','eq',id],['currency','eq',currency]],order:[['created_at',false]],from:0,to:499}),safeQ('repayment_summary',{filters:[['borrower_id','eq',id],['currency','eq',currency]],order:[['payment_date',false]],from:0,to:999})]);
    const b=br.data[0];if(!b)throw new Error('Borrower not found or access denied.');
    const loans=lr.data||[],reps=rr.data||[],cur=currency,ids=loans.map(l=>l.id),idFilter=ids.length?`(${ids.join(',')})`:null;
    const [sr,er]=idFilter?await Promise.all([safeQ('loan_schedules',{filters:[['loan_id','in',idFilter]],order:[['due_date',true]],from:0,to:1999}),safeQ('loan_extensions',{filters:[['loan_id','in',idFilter]],order:[['created_at',false]],from:0,to:499})]):[{data:[]},{data:[]}];
    const schedules=sr.data||[],extensions=er.data||[],open=loans.filter(l=>OPEN_STATUSES.includes(l.status)),out=open.reduce((a,l)=>a+Number(l.outstanding_principal||0),0),lent=loans.filter(l=>!['Pending Approval','Rejected','Voided'].includes(l.status)).reduce((a,l)=>a+Number(l.principal_minor||0),0),paid=reps.reduce((a,r)=>a+Number(r.amount_minor||0),0),warning=brBuildWarnings(loans,schedules,cur);
    const overdue=warning.overdue.map(x=>({loan_id:x.loan.id,overdue_minor:x.amount,days_late:x.days})),risk=borrowerRiskAssessment(b,loans,reps,overdue),collateral=open.reduce((a,l)=>a+Number(l.collateral_value_minor||0),0);
    const completed=loans.filter(l=>l.status==='Completed'&&Number(l.outstanding_principal||0)===0).length,defaulted=loans.filter(l=>l.status==='Defaulted'||l.status==='Written-Off').length,repeat={completed,defaulted,repeat:completed>0};
    const statusParts=['Active','Restructured','Defaulted','Completed','Written-Off'].map(st=>({label:st,value:loans.filter(l=>l.status===st).reduce((a,l)=>a+Number(l.outstanding_principal||0),0)})).filter(x=>x.value>0);
    const allocation=[{label:'Principal',value:reps.reduce((a,r)=>a+Number(r.principal_component_minor||0),0)},{label:'Interest',value:reps.reduce((a,r)=>a+Number(r.interest_component_minor||0),0)},{label:'Fees',value:reps.reduce((a,r)=>a+Number(r.fee_component_minor||0),0)},{label:'Penalties',value:reps.reduce((a,r)=>a+Number(r.penalty_component_minor||0),0)}].filter(x=>x.value>0);
    const loanRows=loans.map(l=>`<tr><td>${esc(l.loan_number)}</td><td>${esc(l.status)}</td><td class="num">${esc(moneyText(l.principal_minor,l.currency))}</td><td class="num">${esc(moneyText(l.outstanding_principal,l.currency))}</td><td>${esc(fdt(l.maturity_date))}</td></tr>`).join('');
    const events=[];
    loans.forEach(l=>{events.push({date:l.created_at||l.start_date||l.disbursement_date,type:'Loan created',detail:`${l.loan_number} · ${l.status}`,amount:Number(l.principal_minor||0),cur:l.currency,loan:l});if(l.disbursement_date)events.push({date:l.disbursement_date,type:'Loan disbursed',detail:l.loan_number,amount:Number(l.principal_minor||0),cur:l.currency,loan:l})});
    reps.forEach(r=>events.push({date:r.payment_date||r.created_at,type:'Repayment received',detail:`${r.loan_number||'Loan'} · Payment recorded`,amount:Number(r.amount_minor||0),cur:r.currency,loan:loans.find(l=>l.id===r.loan_id)}));
    extensions.forEach(x=>{const l=loans.find(z=>z.id===x.loan_id);events.push({date:x.created_at,type:'Loan extended / restructured',detail:`${l?.loan_number||'Loan'} · ${x.reason||'Extension recorded'} · New maturity ${fdt(x.new_maturity)}`,amount:Number(x.remaining_principal_minor||0),cur:l?.currency||cur,loan:l})});
    events.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
    const extensionAvailable=!er.error;const eventRows=events.slice(0,100).map(e=>`<div class="br-event"><span class="br-event-dot ${e.type==='Repayment received'?'paid':e.type.includes('extended')?'extended':'loan'}"></span><div class="br-event-main"><b>${esc(e.type)}</b><small>${esc(fdt(e.date))} · ${esc(e.detail)}</small></div><strong>${esc(moneyText(e.amount,e.cur))}</strong>${e.loan?`<button class="btn mini" onclick="openLoanDetail('${e.loan.id}')">Open</button>`:''}</div>`).join('');
    const scheduleAvailable=!sr.error,actions=brRecommendations(risk,repeat,warning,collateral,out,loans,cur,scheduleAvailable),riskColor=risk.score>=80?'#168b68':risk.score>=60?'#d18b19':'#c43b32';
    const repBadge=repeat.repeat?`<span class="br-repeat good">Repeat borrower · ${completed} settled</span>`:'<span class="br-repeat">No completed loan history yet</span>';
    modal(`<div class="modal-head"><div><h2 style="margin:0">${esc(b.full_name)}</h2><span style="font-size:11px;color:var(--muted)">${esc([b.phone,b.email,branchName(b.branch_id)].filter(Boolean).join(' · '))} · Showing ${esc(cur)} records</span><div style="margin-top:6px">${repBadge}</div></div><div><select aria-label="Profile currency" onchange="openBorrowerAnalytics('${id}',this.value)">${CURRENCIES.map(c=>`<option${c===cur?' selected':''}>${c}</option>`).join('')}</select> ${can('borrowers','edit')?`<button class="btn mini" onclick="closeModal();openEditBorrowerModal('${id}')">Edit borrower</button> `:''}${CLOSE_BTN}</div></div>
    <div class="br-risk"><div><small>Internal risk indicator</small><div class="br-score" style="color:${riskColor}">${risk.score}<small>/100</small></div><b>${risk.band}</b></div><div><b>Why this score?</b><ul>${risk.reasons.map(x=>`<li>${esc(x)}</li>`).join('')}</ul><small>Indicative management aid based only on MarkLend records; not a credit-bureau score or lending decision.</small></div></div>
    <div class="br-stats"><div><small>Total borrowed</small><b>${esc(moneyText(lent,cur))}</b></div><div><small>Outstanding principal</small><b>${esc(moneyText(out,cur))}</b></div><div><small>Repayments received</small><b>${esc(moneyText(paid,cur))}</b></div><div><small>Overdue exposure</small><b>${esc(moneyText(warning.overdueTotal,cur))}</b></div><div><small>Loans / active</small><b>${loans.length} / ${open.length}</b></div><div><small>Completed / defaulted</small><b>${completed} / ${defaulted}</b></div><div><small>Collateral recorded</small><b>${esc(moneyText(collateral,cur))}</b></div><div><small>Repayment progress</small><b>${(risk.repayRatio*100).toFixed(1)}%</b></div></div>
    <div class="br-charts">${borrowerDonut('Outstanding by loan status',statusParts.length?statusParts:[{label:'No outstanding loans',value:0}],cur)}${borrowerDonut('Repayment allocation',allocation.length?allocation:[{label:'No repayments recorded',value:0}],cur)}</div>
    ${brWarningPanel(warning,cur,scheduleAvailable)}
    <div class="card panel br-section"><div class="br-section-head"><div><h3>Risk-based lending recommendations</h3><p>Suggested management actions based on current records; review before making a credit decision</p></div></div><div class="br-action-list">${actions.map(a=>`<div class="br-action ${a.level}"><b>${esc(a.title)}</b><p>${esc(a.body)}</p></div>`).join('')}</div></div>
    <div class="card panel br-section"><div class="br-section-head"><div><h3>Borrower timeline</h3><p>Chronological loan origination, extensions and repayments</p></div><span class="br-count">${events.length} events</span></div>${extensionAvailable?'':`<div class="alert warn" style="margin-bottom:8px">Loan extension history could not be loaded; the timeline may be incomplete.</div>`}<div class="br-timeline">${eventRows||'<div class="br-clear">No account events recorded.</div>'}</div>${events.length>100?`<small class="muted">Showing the latest 100 of ${events.length} events.</small>`:''}</div>
    <div class="card panel br-section"><h3>Loan history</h3><div class="table-wrap"><table><thead><tr><th>Loan</th><th>Status</th><th>Principal</th><th>Outstanding</th><th>Maturity</th></tr></thead><tbody>${loanRows||'<tr><td colspan="5">No loans recorded.</td></tr>'}</tbody></table></div></div>
    <div class="cf-act"><button class="btn" onclick="closeModal()">Close</button></div>`,{wide:true});
  }catch(e){modal(`<div class="modal-head"><h2>Borrower profile unavailable</h2>${CLOSE_BTN}</div><div class="alert bad">${esc(e.message||'Could not load borrower analytics.')}</div>`,{wide:true})}
}
/* ---------- borrowers (now backed by the paged server list) ---------- */
function openEditBorrowerModal(id){
  const b=pgs('borrowers').rows.find(x=>x.id===id)||(state.branchQueue?.kyc?.rows||[]).find(x=>x.id===id);if(!b)return;
  const ver=b.kyc_verified_at?sub(`Verified ${esc(fdt(b.kyc_verified_at))}`):'';
  modal(`<div class="modal-head"><div><h2 style="margin-bottom:4px">Update borrower</h2>${sub('Required fields remain mandatory.')}${ver}</div>${CLOSE_BTN}</div><div class="formgrid">${FIELD('Full name',`<input id="ebName" required value="${esc(b.full_name)}">`)}${FIELD('Phone',`<input id="ebPhone" required type="tel" value="${esc(b.phone||'')}">`)}${FIELD('Email',`<input id="ebEmail" required type="email" value="${esc(b.email||'')}">`)}${FIELD('Risk level',`<select id="ebRisk">${['Low','Medium','High'].map(x=>`<option${b.risk_level===x?' selected':''}>${x}</option>`).join('')}</select>`)}${FIELD('KYC status',`<select id="ebKyc" onchange="kycStatusChanged(this)">${['Pending','Verified','Rejected'].map(x=>`<option${b.kyc_status===x?' selected':''}>${x}</option>`).join('')}</select>`)}${kycReasonField(b)}</div>${kycFields(b)}<div class="cf-act"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="updateBorrower('${id}')">Save changes</button></div>`);
}
async function patchBorrower(id,v){
  const {data,error}=await state.sb.from('borrowers').update({...v,updated_at:new Date().toISOString()}).eq('id',id).execute();
  if(error)throw error;if(!data?.length)throw new Error('No row updated (check your permissions).');
  const rows=pgs('borrowers').rows,i=rows.findIndex(x=>x.id===id);if(i>=0)rows[i]={...rows[i],...data[0]};pgPaint('borrowers');state.branchQueue=null;
}
async function updateBorrower(id){
  const full_name=$('ebName').value.trim(),phone=$('ebPhone').value.trim(),email=$('ebEmail').value.trim(),risk_level=$('ebRisk').value,kyc_status=$('ebKyc').value;
  if(!full_name||!phone||!email)return toast('Please complete every required borrower field.');
  if(!/^\S+@\S+\.\S+$/.test(email))return toast('Enter a valid borrower email address.');
  const k=kycValues(),reason=($('kfReason')?.value||'').trim(),why=kycProblem(kyc_status,k,reason);
  if(why)return toast(why);
  const o=pgs('borrowers').rows.find(x=>x.id===id)||(state.branchQueue?.kyc?.rows||[]).find(x=>x.id===id);
  const KEYS=['full_name','phone','email','risk_level','kyc_status','kyc_reason','id_type','id_number','address','next_of_kin_name','next_of_kin_phone'];
  const prev=Object.fromEntries(KEYS.map(x=>[x,o?.[x]??null]));
  const next={full_name,phone,email,risk_level,kyc_status,kyc_reason:kyc_status==='Rejected'?reason:null,...k};
  try{await patchBorrower(id,next)}catch(e){return toast(`Could not update borrower: ${e.message}`)}
  closeModal();
  /* Undo restores the details, but KYC status changes are audited and verifier-stamped on the server, so only offer it for plain edits. */
  toast('Borrower updated',prev.kyc_status===kyc_status?{undo:()=>patchBorrower(id,prev)}:{});
}
async function createBorrower(){
  if(!state.sb)return toast('Connect Supabase first.');
  const name=$('bfName').value.trim(),phone=$('bfPhone').value.trim(),email=$('bfEmail').value.trim(),risk=$('bfRisk').value,kyc=$('bfKyc').value;
  if(!name||!phone||!email||!risk||!kyc)return toast('Please complete every required borrower field.');
  if(!/^\S+@\S+\.\S+$/.test(email))return toast('Enter a valid borrower email address.');
  const k=kycValues(),reason=($('kfReason')?.value||'').trim(),why=kycProblem(kyc,k,reason);
  if(why)return toast(why);
  const row={full_name:name,phone,email,risk_level:risk,kyc_status:kyc,user_id:null,kyc_reason:kyc==='Rejected'?reason:null,...k};
  if(isAdminUser()){const br=$('bfBranch')?.value;if(!br)return toast('Choose the branch this borrower belongs to.');row.branch_id=br}
  const {error}=await state.sb.from('borrowers').insert(row).select().single();
  if(error)return toast(`Could not create borrower: ${error.message}`);
  closeModal();state.branchQueue=null;pgRefresh('borrowers');toast('Borrower created successfully');
}

/* ---------- lending capital (currency defaults to the one on screen) ---------- */
const curOpts=()=>CURRENCIES.map(c=>`<option${c===state.currency?' selected':''}>${c}</option>`).join('');
function openCapitalModal(){
  modal(`<div class="modal-head"><h2>Fund lending capital</h2>${CLOSE_BTN}</div><div class="formgrid">${FIELD('Amount','<input id="capAmount" type="number" min="0.01" step="0.01">')}${FIELD('Currency',`<select id="capCurrency">${curOpts()}</select>`)}${FIELD('Source','<input id="capSource" placeholder="Owner injection, bank…">')}${FIELD('Reference','<input id="capRef">')}</div><div class="cf-act"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="addCapital()">Add capital</button></div>`);
}
function openCapitalOutModal(){
  modal(`<div class="modal-head"><div><h2 style="margin-bottom:4px">Withdraw lending capital</h2>${sub('Withdrawal is blocked if it would make the selected pool negative.')}</div>${CLOSE_BTN}</div><div class="formgrid">${FIELD('Amount','<input id="capOutAmount" type="number" min="0.01" step="0.01">')}${FIELD('Currency',`<select id="capOutCurrency">${curOpts()}</select>`)}${FIELD('Reason/source','<input id="capOutSource" placeholder="Bank withdrawal, owner draw…">')}${FIELD('Reference','<input id="capOutRef">')}</div><div class="cf-act"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="withdrawCapital()">Withdraw</button></div>`);
}

