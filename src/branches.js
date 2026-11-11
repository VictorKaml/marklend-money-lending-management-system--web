/* Branches (1.8): branch list and management, staff and borrower branch assignment.
 * Row-level security on the server does the real scoping; this file only presents it. */
const isAdminUser=()=>state.userProfile?.role==='Admin';
const myBranchId=()=>state.userProfile?.branch_id||null;
const branchName=id=>id?((state.branches||[]).find(b=>b.id===id)?.name||'Another branch'):'Unassigned';
const activeBranches=()=>(state.branches||[]).filter(b=>b.status==='Active');
const branchOpts=(sel,list=activeBranches())=>list.map(b=>`<option value="${esc(b.id)}"${b.id===sel?' selected':''}>${esc(b.name)} (${esc(b.code)})</option>`).join('');

async function loadBranches(){
  if(!state.sb||!state.sb.token||state.userProfile?.role==='Borrower'){state.branches=[];return}
  const {data,error}=await state.sb.from('branches').select('*').order('name');
  if(error){if(isSchemaErr(error))state.schemaErr=true;state.branches=state.branches||[];return}
  state.branches=data||[];
}
/* Per-branch figures for the list (small head-only count queries). */
async function loadBranchCounts(){
  const out={};
  await Promise.all((state.branches||[]).map(async b=>{
    const cnt=async(t,f)=>{try{return (await state.sb.query(t,{select:'id',filters:f,count:true,from:0,to:0})).count||0}catch(_){return 0}};
    const [bo,lo]=await Promise.all([cnt('borrower_summary',[['branch_id','eq',b.id]]),cnt('loan_summary',[['branch_id','eq',b.id],['status','eq','Active']])]);
    out[b.id]={borrowers:bo,loans:lo};
  }));
  if(isAdminUser()){try{out.unassigned=(await state.sb.query('borrower_summary',{select:'id',filters:[['branch_id','is','null']],count:true,from:0,to:0})).count||0}catch(_){out.unassigned=0}}
  state.branchCounts=out;
}
async function loadBranchTeam(){
  if(isAdminUser()||!myBranchId()){state.branchTeam=[];return}
  const r=await state.sb.from('profiles').select('id,full_name,email,role').eq('branch_id',myBranchId()).order('full_name');
  state.branchTeam=r.error?[]:(r.data||[]);
}
const branchStatusBadge=s=>`<span class="badge ${s==='Active'?'b-active':'b-pending'}">${esc(s)}</span>`;
const staffOfBranch=id=>(state.staff||[]).filter(u=>u.branch_id===id);

