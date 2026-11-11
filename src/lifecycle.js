/* 1.10 lifecycle: void a payment, void or delete a loan, and manual invoices.
 * Nothing is ever silently erased: every reversal needs a reason and is kept in the audit log; the money side
 * (ledger, capital, instalments) is reversed by the database in one transaction. */

/* ---------- who may do what (the database enforces the same rules) ---------- */
const roleOf=()=>state.userProfile?.role;
const canVoidPayment=loan=>!!loan&&(roleOf()==='Admin'||(roleOf()==='Branch Manager'&&can('repayments','approve')))&&!['Written-Off','Voided'].includes(loan.status);
const canVoidLoan=(loan,reps)=>!!loan&&roleOf()==='Admin'&&OPEN_STATUSES.includes(loan.status)&&!(reps||[]).length;
const canDeleteLoan=loan=>!!loan&&['Pending Approval','Rejected'].includes(loan.status)&&(roleOf()==='Admin'||(roleOf()==='Branch Manager'&&can('loans','approve')));
/* the payment the database will accept a void for: the most recently recorded one */
const latestPaymentId=reps=>(reps||[]).reduce((b,r)=>!b||String(r.created_at)>String(b.created_at)?r:b,null)?.id||null;

/* ---------- one reason dialog for all reversals ---------- */
let reasonSubmit=null;
function reasonModal({title,subtitle,warn,button,onSubmit}){
  reasonSubmit=onSubmit;
  modal(`<div class="modal-head"><div><h2 style="margin-bottom:4px">${esc(title)}</h2>${sub(esc(subtitle||''))}</div>${CLOSE_BTN}</div>${warn?`<div class="alert warn" style="margin-bottom:12px">${warn}</div>`:''}<div class="field"><label>Reason <span class="required">*</span></label><textarea id="rsText" maxlength="300" placeholder="Why is this being reversed? It is kept in the audit log."></textarea></div><div class="cf-act"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn danger" id="rsGo" onclick="reasonGo()">${esc(button)}</button></div>`);
}
async function reasonGo(){
  const t=($('rsText').value||'').trim();
  if(t.length<5)return toast('Give a reason (at least 5 characters).');
  const b=$('rsGo');b.disabled=true;
  try{await reasonSubmit(t)}finally{const g=$('rsGo');if(g)g.disabled=false}
}
async function lifecycleCall(fn,args,done){
  const {error}=await state.sb.rpc(fn,args);
  if(error)return toast(error.message);
  closeModal();await loadData();
  ['loans','repayments','borrowers'].forEach(v=>pgRefresh(v));
  RC&&(RC.key='');
  toast(done);return true;
}

function openVoidPayment(id){
  const r=(ld.reps||[]).find(x=>x.id===id);if(!r)return;
  reasonModal({title:'Void payment',subtitle:`${r.loan_number} · paid ${fdt(r.payment_date)}`,button:'Void payment',
    warn:`This reverses <b>${esc(moneyText(r.amount_minor,r.currency))}</b>. The instalments it settled become unpaid again, the ledger gets a reversing entry and the principal part leaves lending capital. If the loan was completed it becomes active again. Only the latest payment of a loan can be voided.`,
    onSubmit:async reason=>{if(await lifecycleCall('void_repayment',{p_repayment_id:id,p_reason:reason},'Payment voided.'))openLoanDetail(r.loan_id)}});
}
function openVoidLoan(id){
  const l=ld.loan;if(!l||l.id!==id)return;
  reasonModal({title:'Void loan',subtitle:`${l.loan_number} · ${l.borrower_name||''}`,button:'Void loan',
    warn:`Use this when a loan was approved and paid out by mistake. It reverses the disbursement of <b>${esc(moneyText(l.principal_minor,l.currency))}</b> and returns it to lending capital. The loan stays on record as Voided. A loan with payments cannot be voided: void its payments first, newest first.`,
    onSubmit:async reason=>{if(await lifecycleCall('void_loan',{p_loan_id:id,p_reason:reason},'Loan voided.'))openLoanDetail(id)}});
}
function openDeleteLoan(id){
  const l=ld.loan;if(!l||l.id!==id)return;
  reasonModal({title:'Delete loan',subtitle:`${l.loan_number} · ${l.borrower_name||''} · ${l.status}`,button:'Delete loan',
    warn:'This loan never paid out, so it is removed. The audit log keeps who deleted it, the loan details and the reason. A loan that has paid out cannot be deleted; void it instead.',
    onSubmit:async reason=>{await lifecycleCall('delete_loan',{p_loan_id:id,p_reason:reason},'Loan deleted.')}});
}

