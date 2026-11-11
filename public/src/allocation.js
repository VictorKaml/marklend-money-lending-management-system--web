/* 1.10: per-branch capital allocation (a lending limit inside the one company pool) and monthly branch targets.
 * All figures come from the database (branch_capital_overview, branch_target_progress); this file presents them. */

/* ---------- capital allocation (Branches screen) ---------- */
const BC=state.bcap=state.bcap||{key:'',inflight:null,data:null,err:false};
let bcSeq=0;
async function loadBranchCapital(){
  const cur=state.currency,seq=++bcSeq;BC.inflight=cur;
  const r=await state.sb.rpc('branch_capital_overview',{p_currency:cur});
  if(seq!==bcSeq)return;
  BC.inflight=null;BC.key=cur;BC.data=r.error?null:r.data;BC.err=!!r.error;
  if(state.view==='branches')branchesView($('content'));
}
const canSeeCapitalAlloc=()=>['Admin','Branch Manager'].includes(state.userProfile?.role);
function capitalCard(){
  if(!canSeeCapitalAlloc())return '';
  const cur=state.currency;
  if(BC.key!==cur&&BC.inflight!==cur)loadBranchCapital();
  if(BC.key!==cur||!BC.data)return '';
  const d=BC.data,adm=isAdminUser(),rows=d.rows||[];
  if(!rows.length)return '';
  const strip=adm?`<div class="cf-math" style="margin:12px 0"><div><span>Company capital pool</span><b>${mc(d.pool_minor,cur)}</b></div><div><span>Allocated to branches</span><b>${mc(d.allocated_minor,cur)}</b></div><div><span>Not allocated</span><b>${mc(d.unallocated_minor,cur)}</b></div></div>`:'';
  const tr=rows.map(r=>{
    const lim=r.limited,used=Number(r.used_minor),al=Number(r.allocated_minor||0),pct=lim&&al>0?Math.min(100,used*100/al):0;
    return `<tr><td><b>${esc(r.name)}</b><div style="font-size:10px;color:var(--muted)">${esc(r.code)}</div></td><td class="num">${lim?mc(al,cur):'<span style="color:var(--muted)">No limit</span>'}</td><td class="num">${mc(used,cur)}${lim?`<div class="tg-track" style="margin-top:4px" role="img" aria-label="${pct.toFixed(0)}% of the allocation is lent out"><i style="width:${pct.toFixed(1)}%"></i></div>`:''}</td><td class="num">${lim?mc(r.available_minor,cur):'—'}</td>${adm?`<td><button class="btn mini" onclick="openBranchCapital('${r.branch_id}')">${lim?'Change':'Set limit'}</button></td>`:''}</tr>`;
  }).join('');
  return `<div class="card panel" style="margin-top:17px"><h3 style="margin:0">Capital by branch · ${esc(cur)}</h3>${sub('One company pool. A limit caps how much a branch may have out on loan; loans that would go over it cannot be approved. Branches without a limit draw on the pool.')}${strip}<div class="table-wrap"><table class="table"><thead><tr><th>Branch</th><th class="num">Limit</th><th class="num">Lent out</th><th class="num">Room left</th>${adm?'<th></th>':''}</tr></thead><tbody>${tr}</tbody></table></div></div>`;
}
function openBranchCapital(id){
  const r=(BC.data?.rows||[]).find(x=>x.branch_id===id);if(!r||!isAdminUser())return;
  const cur=state.currency,un=Number(BC.data.unallocated_minor||0)+Number(r.allocated_minor||0);
  modal(`<div class="modal-head"><div><h2 style="margin-bottom:4px">Capital limit · ${esc(r.name)}</h2>${sub(`${esc(cur)} · lent out now ${esc(moneyText(r.used_minor,cur))} · at most ${esc(moneyText(un,cur))} can be given to this branch`)}</div>${CLOSE_BTN}</div><div class="field"><label>Limit (${esc(cur)})</label><input id="bcAmt" type="number" min="0" step="0.01" value="${r.limited?(Number(r.allocated_minor)/100).toFixed(2):''}" placeholder="e.g. 5000000"></div><div class="field"><label>Note (optional)</label><input id="bcNote" maxlength="200" value="${esc(r.note||'')}"></div><div class="cf-act">${r.limited?`<button class="btn danger" onclick="saveBranchCapital('${id}',true)">Remove limit</button>`:''}<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveBranchCapital('${id}')">Save</button></div>`);
}
async function saveBranchCapital(id,remove){
  let minor=null;
  if(!remove){const v=$('bcAmt').value;if(v===''||!(Number(v)>=0))return toast('Enter the limit, 0 or more.');minor=Math.round(Number(v)*100)}
  const {error}=await state.sb.rpc('set_branch_capital',{p_branch_id:id,p_currency:state.currency,p_amount_minor:minor,p_note:remove?null:($('bcNote').value.trim()||null)});
  if(error)return toast(error.message);
  closeModal();BC.key='';toast(remove?'Limit removed.':'Capital limit saved.');
  if(state.view==='branches')branchesView($('content'));
}

