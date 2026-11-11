/* Approved-loan invoice (PDF with embedded logo) */

/* ---------- Invoice for an approved loan (PDF, PNG logo embedded) ---------- */
const INVOICE_STATUSES=['Active','Defaulted','Restructured','Completed'];
const isApproved=l=>!!l&&INVOICE_STATUSES.includes(l.status);
const invoiceNo=l=>'INV-'+l.loan_number;
const isStaff=()=>!!state.userProfile&&state.userProfile.role!=='Borrower';

/* Lender details come from Settings → Invoice details (stored on this computer). */
function companyInfo(){
  const c=state.config.invoice||{};
  return{name:c.name||'MarkLend Financial Services',address:c.address||'',phone:c.phone||'',email:c.email||'',payment:c.payment||'',footer:c.footer||'Thank you for choosing MarkLend.'};
}
async function invoiceData(id){
  const [loan,sch]=await Promise.all([getLoan(id,true),state.sb.rpc('loan_schedule',{p_loan_id:id})]);
  if(!loan)throw new Error('Loan not found');
  let borrower=null;
  if(isStaff())borrower=(await safeQ('borrower_summary',{filters:[['id','eq',loan.borrower_id]],from:0,to:0})).data[0]||null;
  // Invoice only the unpaid balance. Extensions preserve paid amounts in historical
  // schedule rows; due-minus-paid prevents those amounts being invoiced a second time.
  const schedule=(sch.data||[]).map(r=>({...r,
    principal_due_minor:Math.max(0,Number(r.principal_due_minor||0)-Number(r.principal_paid_minor||0)),
    interest_due_minor:Math.max(0,Number(r.interest_due_minor||0)-Number(r.interest_paid_minor||0)),
    fee_due_minor:Math.max(0,Number(r.fee_due_minor||0)-Number(r.fee_paid_minor||0))
  })).filter(r=>Number(r.principal_due_minor)+Number(r.interest_due_minor)+Number(r.fee_due_minor)>0);
  return{loan,borrower,schedule};
}
function invoiceTotals(d){
  const sum=f=>d.schedule.reduce((a,r)=>a+Number(r[f]||0),0);
  const principal=sum('principal_due_minor'),interest=sum('interest_due_minor'),fees=sum('fee_due_minor');
  return{principal,interest,fees,total:principal+interest+fees};
}
function invoiceHTML(d,logo){
  const co=companyInfo(),L=d.loan,B=d.borrower,cur=L.currency,t=invoiceTotals(d);
  const issued=fdt(L.approved_at||L.disbursement_date||today()),start=fdt(L.start_date||L.disbursement_date||L.approved_at),end=fdt(L.maturity_date);
  const days=L.maturity_date&&start!=='—'?Math.round((new Date(L.maturity_date)-new Date(start))/864e5):null;
  const m=v=>esc(moneyText(v,cur));
  const lines=a=>a.filter(Boolean).map(esc).join('<br>');
  const rows=d.schedule.map(r=>{const p=Number(r.principal_due_minor),i=Number(r.interest_due_minor),f=Number(r.fee_due_minor);return `<tr><td>${esc(r.installment_no)}</td><td>${esc(fdt(r.due_date))}</td><td class="r">${m(p)}</td><td class="r">${m(i)}</td><td class="r">${m(f)}</td><td class="r b">${m(p+i+f)}</td></tr>`}).join('');
  return `<!doctype html><meta charset="utf-8"><title>${esc(invoiceNo(L))}</title><style>
@page{size:A4;margin:0}*{box-sizing:border-box}body{font:11px/1.45 Inter,Arial,Helvetica,sans-serif;color:#101828;margin:0;padding:16mm 15mm}
.head{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;border-bottom:3px solid #ff7a1f;padding-bottom:14px}
.brand{display:flex;gap:14px;align-items:center;flex:1 1 auto;min-width:0}.brand>div{min-width:0}.brand img{width:74px;height:auto;border-radius:8px;display:block}.brand h1{font-size:17px;margin:0 0 3px}.brand p{margin:0;color:#475467;font-size:10px}
.inv{text-align:right;flex:0 0 auto}.inv h2{font-size:28px;letter-spacing:.08em;margin:0;color:#ff7a1f}.inv p{margin:2px 0;color:#475467}.inv b{color:#101828}
.grid{display:flex;gap:18px;margin:18px 0}.box{flex:1;border:1px solid #e4e7ec;border-radius:10px;padding:12px 14px}.box h3{margin:0 0 7px;font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:#667085}
.kv{display:grid;grid-template-columns:auto 1fr;gap:3px 14px}.kv span{color:#667085}.kv b{text-align:right}
h3.t{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#667085;margin:18px 0 6px}
table{border-collapse:collapse;width:100%}th{background:#f2f4f7;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.04em;color:#475467}th,td{padding:6px 8px;border-bottom:1px solid #e4e7ec}.r{text-align:right;white-space:nowrap}.b{font-weight:700}thead{display:table-header-group}tr{break-inside:avoid}
.tot{margin:14px 0 0 auto;width:62%;border:1px solid #e4e7ec;border-radius:10px;overflow:hidden}.tot div{display:flex;justify-content:space-between;padding:7px 12px;border-bottom:1px solid #e4e7ec}.tot .g{background:#101828;color:#fff;font-size:13px;font-weight:700;border-bottom:0}
.note{margin-top:18px;color:#475467;font-size:10px;white-space:pre-line}.foot{margin-top:22px;padding-top:10px;border-top:1px solid #e4e7ec;color:#667085;font-size:9.5px;text-align:center}
</style>
<div class="head"><div class="brand">${logo?`<img src="${logo}" alt="Logo">`:''}<div><h1>${esc(co.name)}</h1><p>${lines([co.address,co.phone,co.email])}</p></div></div>
<div class="inv"><h2>INVOICE</h2><p><b>${esc(invoiceNo(L))}</b></p><p>Issued ${esc(issued)}</p><p>Loan ${esc(L.loan_number)}</p>${L.branch_name?`<p>Branch: ${esc(L.branch_name)}</p>`:''}<p>Status: ${esc(L.status)}</p></div></div>
<div class="grid"><div class="box"><h3>Billed to</h3><b style="font-size:13px">${esc(L.borrower_name||B?.full_name||'')}</b><p style="margin:4px 0 0;color:#475467">${lines([B?.business_name,B?.phone,B?.email])}</p></div>
<div class="box"><h3>Loan summary</h3><div class="kv"><span>Outstanding principal</span><b>${m(t.principal)}</b><span>Interest</span><b>${esc((Number(L.interest_rate_bps||0)/100).toFixed(2))}% ${L.interest_type==='declining'?'declining':'fixed'}</b><span>Repayments</span><b>${esc(L.frequency||'')}${d.schedule.length?` · ${d.schedule.length} instalment${d.schedule.length>1?'s':''}`:''}</b><span>Loan period</span><b>${esc(start)} → ${esc(end)}${days?` (${days} days)`:''}</b>${L.collateral_description?`<span>Collateral</span><b>${esc([L.collateral_type,L.collateral_description,L.collateral_reference?`Ref: ${L.collateral_reference}`:''].filter(Boolean).join(' · '))}${L.collateral_value_minor!=null?` · ${m(L.collateral_value_minor)}`:''}</b>`:''}</div></div></div>
<h3 class="t">Repayment schedule</h3>
<table><thead><tr><th>#</th><th>Due date</th><th class="r">Principal</th><th class="r">Interest</th><th class="r">Fees</th><th class="r">Instalment</th></tr></thead><tbody>${rows||`<tr><td colspan="6">The schedule will be issued separately.</td></tr>`}</tbody></table>
<div class="tot"><div><span>Principal</span><span>${m(t.principal)}</span></div><div><span>Interest</span><span>${m(t.interest)}</span></div>${t.fees?`<div><span>Fees</span><span>${m(t.fees)}</span></div>`:''}<div class="g"><span>Total payable</span><span>${m(t.total)}</span></div></div>
${co.payment?`<h3 class="t">How to pay</h3><div class="note" style="margin-top:0">${esc(co.payment)}</div>`:''}
<div class="note">Amounts shown exclude any penalties that apply if an instalment is paid late. Payments are recorded against loan ${esc(L.loan_number)} and reduce the balances above.</div>
<div class="foot">${esc(co.footer)}<br>Generated by MarkLend on ${esc(today())}</div>`;
}