/* ======================= manual invoices ======================= */
const canMakeInvoice=()=>can('loans','create')&&['Admin','Branch Manager','Loan Officer'].includes(roleOf());
const canVoidInvoice=()=>['Admin','Branch Manager'].includes(roleOf());
const MI=state.mi=state.mi||{lines:[],busy:false};
const miNum=v=>Math.round(Number(v||0)*100);
const miLineTotal=l=>Math.max(0,Math.floor(Number(l.qty)||0))*miNum(l.price);
const miTotal=lines=>lines.reduce((a,l)=>a+miLineTotal(l),0);

function invoicesView(c){
  c.innerHTML=listCard('invoices','Invoices','Invoices you issue outside a loan: fees, services, anything else. Saved invoices get a number; unsaved ones are just a PDF.',canMakeInvoice()?'<button class="btn primary" onclick="openManualInvoice()">+ New invoice</button>':'');
  pgView('invoices');
}
const fetchAnyBorrowers=async q=>{const t=q.trim(),r=await state.sb.query('borrower_summary',{or:t?['full_name','phone','email'].map(c=>`${c}.ilike.${likeTerm(t)}`).join(','):null,order:[['full_name',true]],from:0,to:7});return r.data.map(b=>({id:b.id,title:b.full_name,sub:[b.phone,b.email].filter(Boolean).join(' · '),b}))};

function openManualInvoice(){
  MI.lines=[{description:'',qty:1,price:''}];MI.busy=false;
  const admin=roleOf()==='Admin',branches=activeBranches();
  modal(`<div class="modal-head"><div><h2 style="margin-bottom:4px">New invoice</h2>${sub('Not tied to a loan. Add what you are charging for.')}</div>${CLOSE_BTN}</div>
<div class="field"><label>Existing borrower (optional)</label>${pickerHTML('miB',{ph:'Search borrower to fill the details',fetch:fetchAnyBorrowers,onPick:r=>miPickBorrower(r.b)})}</div>
<div class="formgrid"><div class="field"><label>Customer name <span class="required">*</span></label><input id="miName" maxlength="120"></div><div class="field"><label>Email</label><input id="miEmail" type="email"></div><div class="field"><label>Phone</label><input id="miPhone"></div><div class="field"><label>Address</label><input id="miAddr"></div>
<div class="field"><label>Currency</label><select id="miCur">${CURRENCIES.map(c=>`<option${c===state.currency?' selected':''}>${c}</option>`).join('')}</select></div>
${admin&&branches.length?`<div class="field"><label>Branch</label><select id="miBranch">${branchOpts(null,branches)}</select></div>`:''}
<div class="field"><label>Issue date</label><input id="miIssue" type="date" value="${esc(today())}"></div><div class="field"><label>Due date</label><input id="miDue" type="date"></div></div>
<h3 class="t" style="margin:14px 0 6px;font-size:13px">Items</h3><div id="miLines"></div><button class="btn mini" onclick="miAddLine()">+ Add item</button>
<div class="field" style="margin-top:12px"><label>Notes (shown on the invoice)</label><textarea id="miNotes" maxlength="500"></textarea></div>
<label style="display:flex;gap:8px;align-items:center;margin-top:10px;font-size:13px"><input type="checkbox" id="miSave" checked> Save this invoice and give it a number</label>
<div class="cf-sub" id="miHint" style="margin-top:4px"></div>
<div class="cf-act"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="miGo" onclick="submitManualInvoice()">Create PDF</button></div>`,{wide:true});
  miPaintLines();$('miSave').onchange=miHint;miHint();
}
function miHint(){const h=$('miHint');if(h)h.textContent=$('miSave').checked?'Saved invoices appear in the Invoices list, can be reissued and voided, and have a number like MI-2026-0001.':'Not saved: the PDF is shown as "Not recorded", has no number and cannot be found here later.'}
function miPickBorrower(b){$('miName').value=b.full_name||'';$('miEmail').value=b.email||'';$('miPhone').value=b.phone||'';$('miAddr').value=b.address||'';MI.borrowerId=b.id}
function miPaintLines(){
  const h=$('miLines');if(!h)return;
  const cur=$('miCur')?.value||state.currency;
  h.innerHTML=MI.lines.map((l,i)=>`<div class="mi-row"><input aria-label="Description" placeholder="Description" maxlength="200" value="${esc(l.description)}" oninput="miSet(${i},'description',this.value)"><input aria-label="Quantity" type="number" min="1" step="1" value="${esc(l.qty)}" oninput="miSet(${i},'qty',this.value)"><input aria-label="Unit price" type="number" min="0" step="0.01" placeholder="Unit price" value="${esc(l.price)}" oninput="miSet(${i},'price',this.value)"><b class="mi-amt" id="miAmt${i}">${mc(miLineTotal(l),cur)}</b>${MI.lines.length>1?`<button class="btn mini" aria-label="Remove item" onclick="miDel(${i})">×</button>`:'<span></span>'}</div>`).join('')+`<div class="mi-total"><span>Total</span><b id="miTot">${mc(miTotal(MI.lines),cur)}</b></div>`;
}
function miSet(i,k,v){MI.lines[i][k]=v;const cur=$('miCur')?.value||state.currency;if($('miAmt'+i))$('miAmt'+i).innerHTML=mc(miLineTotal(MI.lines[i]),cur);if($('miTot'))$('miTot').innerHTML=mc(miTotal(MI.lines),cur)}
function miAddLine(){if(MI.lines.length>=50)return toast('An invoice can have up to 50 items.');MI.lines.push({description:'',qty:1,price:''});miPaintLines()}
function miDel(i){MI.lines.splice(i,1);miPaintLines()}

