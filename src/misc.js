/* Global search, sign-out, key bindings */

/* ---------- global search (Ctrl/Cmd+K): searches the whole database, not just what is loaded ---------- */
let palI=0,palL=[],palSeq=0,palT;
function openPalette(){
  if(!state.user||state.userProfile?.role==='Borrower')return;
  let p=$('pal');
  if(!p){
    p=document.createElement('div');p.id='pal';
    p.innerHTML='<div class="pal-box" role="dialog" aria-label="Global search"><input id="palQ" placeholder="Search borrowers, loans and pages…" autocomplete="off"><div id="palR"></div><div class="pal-foot">↑↓ navigate · Enter open · Esc close</div></div>';
    p.onclick=e=>{if(e.target===p)closePalette()};document.body.append(p);
    $('palQ').oninput=()=>{palI=0;clearTimeout(palT);palT=setTimeout(palSearch,180)};
    $('palQ').onkeydown=e=>{
      if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();palI=Math.max(0,Math.min(palL.length-1,palI+(e.key==='ArrowDown'?1:-1)));palPaint()}
      else if(e.key==='Enter'){e.preventDefault();palGo(palI)}
    };
  }
  p.classList.add('show');$('palQ').value='';palI=0;palSearch();$('palQ').focus();
}
function closePalette(){$('pal')?.classList.remove('show')}
async function palSearch(){
  const q=$('palQ').value.trim(),seq=++palSeq,ql=q.toLowerCase();
  const pages=NAV.filter(([id])=>id==='settings'||id==='audit'?(id==='audit'?state.userProfile?.role==='Admin':true):can(SECTION_PERMS[id]||id)).filter(([,,l])=>!ql||l.toLowerCase().includes(ql)).slice(0,ql?3:0).map(([id,,l])=>({k:'Go to',t:l,s:'Page',f:()=>go(id)}));
  const loanItem=l=>({k:'Loans',t:l.loan_number,s:`${l.borrower_name||''} · ${l.status}`,f:()=>openLoanDetail(l.id)});
  if(!q){palL=[...state.loans.slice(0,5).map(l=>({...loanItem(l),k:'Recent loans'}))];palPaint('Type to search every borrower and loan.');return}
  palL=pages;palPaint('Searching…');
  const t=likeTerm(q),jobs=[];
  if(can('borrowers'))jobs.push(safeQ('borrower_summary',{or:['full_name','phone','email','business_name'].map(c=>`${c}.ilike.${t}`).join(','),order:[['full_name',true]],from:0,to:5}).then(r=>r.data.map(b=>({k:'Borrowers',t:b.full_name,s:[b.phone,b.email].filter(Boolean).join(' · '),f:()=>{const s=pgs('borrowers');s.q=b.full_name;s.page=0;s.stale=true;go('borrowers')}}))));
  if(can('loans'))jobs.push(safeQ('loan_summary',{or:['loan_number','borrower_name'].map(c=>`${c}.ilike.${t}`).join(','),order:[['created_at',false]],from:0,to:5}).then(r=>r.data.map(loanItem)));
  const res=(await Promise.all(jobs)).flat();
  if(seq!==palSeq)return;
  palL=[...res,...pages];palPaint();
}
function palPaint(msg){
  const h=$('palR');if(!h)return;let last='';
  h.innerHTML=palL.length?palL.map((r,i)=>`${r.k!==last?`<div class="pal-g">${last=r.k}</div>`:''}<div class="pal-i${i===palI?' sel':''}" onclick="palGo(${i})"><span>${esc(r.t)}</span><small>${esc(r.s)}</small></div>`).join('')+(msg?`<div class="empty" style="padding:8px">${esc(msg)}</div>`:''):`<div class="empty">${esc(msg||'No matches.')}</div>`;
  h.querySelector('.sel')?.scrollIntoView({block:'nearest'});
}
function palGo(i){const r=palL[i];if(!r)return;closePalette();r.f()}

/* ---------- sign-out ---------- */
/* The bug: after sign-in the startup screen gets the "hidden" class. Sign-out then showed the login
   form *inside* that hidden screen, so nothing appeared and the button looked dead. */
