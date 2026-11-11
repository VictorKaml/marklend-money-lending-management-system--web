/* Auto-update UI: a bottom banner (progress, Restart now / Later) and the Settings "Application" card.
 * Main process sends {state: checking|available|downloading|downloaded|not-available|error|dev}. */
const upd={state:null,version:'',percent:0,message:'',current:'',dismissed:false,manual:false};

function updateLine(){
  const s=upd;
  if(s.state==='checking')return 'Checking for updates…';
  if(s.state==='available')return `Update ${esc(s.version)} found. Downloading…`;
  if(s.state==='downloading')return `Downloading update… ${Number(s.percent)||0}%`;
  if(s.state==='downloaded')return `Version ${esc(s.version)} is ready. Restart to install.`;
  if(s.state==='not-available')return 'You are on the latest version.';
  if(s.state==='dev')return 'Updates are checked only in the installed app.';
  if(s.state==='error')return 'Could not check for updates. Check your internet connection and try again.';
  return '';
}
function applicationCard(){
  const busy=['checking','available','downloading'].includes(upd.state);
  const line=updateLine();
  return `<p style="font-size:12px;color:var(--muted)">MarkLend Desktop <b id="appVersion">${esc(upd.current||'…')}</b> · Electron · Supabase backend · Immutable lending ledger.</p><div style="margin-top:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button class="btn" id="updCheckBtn" onclick="checkUpdatesNow()" ${busy?'disabled':''}>Check for updates</button>${upd.state==='downloaded'?'<button class="btn primary" onclick="installUpdate()">Restart now</button>':''}<span id="updStatus" style="font-size:12px;color:var(--muted)">${line}</span></div>`;
}
function renderUpdateBanner(){
  let el=document.getElementById('updateBanner');
  const show=!upd.dismissed&&['downloading','downloaded'].includes(upd.state);
  if(!show){if(el)el.remove();return}
  if(!el){el=document.createElement('div');el.id='updateBanner';el.className='update-banner';el.setAttribute('role','status');document.body.appendChild(el)}
  const pct=Math.max(0,Math.min(100,Number(upd.percent)||0));
  el.innerHTML=upd.state==='downloaded'
    ?`<div><b>MarkLend ${esc(upd.version)} is ready</b><small>Restart to finish updating. It also installs when you close the app.</small></div><div class="update-actions"><button class="btn" id="updLater" onclick="dismissUpdate()">Later</button><button class="btn primary" id="updRestart" onclick="installUpdate()">Restart now</button></div>`
    :`<div><b>Downloading update ${esc(upd.version)}</b><small>${pct}%</small><div class="update-bar"><i style="width:${pct}%"></i></div></div>`;
}
function refreshUpdateUI(){
  renderUpdateBanner();
  const st=document.getElementById('updStatus');
  if(st){st.innerHTML=updateLine();const b=document.getElementById('updCheckBtn');if(b)b.disabled=['checking','available','downloading'].includes(upd.state)}
}
function onUpdateStatus(x){
  if(!x)return;
  upd.state=x.state;if(x.version)upd.version=x.version;if(x.percent!=null)upd.percent=x.percent;upd.message=x.message||'';
  if(x.state==='downloaded')upd.dismissed=false;
  refreshUpdateUI();
  if(x.state==='downloaded'&&state.view==='settings'&&typeof go==='function')go('settings');
}
function checkUpdatesNow(){upd.manual=true;upd.state='checking';refreshUpdateUI();window.marklendAPI.checkForUpdates().catch(()=>onUpdateStatus({state:'error'}))}
function installUpdate(){window.marklendAPI.restartAndInstall()}
function dismissUpdate(){upd.dismissed=true;renderUpdateBanner()}
async function initUpdates(){
  const api=window.marklendAPI;
  api.onUpdateStatus(onUpdateStatus);
  try{upd.current=await api.getVersion()}catch(_){}
  try{const s=await api.getUpdateState();if(s)onUpdateStatus(s)}catch(_){}
}