function branchesView(c){
  const admin=isAdminUser(),rows=state.branches||[],cnt=state.branchCounts||{};
  if(!rows.length&&!admin){c.innerHTML='<div class="card panel"><div class="empty">Your account is not assigned to a branch yet. Ask an administrator to assign you.</div></div>';return}
  const team=admin?null:(state.branchTeam||[]);
  const mgrName=b=>{const m=(admin?state.staff:state.branchTeam||[]).find(u=>u.id===b.manager_id);return m?esc(m.full_name||m.email||'—'):'<span style="color:var(--muted)">None</span>'};
  const head=`<div class="toolbar"><div><h3 style="margin:0">${admin?'Branches':'My branch'}</h3>${sub(admin?'Create branches, assign managers and staff. Staff only see their own branch.':'You only see borrowers, loans and repayments of this branch.')}</div>${admin?'<button class="btn primary" onclick="openBranchModal()">+ New branch</button>':''}</div>`;
  const unassigned=admin&&cnt.unassigned?`<div class="alert info" style="margin:14px 0 0"><b>${cnt.unassigned} borrower${cnt.unassigned>1?'s':''} without a branch</b> (public sign-ups). <a href="#" class="lnk" onclick="pgs('borrowers').f.branch='unassigned';go('borrowers');return false">Review them</a> and assign each to a branch before a loan can be created.</div>`:'';
  const body=rows.length?`<div class="table-wrap" style="margin-top:14px"><table class="table"><thead><tr><th>Branch</th><th>Manager</th><th>Staff</th><th>Borrowers</th><th>Active loans</th><th>Contact</th><th>Status</th>${admin?'<th></th>':''}</tr></thead><tbody>${rows.map(b=>{
    const staffN=admin?staffOfBranch(b.id).length:team.length,k=cnt[b.id]||{};
    return `<tr><td><b>${esc(b.name)}</b><div style="font-size:10px;color:var(--muted)">${esc(b.code)}</div></td><td>${mgrName(b)}</td><td class="num">${staffN}</td><td class="num">${k.borrowers??'—'}</td><td class="num">${k.loans??'—'}</td><td>${esc([b.address,b.phone].filter(Boolean).join(' · ')||'—')}</td><td>${branchStatusBadge(b.status)}</td>${admin?`<td style="white-space:nowrap"><button class="btn mini" onclick="openBranchModal('${b.id}')">Edit</button> <button class="btn mini" onclick="openBranchStatusModal('${b.id}')">${b.status==='Active'?'Close':'Reopen'}</button></td>`:''}</tr>`}).join('')}</tbody></table></div>`:'<div class="empty">No branches yet.</div>';
  const teamCard=!admin&&team.length?`<div class="card panel" style="margin-top:17px"><h3>Team</h3><div class="table-wrap" style="margin-top:10px"><table class="table"><thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead><tbody>${team.map(u=>`<tr><td><b>${esc(u.full_name||'—')}</b></td><td>${esc(u.email||'')}</td><td>${esc(u.role)}</td></tr>`).join('')}</tbody></table></div></div>`:'';
  c.innerHTML=`${reconBanner()}<div class="card panel">${head}${unassigned}${body}</div>${capitalCard()}${queueCard()}${teamCard}`;
  if(!state.branchQueue&&!state.branchQueueLoading){state.branchQueueLoading=true;loadBranchQueue().then(()=>{state.branchQueueLoading=false;if(state.view==='branches')branchesView($('content'))})}
  if(!state.branchCounts&&!state.branchCountsLoading){
    state.branchCountsLoading=true;
    Promise.all([loadBranchCounts(),loadBranchTeam()]).catch(()=>{state.branchCounts={}}).then(()=>{state.branchCountsLoading=false;if(state.view==='branches')branchesView($('content'))});
  }
}