/* Save the invoice as a PDF; with {email:true} also open the mail app addressed to the borrower. */
async function downloadInvoice(id,opts={}){
  if(!isStaff()&&opts.email)return;
  try{
    toast('Preparing invoice…');
    const d=await invoiceData(id);
    if(!isApproved(d.loan))return toast('An invoice is available once the loan has been approved.');
    const logo=await window.marklendAPI.getLogo().catch(()=>null);
    const r=await window.marklendAPI.exportPDF({html:invoiceHTML(d,logo),filename:invoiceNo(d.loan)+'.pdf',landscape:false,reveal:!!opts.email});
    if(!r?.path)return;
    if(!opts.email)return toast('Invoice saved');
    const to=d.borrower?.email;
    if(!to)return toast('Invoice saved, but this borrower has no email address on file.');
    const t=invoiceTotals(d),co=companyInfo(),first=d.schedule[0];
    const body=`Dear ${d.borrower?.full_name||d.loan.borrower_name||'customer'},\n\nPlease find attached invoice ${invoiceNo(d.loan)} for your loan ${d.loan.loan_number}. Outstanding principal: ${moneyText(t.principal,d.loan.currency)}.\n\nTotal payable: ${moneyText(t.total,d.loan.currency)}${d.schedule.length?` over ${d.schedule.length} instalment${d.schedule.length>1?'s':''}`:''}.${first?` The first instalment is due on ${fdt(first.due_date)}.`:''}\n\nKind regards,\n${co.name}`;
    try{await window.marklendAPI.composeEmail({to,subject:`Invoice ${invoiceNo(d.loan)} · ${co.name}`,body});toast('Invoice saved. Attach the PDF from the folder that just opened.')}
    catch(e){toast('Invoice saved, but the email app could not be opened: '+e.message)}
  }catch(e){toast('Invoice failed: '+e.message)}
}