/* returns an error string, or null when the form is good */
function miProblem(f){
  if(f.name.trim().length<2)return 'Enter the customer name.';
  if(!f.issue)return 'Choose an issue date.';
  if(f.due&&f.due<f.issue)return 'The due date is before the issue date.';
  if(!f.lines.length)return 'Add at least one item.';
  for(const l of f.lines){
    if(!String(l.description).trim())return 'Every item needs a description.';
    const q=Number(l.qty);if(!Number.isInteger(q)||q<1)return 'Quantity must be a whole number, 1 or more.';
    const p=Number(l.price);if(l.price===''||!(p>=0))return 'Enter a unit price for every item (0 or more).';
  }
  if(miTotal(f.lines)<=0)return 'The invoice total must be more than zero.';
  return null;
}
async function submitManualInvoice(){
  if(MI.busy)return;
  const f={name:$('miName').value,email:$('miEmail').value.trim(),phone:$('miPhone').value.trim(),addr:$('miAddr').value.trim(),cur:$('miCur').value,issue:$('miIssue').value,due:$('miDue').value,notes:$('miNotes').value.trim(),save:$('miSave').checked,branch:$('miBranch')?.value||null,borrower:$('miB')?.value||null,lines:MI.lines.map(l=>({...l}))};
  const bad=miProblem(f);if(bad)return toast(bad);
  const lines=f.lines.map(l=>({description:String(l.description).trim(),qty:Number(l.qty),unit_minor:miNum(l.price)}));
  MI.busy=true;$('miGo').disabled=true;
  try{
    let inv;
    if(f.save){
      const {data,error}=await state.sb.rpc('create_manual_invoice',{p_borrower_id:f.borrower||null,p_customer_name:f.name.trim(),p_customer_email:f.email,p_customer_phone:f.phone,p_customer_address:f.addr,p_currency:f.cur,p_issue_date:f.issue,p_due_date:f.due||null,p_lines:lines,p_notes:f.notes,p_branch_id:f.branch});
      if(error){MI.busy=false;$('miGo').disabled=false;return toast(error.message)}
      inv=data;
    }else inv={invoice_number:null,customer_name:f.name.trim(),customer_email:f.email,customer_phone:f.phone,customer_address:f.addr,currency:f.cur,issue_date:f.issue,due_date:f.due||null,lines,total_minor:miTotal(f.lines),notes:f.notes,status:'Issued',branch_name:f.branch?branchName(f.branch):(state.branches||[]).find(b=>b.id===myBranchId())?.name||null};
    closeModal();
    if(f.save)pgRefresh('invoices');
    await manualInvoicePdf(inv);
  }finally{MI.busy=false}
}