function openBranchModal(id){
  if(!isAdminUser())return toast('Only administrators can manage branches.');
  const b=id?(state.branches||[]).find(x=>x.id===id):null;
  const mgrs=b?staffOfBranch(b.id).filter(u=>u.role==='Branch Manager'):[];
  modal(`<div class="modal-head"><div><h2 style="margin-bottom:4px">${b?'Edit branch':'New branch'}</h2>${sub('The code is short and unique, e.g. LLW.')}</div>${CLOSE_BTN}</div><div class="formgrid">${FIELD('Branch name',`<input id="brName" required value="${esc(b?.name||'')}" placeholder="e.g. Lilongwe">`)}${FIELD('Code',`<input id="brCode" required maxlength="10" value="${esc(b?.code||'')}" placeholder="e.g. LLW">`)}<div class="field"><label>Address</label><input id="brAddr" value="${esc(b?.address||'')}"></div><div class="field"><label>Phone</label><input id="brPhone" value="${esc(b?.phone||'')}"></div>${b?`<div class="field"><label>Branch manager</label><select id="brMgr"><option value="">None</option>${mgrs.map(u=>`<option value="${esc(u.id)}"${u.id===b.manager_id?' selected':''}>${esc(u.full_name||u.email)}</option>`).join('')}</select>${mgrs.length?'':sub('Assign a staff member the Branch Manager role to this branch first.')}</div>`:''}</div><div class="cf-act"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveBranch('${id||''}')">${b?'Save branch':'Create branch'}</button></div>`);
}
async function saveBranch(id){
  const name=$('brName').value.trim(),code=$('brCode').value.trim(),address=$('brAddr').value.trim(),phone=$('brPhone').value.trim();
  if(name.length<2)return toast('Enter the branch name.');
  if(!/^[A-Za-z0-9]{2,10}$/.test(code))return toast('Branch code must be 2-10 letters or digits.');
  const r=id?await state.sb.rpc('update_branch',{p_id:id,p_name:name,p_code:code,p_address:address,p_phone:phone,p_manager_id:($('brMgr')?.value)||null})
            :await state.sb.rpc('create_branch',{p_name:name,p_code:code,p_address:address,p_phone:phone});
  if(r.error)return toast(r.error.message);
  closeModal();await loadBranches();await loadStaff();state.branchCounts=null;render();toast(id?'Branch updated.':'Branch created.');
}
function openBranchStatusModal(id){
  const b=(state.branches||[]).find(x=>x.id===id);if(!b||!isAdminUser())return;
  const closing=b.status==='Active';
  modal(`<div class="modal-head"><h2>${closing?'Close':'Reopen'} ${esc(b.name)}?</h2>${CLOSE_BTN}</div><p style="font-size:13px;color:var(--text-2)">${closing?'A closed branch accepts no new borrowers or loans. A branch with open loans cannot be closed.':'The branch will accept new borrowers and loans again.'}</p><div class="cf-act"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn ${closing?'danger':'primary'}" onclick="setBranchStatus('${id}','${closing?'Closed':'Active'}')">${closing?'Close branch':'Reopen branch'}</button></div>`);
}
async function setBranchStatus(id,status){
  const r=await state.sb.rpc('set_branch_status',{p_id:id,p_status:status});
  if(r.error)return toast(r.error.message);
  closeModal();await loadBranches();render();toast(status==='Closed'?'Branch closed.':'Branch reopened.');
}

/* ----- staff: role + branch ----- */
function openStaffBranchModal(uid){
  const u=(state.staff||[]).find(x=>x.id===uid);if(!u||!isAdminUser())return;
  modal(`<div class="modal-head"><div><h2 style="margin-bottom:4px">Branch and role</h2>${sub(esc(u.full_name||u.email||'Staff user'))}</div>${CLOSE_BTN}</div><div class="formgrid"><div class="field"><label>Role</label><select id="sbRole">${['Loan Officer','Branch Manager','Admin'].map(r=>`<option${r===u.role?' selected':''}>${r}</option>`).join('')}</select></div><div class="field"><label>Branch</label><select id="sbBranch"><option value="">No branch (administrators only)</option>${branchOpts(u.branch_id)}</select></div></div><div class="cf-act"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveStaffBranch('${uid}')">Save</button></div>`);
}
async function saveStaffBranch(uid){
  const role=$('sbRole').value,branch=$('sbBranch').value||null;
  if(role!=='Admin'&&!branch)return toast('Choose a branch for this staff member.');
  const r=await state.sb.rpc('assign_staff_branch',{p_user_id:uid,p_branch_id:branch,p_role:role});
  if(r.error)return toast(r.error.message);
  closeModal();await loadStaff();await loadBranches();render();toast('Staff branch updated.');
}