function showStartupScreen(){$('startupReady')?.classList.remove('show');$('startupScreen')?.classList.remove('hidden')}
const withTimeout=(p,ms)=>Promise.race([Promise.resolve(p).catch(()=>{}),new Promise(r=>setTimeout(r,ms))]);
function resetSessionState(){
  Object.assign(state,{user:null,userProfile:null,permissions:{},borrowers:[],loans:[],repayments:[],metrics:null,series:null,overdueList:[],overdue:{},pendingCount:0,nextDue:[],schemaErr:false,pg:{},staff:[],auditLogs:[],penaltyRule:null,view:'dashboard',collB:-1,collQ:''});
  loaded=false;ls.del('marklend-dashboard-snapshot');
}
async function forceSignOut(message,auditAction='SIGN_OUT'){
  const sb=state.sb,had=!!state.user&&!!sb?.token;
  if(sessionRefreshTimer)clearInterval(sessionRefreshTimer);if(idleTimer)clearTimeout(idleTimer);
  closeModal();closePalette();$('lockScreen')?.classList.remove('show');
  resetSessionState();
  $('content').innerHTML='';renderNav();updateSessionUI();
  $('title').textContent='Dashboard';$('subtitle').textContent=SUBTITLES.dashboard;
  ['startupPassword','unlockPassword'].forEach(i=>{const e=$(i);if(e)e.value=''});
  const btn=$('startupLoginBtn');if(btn){btn.disabled=false;btn.textContent='Sign in securely'}
  startupStep('stepAuth','active');startupStep('stepData','');
  if(message)startupError(message);else clearStartupError();
  showStartupLogin();
  startupStatus('Sign in to MarkLend','Your secure session has ended. Sign in to continue.');
  $('connection').textContent='Supabase configured';$('connection').classList.remove('ok');
  /* the screen is already back; server clean-up is best effort and cannot block the UI */
  if(had)await withTimeout(sb.rpc('record_auth_event',{p_action:auditAction,p_details:{source:'desktop'}}),2500);
  if(sb)await withTimeout(sb.signOut(),3000);
}
async function signOutApp(){await forceSignOut('You have been signed out of MarkLend.','SIGN_OUT')}

/* ---------- boot ---------- */
function bindGlobalKeys(){
  bindEnterKey();
  let rz;window.addEventListener('resize',()=>{clearTimeout(rz);rz=setTimeout(fitMetrics,120)});
  window.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openPalette()}
    else if(e.key==='Escape'){closePalette();closeModal()}
  });
}

/* ---------- sign-up ---------- */
function startupNotice(html){const e=$('startupNotice');if(!e)return;e.innerHTML=html;e.classList.add('show')}
function clearStartupError(){$('startupError').classList.remove('show');$('startupNotice')?.classList.remove('show')}
async function resendConfirmation(email){
  try{await state.sb.resendSignup(email);toast('Confirmation email sent to '+email)}catch(e){toast(e.message)}
}
async function startupSignUp(){
  clearStartupError();
  const type=$('signupType').value,name=$('signupName').value.trim(),business=$('signupBusiness').value.trim(),email=$('signupEmail').value.trim(),phone=$('signupPhone').value.trim(),password=$('signupPassword').value;
  if(!state.sb)return startupError('MarkLend is not connected to Supabase yet. Check the connection settings.');
  if(!name||!email||password.length<8)return startupError('Name, email and a password of at least 8 characters are required.');
  if(!/^\S+@\S+\.\S+$/.test(email))return startupError('Enter a valid email address.');
  if(type==='Business'&&!business)return startupError('Business name is required for a business account.');
  const btn=$('signupBtn');btn.disabled=true;btn.textContent='Creating account…';
  try{
    const d=await state.sb.signUp(email,password,{full_name:name,phone,borrower_type:type,business_name:type==='Business'?business:null});
    if(d.access_token){
      state.sb.token=d.access_token;state.config.accessToken=d.access_token;state.config.refreshToken=d.refresh_token;state.config.rememberSession=true;
      await window.marklendAPI.saveConfig(state.config);await finishAuthenticatedSession();
    }else if(Array.isArray(d.identities)&&d.identities.length===0){
      /* Supabase hides "already registered" behind a fake user when email confirmation is on */
      showStartupLogin();$('startupEmail').value=email;
      startupError('An account with this email already exists. Sign in instead.');
    }else{
      showStartupLogin();$('startupEmail').value=email;
      startupStatus('Check your email','Confirm your email address, then sign in.');
      startupNotice(`<b>Account created.</b> We sent a confirmation link to <b>${esc(email)}</b>. Open it, then come back here and sign in.<br><small>If the link opens a page that will not load, that is fine: your address is still confirmed.</small><br><button class="auth-link" data-email="${esc(email)}" onclick="resendConfirmation(this.dataset.email)">Resend the email</button>`);
      $('startupPassword').focus();
    }
  }catch(e){startupError(e.message||'Could not create the borrower account.')}
  finally{btn.disabled=false;btn.textContent='Create borrower account'}
}
/* Enter submits the visible start-up form (login, sign-up, configuration) and the unlock screen. */
function bindEnterKey(){
  document.addEventListener('keydown',e=>{
    if(e.key!=='Enter'||e.isComposing)return;
    const t=e.target;if(!t||t.tagName!=='INPUT'||t.type==='checkbox')return;
    if(t.id==='unlockPassword'){e.preventDefault();unlockApp();return}
    const btn=t.closest('.startup-form')?.querySelector('.startup-btn');
    if(btn&&!btn.disabled){e.preventDefault();btn.click()}
  });
}