/* ---------- Settings → Invoice details ---------- */
function invoiceSettingsCard(){
  const c=companyInfo(),v=x=>esc(x||'');
  return `<div class="card panel" style="margin-top:17px"><h3>Invoice details</h3>${sub('Shown on invoices you download or email to borrowers. Saved on this computer.')}<div class="formgrid" style="margin-top:12px"><div class="field"><label>Business name</label><input id="ivName" value="${v(c.name)}"></div><div class="field"><label>Phone</label><input id="ivPhone" value="${v(c.phone)}"></div><div class="field"><label>Email</label><input id="ivEmail" type="email" value="${v(c.email)}"></div><div class="field"><label>Address</label><input id="ivAddr" value="${v(c.address)}"></div><div class="field" style="grid-column:1/-1"><label>How to pay (bank, mobile money, branch…)</label><textarea id="ivPay">${v(c.payment)}</textarea></div><div class="field" style="grid-column:1/-1"><label>Footer message</label><input id="ivFoot" value="${v(c.footer)}"></div></div><div style="margin-top:14px"><button class="btn primary" onclick="saveInvoiceSettings()">Save invoice details</button></div></div>`;
}
async function saveInvoiceSettings(){
  state.config.invoice={name:$('ivName').value.trim(),phone:$('ivPhone').value.trim(),email:$('ivEmail').value.trim(),address:$('ivAddr').value.trim(),payment:$('ivPay').value.trim(),footer:$('ivFoot').value.trim()};
  try{await window.marklendAPI.saveConfig(state.config);toast('Invoice details saved.')}catch(e){toast('Could not save: '+e.message)}
}

