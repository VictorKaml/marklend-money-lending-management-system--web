/* 1.11 Extend a loan: when a customer is past due or has only part-paid, reschedule what is still owed over a longer period.
 * The database does the maths (extend_loan, with a preview mode); this file asks for the choices and shows the plan before anything is saved. */
const canExtendLoan=()=>roleOf()==='Admin'||(roleOf()==='Branch Manager'&&can('loans','approve'));
const EXT={loan:null,pv:null,seq:0,busy:false,from:'detail',timer:null,ok:false};
const addDaysISO=(iso,n)=>{const d=new Date(iso+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
/* the earliest end date the database accepts: the day after the later of today and the current end date */
const extMinDate=l=>{const t=today(),m=l.maturity_date||t;return addDaysISO(m>t?m:t,1)};
const extBase=l=>{const t=today(),m=l.maturity_date||t;return m>t?m:t};

/* Reads the form; returns {args} to send, or {problem} to show. Pure apart from reading the fields. */
function extInputs(l,f){
  const min=extMinDate(l);
  if(!f.date)return{problem:'Choose the new end date.'};
  if(f.date<min)return{problem:`The new end date must be ${fdt(min)} or later.`};
  // Blank optional rate/fee fields mean zero. Reject non-numeric and out-of-range values locally.
  const rate=(f.rate==null||String(f.rate).trim()==='')?0:Number(f.rate);
  if(!Number.isFinite(rate)||rate<0||rate>100)return{problem:'The extension interest rate must be between 0% and 100%.'};
  const fee=(f.fee==null||String(f.fee).trim()==='')?0:Number(f.fee);
  if(!Number.isFinite(fee)||fee<0)return{problem:'The extension fee cannot be negative.'};
  return{args:{
    p_loan_id:l.id,
    p_new_maturity:f.date,
    p_extra_interest_bps:Math.round(rate*100),
    p_fee_minor:Math.round(fee*100),
    p_waive_penalties:!!f.waive
  }};
}
const extForm=()=>({date:$('exDate')?.value||'',rate:$('exRate')?.value??'',fee:$('exFee')?.value??'',waive:!!$('exWaive')?.checked,reason:($('exReason')?.value||'').trim()});

async function openExtendLoan(id,from){
  const l=await getLoan(id);if(!l)return toast('Loan not found.');
  if(!OPEN_STATUSES.includes(l.status))return toast('Only a running loan can be extended.');
  Object.assign(EXT,{loan:l,pv:null,busy:false,from:from||'detail',ok:false});
  const min=extMinDate(l),base=extBase(l),admin=roleOf()==='Admin';
  modal(`<div class="modal-head"><div><h2 style="margin-bottom:4px">Extend loan</h2>${sub(esc(l.loan_number)+' · '+esc(l.borrower_name||'')+' · now ends '+esc(fdt(l.maturity_date)))}</div>${CLOSE_BTN}</div>
<div class="cf-sub" style="margin-bottom:10px">What is still unpaid is rescheduled to the new date. An optional extension-period interest charge is calculated on principal still owed. Amounts already paid stay as they are. Nothing is saved until you confirm.</div>
<div class="field"><label>New end date <span class="required">*</span></label><div style="display:flex;gap:6px;flex-wrap:wrap"><input id="exDate" type="date" min="${esc(min)}" oninput="extPreviewSoon()">${[30,60,90].map(n=>`<button type="button" class="btn mini" onclick="extQuick('${addDaysISO(base,n)}')">+${n} days</button>`).join('')}</div></div>
<div class="formgrid"><div class="field"><label>Interest rate for each new extension period</label><input id="exRate" type="number" min="0" max="100" step="0.01" value="0" oninput="extPreviewSoon()"><div class="cf-sub">Enter 0% for no additional interest, or choose an extension-period rate. The full charge applies even if paid early.</div></div>
<div class="field"><label>Extension fee (${esc(l.currency)})</label><input id="exFee" type="number" min="0" step="0.01" value="0" oninput="extPreviewSoon()"></div></div>
${admin?`<label style="display:flex;gap:8px;align-items:center;margin:8px 0;font-size:13px"><input type="checkbox" id="exWaive" onchange="extPreviewSoon()"> Waive the unpaid penalties (administrators only)</label>`:''}
<div id="exPreview" aria-live="polite"></div>
<div class="field" style="margin-top:12px"><label>Reason <span class="required">*</span></label><textarea id="exReason" maxlength="300" placeholder="e.g. Customer lost income this month and agreed a new plan" oninput="extReady()"></textarea></div>
<div class="cf-act"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="exGo" onclick="extSubmit()" disabled>Extend loan</button></div>`,{wide:true});
  extPaintPreview();
}
function extQuick(d){$('exDate').value=d;extPreviewSoon()}
function extPreviewSoon(){clearTimeout(EXT.timer);EXT.ok=false;extReady();EXT.timer=setTimeout(extPreview,300)}
function extReady(){const g=$('exGo');if(g)g.disabled=!(EXT.ok&&!EXT.busy&&extForm().reason.length>=5)}
async function extPreview(){
  const l=EXT.loan;if(!l||!$('exDate'))return;
  const r=extInputs(l,extForm()),seq=++EXT.seq;
  if(r.problem){EXT.pv={problem:r.problem};EXT.ok=false;return extPaintPreview()}
  const {data,error}=await state.sb.rpc('extend_loan',{...r.args,p_reason:'preview only',p_preview:true});
  if(seq!==EXT.seq||!$('exPreview'))return;
  EXT.pv=error?{error:error.message}:data;EXT.ok=!error&&!!data&&!data.error;extPaintPreview();extReady();
}
function extPaintPreview(){
  const h=$('exPreview');if(!h)return;
  const p=EXT.pv,cur=EXT.loan.currency;
  if(!p){h.innerHTML='<div class="cf-sub" style="margin-top:10px">Choose the new end date to see the new plan.</div>';return}
  if(p.problem){h.innerHTML=`<div class="cf-sub" style="margin-top:10px">${esc(p.problem)}</div>`;return}
  if(p.error){h.innerHTML=`<div class="alert bad" style="margin-top:10px">${esc(p.error)}</div>`;return}
  const m=v=>mc(v,cur),rows=p.rows||[],shown=rows.slice(0,12);
  const line=(k,v,b)=>`<div${b?' style="border-top:1px solid var(--line);padding-top:6px;font-size:14px"':''}><span>${k}</span><b>${v}</b></div>`;
  h.innerHTML=`<div class="cf-math" style="margin-top:12px">${line('Principal still owed',m(p.remaining_principal_minor))}${line('Interest still owed',m(p.remaining_interest_minor))}${Number(p.remaining_fee_minor)?line('Fees still owed',m(p.remaining_fee_minor)):''}${Number(p.remaining_penalty_minor)?line('Penalties still owed',m(p.remaining_penalty_minor)):''}${Number(p.waived_penalty_minor)?line('Penalties waived','− '+m(p.waived_penalty_minor)):''}${Number(p.extra_interest_minor)?line('Extra interest',m(p.extra_interest_minor)):''}${Number(p.fee_minor)?line('Extension fee',m(p.fee_minor)):''}${line('Total to pay',m(p.total_to_pay_minor),true)}</div>
<div class="cf-sub" style="margin:8px 0 4px">${p.instalments} instalment${p.instalments>1?'s':''}, from ${esc(fdt(rows[0]?.due_date))} to ${esc(fdt(p.new_maturity))}. The loan will show as Restructured.</div>
<div class="table-wrap" style="max-height:220px;overflow:auto"><table class="table"><thead><tr><th>Due</th><th class="num">Principal</th><th class="num">Interest</th><th class="num">Fees and penalties</th><th class="num">Instalment</th></tr></thead><tbody>${shown.map(r=>`<tr><td>${esc(fdt(r.due_date))}</td><td class="num">${m(r.principal_minor)}</td><td class="num">${m(r.interest_minor)}</td><td class="num">${m(Number(r.fee_minor)+Number(r.penalty_minor))}</td><td class="num"><b>${m(r.total_minor)}</b></td></tr>`).join('')}</tbody></table></div>${rows.length>shown.length?`<div class="cf-sub">+ ${rows.length-shown.length} more instalments</div>`:''}`;
}
async function extSubmit(){
  const l=EXT.loan;if(!l||EXT.busy)return;
  const f=extForm(),r=extInputs(l,f);
  if(r.problem)return toast(r.problem);
  if(f.reason.length<5)return toast('Give a reason (at least 5 characters).');
  EXT.busy=true;extReady();
  const {error}=await state.sb.rpc('extend_loan',{...r.args,p_reason:f.reason,p_preview:false});
  EXT.busy=false;
  if(error){extReady();return toast(error.message)}
  closeModal();await loadData();
  ['loans','repayments'].forEach(v=>pgRefresh(v));
  toast('Loan extension saved.');
  if(EXT.from==='detail')openLoanDetail(l.id);
}