/* ---------- targets (Performance screen) ---------- */
const monthNow=()=>new Date().toISOString().slice(0,7);
const TG=state.targets=state.targets||{key:'',inflight:null,data:null,err:false,month:monthNow()};
let tgSeq=0;
const tgKey=()=>state.currency+'|'+TG.month;
async function loadTargets(){
  const key=tgKey(),seq=++tgSeq;TG.inflight=key;
  const r=await state.sb.rpc('branch_target_progress',{p_currency:state.currency,p_month:TG.month+'-01'});
  if(seq!==tgSeq)return;
  TG.inflight=null;TG.key=key;TG.data=r.error?null:r.data;TG.err=!!r.error;
  if(state.view==='performance')performanceView($('content'));
}
function tgSetMonth(v){if(!/^\d{4}-\d{2}$/.test(v))return;TG.month=v;performanceView($('content'))}
/* percentage reached, or null when there is no target */
const tgPct=(actual,target)=>Number(target)>0?Math.round(Number(actual)*1000/Number(target))/10:null;
const tgState=(pct,pace)=>pct==null?'none':pct>=100?'met':pct>=pace?'on':'behind';
function tgCell(actual,target,pace,money,cur){
  const p=tgPct(actual,target),st=tgState(p,pace),fmt=v=>money?mc(v,cur):Number(v).toLocaleString('en-US');
  if(p==null)return `<td class="num">${fmt(actual)}<div style="font-size:10px;color:var(--muted)">no target</div></td>`;
  const lab={met:'Target met',on:'On pace',behind:'Behind pace'}[st],cls={met:'b-active',on:'b-pending',behind:'b-default'}[st];
  return `<td class="num">${fmt(actual)} <span style="color:var(--muted)">/ ${fmt(target)}</span><div class="tg-track" style="margin-top:4px" role="img" aria-label="${p.toFixed(0)}% of target"><i style="width:${Math.min(100,p).toFixed(1)}%"></i></div><div style="font-size:10px;margin-top:3px"><span class="badge ${cls}">${lab}</span> ${p.toFixed(1)}%</div></td>`;
}
function targetsCard(){
  const key=tgKey();
  if(TG.key!==key&&TG.inflight!==key)loadTargets();
  const adm=isAdminUser(),cur=state.currency;
  const head=`<div class="toolbar"><div><h3 style="margin:0">Targets</h3>${sub('Monthly goals per branch. "On pace" means ahead of the share of the month that has passed.')}</div><div class="tb"><input type="month" aria-label="Month" value="${esc(TG.month)}" onchange="tgSetMonth(this.value)"></div></div>`;
  if(TG.key!==key||!TG.data)return TG.err&&TG.key===key?'':`<div class="card panel" style="margin-top:17px">${head}<div class="empty">Loading targets…</div></div>`;
  const d=TG.data,rows=d.rows||[],pace=Number(d.pace_pct);
  if(!rows.length)return `<div class="card panel" style="margin-top:17px">${head}<div class="empty">No branches yet.</div></div>`;
  const pre=Number(d.elapsed)<Number(d.days)?`${pace.toFixed(0)}% of the month has passed.`:'This month is complete.';
  const tr=rows.map(r=>`<tr><td><b>${esc(r.name)}</b><div style="font-size:10px;color:var(--muted)">${esc(r.code)}</div></td>${tgCell(r.disbursed_actual_minor,r.disbursed_target_minor,pace,true,cur)}${tgCell(r.collected_actual_minor,r.collected_target_minor,pace,true,cur)}${tgCell(r.borrowers_actual,r.borrowers_target,pace,false,cur)}${adm?`<td><button class="btn mini" onclick="openTargetModal('${r.branch_id}')">${r.has_target?'Edit':'Set targets'}</button></td>`:''}</tr>`).join('');
  return `<div class="card panel" style="margin-top:17px">${head}${sub(esc(pre)+' '+esc(cur)+' figures.')}<div class="table-wrap" style="margin-top:10px"><table class="table"><thead><tr><th>Branch</th><th class="num">Disbursed</th><th class="num">Collected</th><th class="num">New borrowers</th>${adm?'<th></th>':''}</tr></thead><tbody>${tr}</tbody></table></div></div>`;
}
function openTargetModal(id){
  const r=(TG.data?.rows||[]).find(x=>x.branch_id===id);if(!r||!isAdminUser())return;
  const cur=state.currency,v=m=>Number(m)>0?(Number(m)/100).toFixed(2):'';
  modal(`<div class="modal-head"><div><h2 style="margin-bottom:4px">Targets · ${esc(r.name)}</h2>${sub(esc(TG.month)+' · '+esc(cur)+'. Leave all three empty to remove the target.')}</div>${CLOSE_BTN}</div><div class="formgrid"><div class="field"><label>Disbursed (${esc(cur)})</label><input id="tgD" type="number" min="0" step="0.01" value="${v(r.disbursed_target_minor)}"></div><div class="field"><label>Collected (${esc(cur)})</label><input id="tgC" type="number" min="0" step="0.01" value="${v(r.collected_target_minor)}"></div><div class="field"><label>New borrowers</label><input id="tgB" type="number" min="0" step="1" value="${Number(r.borrowers_target)>0?r.borrowers_target:''}"></div></div><div class="cf-act"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveTarget('${id}')">Save</button></div>`);
}
async function saveTarget(id){
  const n=x=>x===''?0:Number(x),d=n($('tgD').value),c=n($('tgC').value),b=n($('tgB').value);
  if(![d,c,b].every(x=>x>=0)||!Number.isInteger(b))return toast('Targets must be 0 or more; borrowers a whole number.');
  const {error}=await state.sb.rpc('set_branch_target',{p_branch_id:id,p_month:TG.month+'-01',p_currency:state.currency,p_disbursed_minor:Math.round(d*100),p_collected_minor:Math.round(c*100),p_new_borrowers:b});
  if(error)return toast(error.message);
  closeModal();TG.key='';toast('Targets saved.');
  if(state.view==='performance')performanceView($('content'));
}