function manualInvoiceHTML(m,logo){
  const co=companyInfo(),cur=m.currency,money=v=>esc(moneyText(v,cur)),lines=Array.isArray(m.lines)?m.lines:[];
  const br=a=>a.filter(Boolean).map(esc).join('<br>');
  const rows=lines.map(l=>`<tr><td>${esc(l.description)}</td><td class="r">${esc(l.qty)}</td><td class="r">${money(l.unit_minor)}</td><td class="r">${money(Number(l.qty)*Number(l.unit_minor))}</td></tr>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>${esc(m.invoice_number||'Invoice')}</title><style>
@page{size:A4;margin:0}*{box-sizing:border-box}body{font:11px/1.45 Inter,Arial,Helvetica,sans-serif;color:#101828;margin:0;padding:16mm 15mm;position:relative}
.head{display:flex;justify-content:space-between;gap:20px;border-bottom:3px solid #ff7a1f;padding-bottom:14px}.brand{display:flex;gap:14px;align-items:center}.brand img{width:74px;height:auto;border-radius:8px}.brand h1{font-size:17px;margin:0 0 3px}.brand p{margin:0;color:#475467;font-size:10px}
.inv{text-align:right}.inv h2{font-size:28px;letter-spacing:.08em;margin:0;color:#ff7a1f}.inv p{margin:2px 0;color:#475467}.inv b{color:#101828}
.box{border:1px solid #e4e7ec;border-radius:10px;padding:12px 14px;margin:18px 0}.box h3{margin:0 0 7px;font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:#667085}
table{border-collapse:collapse;width:100%}th{background:#f2f4f7;text-align:left;font-size:9px;text-transform:uppercase;color:#475467}th,td{padding:6px 8px;border-bottom:1px solid #e4e7ec}.r{text-align:right;white-space:nowrap}
.tot{margin:14px 0 0 auto;width:55%;border:1px solid #e4e7ec;border-radius:10px;overflow:hidden}.tot div{display:flex;justify-content:space-between;padding:8px 12px;background:#101828;color:#fff;font-size:13px;font-weight:700}
.note{margin-top:18px;color:#475467;font-size:10px;white-space:pre-line}.foot{margin-top:22px;padding-top:10px;border-top:1px solid #e4e7ec;color:#667085;font-size:9.5px;text-align:center}
.stamp{position:absolute;top:70mm;left:30mm;font-size:90px;font-weight:800;letter-spacing:.1em;color:rgba(208,59,59,.18);transform:rotate(-25deg)}
</style>${m.status==='Void'?'<div class="stamp">VOID</div>':''}
<div class="head"><div class="brand">${logo?`<img src="${logo}" alt="Logo">`:''}<div><h1>${esc(co.name)}</h1><p>${br([co.address,co.phone,co.email])}</p></div></div>
<div class="inv"><h2>INVOICE</h2><p><b>${esc(m.invoice_number||'Not recorded')}</b></p><p>Issued ${esc(fdt(m.issue_date))}</p>${m.due_date?`<p>Due ${esc(fdt(m.due_date))}</p>`:''}${m.branch_name?`<p>Branch: ${esc(m.branch_name)}</p>`:''}</div></div>
<div class="box"><h3>Billed to</h3><b style="font-size:13px">${esc(m.customer_name)}</b><p style="margin:4px 0 0;color:#475467">${br([m.customer_address,m.customer_phone,m.customer_email])}</p></div>
<table><thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
<div class="tot"><div><span>Total</span><span>${money(m.total_minor)}</span></div></div>
${m.notes?`<div class="note">${esc(m.notes)}</div>`:''}${co.payment?`<h3 style="font-size:10px;text-transform:uppercase;color:#667085;margin:18px 0 6px">How to pay</h3><div class="note" style="margin-top:0">${esc(co.payment)}</div>`:''}
<div class="foot">${esc(co.footer)}<br>Generated by MarkLend on ${esc(today())}</div>`;
}
async function manualInvoicePdf(m){
  if(typeof m==='string')m=(pgs('invoices').rows||[]).find(r=>r.id===m);
  if(!m)return;
  try{
    const logo=await window.marklendAPI.getLogo().catch(()=>null);
    const r=await window.marklendAPI.exportPDF({html:manualInvoiceHTML(m,logo),filename:(m.invoice_number||'invoice-not-recorded-'+today())+'.pdf',landscape:false});
    if(r?.path)toast(m.invoice_number?`Invoice ${m.invoice_number} saved`:'Invoice PDF saved (not recorded in the system)');
  }catch(e){toast('PDF export failed: '+e.message)}
}
function openVoidInvoice(id){
  const m=(pgs('invoices').rows||[]).find(r=>r.id===id);if(!m)return;
  reasonModal({title:'Void invoice',subtitle:`${m.invoice_number} · ${m.customer_name}`,button:'Void invoice',warn:'The number stays used and the invoice stays in the list marked Void; reissued copies carry a VOID stamp.',
    onSubmit:async reason=>{await lifecycleCall('void_manual_invoice',{p_id:id,p_reason:reason},'Invoice voided.');pgRefresh('invoices')}});
}