/* ----- borrowers: assign / transfer ----- */
async function openAssignBorrowerModal(id){
  const b=pgs('borrowers').rows.find(x=>x.id===id);if(!b)return;
  const admin=isAdminUser(),list=admin?activeBranches():activeBranches().filter(x=>x.id===myBranchId());
  if(!list.length)return toast('No active branch available.');
  const moving=!!b.branch_id;let note='';
  if(moving){
    let rows=[];try{rows=(await state.sb.query('loan_summary',{filters:[['borrower_id','eq',id]],from:0,to:199})).data||[]}catch(_){}
    const open=rows.filter(l=>OPEN_STATUSES.includes(l.status)),sums={};
    open.forEach(l=>{sums[l.currency]=(sums[l.currency]||0)+Number(l.outstanding_principal||0)});
    const owed=Object.entries(sums).map(([c,v])=>moneyText(v,c)).join(' + ');
    note=rows.length?`${rows.length} loan${rows.length>1?'s':''} move with them${open.length?` (${open.length} open, ${esc(owed)} outstanding)`:''}. Past figures stay in the audit log.`:'They have no loans yet.';
  }
  modal(`<div class="modal-head"><div><h2 style="margin-bottom:4px">${moving?'Transfer borrower':'Assign to a branch'}</h2>${sub(esc(b.full_name)+(moving?' · currently '+esc(branchName(b.branch_id)):' · not yet assigned'))}</div>${CLOSE_BTN}</div><div class="field"><label>${moving?'Move to':'Branch'}</label><select id="abBranch">${branchOpts(b.branch_id,list)}</select></div>${moving?`<div class="field"><label>Reason for the transfer</label><input id="abReason" maxlength="200" placeholder="e.g. Customer moved city"></div>${sub(note)}`:''}<div class="cf-act"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="assignBorrower('${id}')">${moving?'Transfer':'Assign'}</button></div>`);
}
async function assignBorrower(id){
  const branch=$('abBranch').value;if(!branch)return toast('Choose a branch.');
  const reasonEl=$('abReason'),reason=reasonEl?reasonEl.value.trim():null;
  if(reasonEl&&reason.length<3)return toast('Give a reason for the transfer.');
  const r=await state.sb.rpc('assign_borrower_branch',reasonEl?{p_borrower_id:id,p_branch_id:branch,p_reason:reason}:{p_borrower_id:id,p_branch_id:branch});
  if(r.error)return toast(r.error.message);
  closeModal();state.branchCounts=null;RC.key='';pgRefresh('borrowers');if(typeof pgRefresh==='function')pgRefresh('loans');toast(reasonEl?'Borrower transferred.':'Borrower assigned.');
}
const canAssignBranch=r=>isAdminUser()||(state.userProfile?.role==='Branch Manager'&&!r.branch_id);

/* ----- maker-checker: the person who created a loan cannot approve it (administrators excepted, and audited) ----- */
const isMyLoan=l=>!!l.created_by&&l.created_by===state.user?.id;
function reviewControl(l,cls){
  if(l.status!=='Pending Approval'||!can('loans','approve'))return '';
  if(isMyLoan(l)&&state.userProfile?.role!=='Admin')return `<span class="muted-note" title="You created this loan, so another person must approve it">Awaiting another approver</span>`;
  return `<button class="${cls}" onclick="reviewLoan('${l.id}')">Review</button>`;
}

/* ----- work queue: what needs doing in my branch (all branches for Admin) ----- */
async function loadBranchQueue(){
  const get=async(t,f,sel)=>{try{const r=await state.sb.query(t,{filters:f,order:[['created_at',true]],from:0,to:7,count:true});return{rows:r.data,count:r.count}}catch(_){return{rows:[],count:0}}};
  const [kyc,loans]=await Promise.all([get('borrower_summary',[['kyc_status','eq','Pending']]),get('loan_summary',[['status','eq','Pending Approval']])]);
  state.branchQueue={kyc,loans};
}
function queueCard(){
  const q=state.branchQueue;
  if(!q)return '<div class="card panel" style="margin-top:17px"><h3>Work queue</h3><div class="empty">Loading…</div></div>';
  const adm=isAdminUser();
  const more=(n,shown)=>n>shown?`<div class="muted-note" style="margin-top:6px">+ ${n-shown} more</div>`:'';
  const kyc=q.kyc.rows.length?q.kyc.rows.map(b=>`<li><div><b>${esc(b.full_name)}</b><small>${esc([adm?branchName(b.branch_id):'',b.phone].filter(Boolean).join(' · '))}</small></div>${can('borrowers','edit')?`<button class="btn mini" onclick="openEditBorrowerModal('${b.id}')">Review KYC</button>`:''}</li>`).join('')+more(q.kyc.count,q.kyc.rows.length):'<li class="muted-note">No borrowers waiting for verification.</li>';
  const loans=q.loans.rows.length?q.loans.rows.map(l=>`<li><div><b>${esc(l.loan_number)}</b><small>${esc([l.borrower_name,adm?branchName(l.branch_id):'',mc(l.principal_minor,l.currency)].filter(Boolean).join(' · '))}</small></div>${reviewControl(l,'btn mini')}</li>`).join('')+more(q.loans.count,q.loans.rows.length):'<li class="muted-note">No loans waiting for approval.</li>';
  return `<div class="card panel" style="margin-top:17px"><h3>Work queue</h3>${sub(adm?'Across all branches.':'For your branch.')}<div class="queue-grid"><div><h4>Awaiting KYC verification <span class="badge b-pending">${q.kyc.count}</span></h4><ul class="queue-list">${kyc}</ul></div><div><h4>Loans awaiting approval <span class="badge b-pending">${q.loans.count}</span></h4><ul class="queue-list">${loans}</ul></div></div></div>`;
}

/* ----- reconciliation (1.9.1): do the branches add up to the company ledger? Admin only ----- */
const RC=state.recon=state.recon||{key:'',inflight:null,data:null};
let rcSeq=0;
async function loadRecon(){
  const cur=state.currency,seq=++rcSeq;RC.inflight=cur;
  const r=await state.sb.rpc('branch_reconciliation',{p_currency:cur});
  if(seq!==rcSeq)return;
  RC.inflight=null;RC.key=cur;RC.data=r.error?null:r.data;   // an old database simply shows no banner
  if(state.view==='branches')branchesView($('content'));else if(state.view==='performance')performanceView($('content'));
}
function reconBanner(){
  if(!isAdminUser())return '';
  const cur=state.currency;
  if(RC.key!==cur&&RC.inflight!==cur)loadRecon();
  if(RC.key!==cur||!RC.data)return '';
  const rows=RC.data.rows||[],bad=rows.filter(r=>Number(r.difference_minor)!==0),un=Number(RC.data.unassigned_loans||0);
  const unNote=un?` ${un} loan${un>1?'s are':' is'} not in any branch and shown as Unassigned.`:'';
  if(!bad.length)return `<div class="alert ok" role="status" style="margin-bottom:17px"><b>Branches agree with the company ledger</b> (${esc(cur)}): ${rows.map(r=>`${esc(r.label.toLowerCase())} ${esc(moneyText(r.ledger_minor,cur))}`).join(' · ')}.${unNote}</div>`;
  const tr=rows.map(r=>{const d=Number(r.difference_minor);return `<tr><td>${esc(r.label)}</td><td class="num">${mc(r.ledger_minor,cur)}</td><td class="num">${mc(r.branches_minor,cur)}</td><td class="num">${mc(r.unassigned_minor,cur)}</td><td class="num"${d?' style="font-weight:700"':''}>${d?mc(d,cur):'—'}</td></tr>`}).join('');
  return `<div class="alert warn" role="alert" style="margin-bottom:17px"><b>Branch totals differ from the company ledger</b> (${esc(cur)}). Something was recorded in the ledger that no loan or repayment accounts for, or the other way round.${unNote}<div class="table-wrap" style="margin-top:10px"><table class="table"><thead><tr><th>Check</th><th class="num">Company ledger</th><th class="num">Branches</th><th class="num">Unassigned</th><th class="num">Difference</th></tr></thead><tbody>${tr}</tbody></table></div></div>`;
}
