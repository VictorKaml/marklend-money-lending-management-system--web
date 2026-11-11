/* Startup, sign-in, session handling */

async function recordAuthEvent(action,details={}){try{if(state.sb?.token)await state.sb.rpc('record_auth_event',{p_action:action,p_details:details});}catch(_){} }

let sessionRefreshTimer=null;

let idleTimer=null;

let lastActivity=Date.now();

const IDLE_TIMEOUT_MS=30*60*1000;

function resetIdleTimer(){lastActivity=Date.now();if(idleTimer)clearTimeout(idleTimer);idleTimer=setTimeout(()=>{if(state.user)lockApp();},IDLE_TIMEOUT_MS);}

function startSessionRefresh(){if(sessionRefreshTimer)clearInterval(sessionRefreshTimer);sessionRefreshTimer=setInterval(async()=>{if(!state.sb||!state.user)return;try{await state.sb.refresh();updateSessionUI();}catch(e){await forceSignOut('Your session expired. Please sign in again.');}},4*60*1000);}

async function lockApp(){if(!state.user)return;await recordAuthEvent('SESSION_LOCK',{source:'web',idle_timeout_minutes:30});document.getElementById('lockScreen').classList.add('show');document.getElementById('unlockPassword').value='';document.getElementById('unlockError').textContent='';document.getElementById('unlockPassword').focus();}

async function unlockApp(){const pass=document.getElementById('unlockPassword').value;if(!pass)return;try{const email=state.user?.email;if(!email)throw new Error('No signed-in user');await state.sb.signIn(email,pass,state.config.rememberSession!==false);await recordAuthEvent('SESSION_UNLOCK',{source:'web'});document.getElementById('lockScreen').classList.remove('show');resetIdleTimer();startSessionRefresh();updateSessionUI();toast('MarkLend unlocked.');}catch(e){document.getElementById('unlockError').textContent=e.message||'Incorrect password.';}}

function activityPing(){if(state.user){resetIdleTimer();}}

function startupStep(id,stateName){const el=document.getElementById(id);if(!el)return;el.classList.remove('active','done');if(stateName==='active')el.classList.add('active');if(stateName==='done')el.classList.add('done')}

function startupStatus(title,subtitle){document.getElementById('startupTitle').textContent=title;document.getElementById('startupSubtitle').textContent=subtitle}

function startupError(message){const e=document.getElementById('startupError');e.textContent=message;e.classList.add('show')}

function revealDashboard(){document.getElementById('startupReady').classList.add('show');setTimeout(()=>document.getElementById('startupScreen').classList.add('hidden'),350)}

function showStartupLogin(){showStartupScreen();document.getElementById('startupLoginForm').classList.add('show');document.getElementById('startupSignupForm').classList.remove('show');document.getElementById('startupConfigForm').classList.remove('show');document.getElementById('startupEmail').focus()}

function showStartupSignup(){showStartupScreen();document.getElementById('startupSignupForm').classList.add('show');document.getElementById('startupLoginForm').classList.remove('show');document.getElementById('startupConfigForm').classList.remove('show');document.getElementById('signupType').onchange=()=>{document.getElementById('signupBusinessWrap').style.display=document.getElementById('signupType').value==='Business'?'block':'none'};document.getElementById('signupType').onchange();document.getElementById('signupName').focus()}

function showStartupConfig(){showStartupScreen();document.getElementById('startupConfigForm').classList.add('show');document.getElementById('startupLoginForm').classList.remove('show');document.getElementById('startupUrl').value=state.config.supabaseUrl||'';document.getElementById('startupKey').value=state.config.supabaseAnonKey||'';document.getElementById('startupUrl').focus()}

async function startupSaveConfig(){clearStartupError();const url=document.getElementById('startupUrl').value.trim(),key=document.getElementById('startupKey').value.trim();if(!url||!key)return startupError('Supabase URL and anon key are required.');state.config.supabaseUrl=url;state.config.supabaseAnonKey=key;delete state.config.accessToken;delete state.config.refreshToken;await window.marklendAPI.saveConfig(state.config);await connect({startup:true})}

async function startupSignIn(){clearStartupError();const email=document.getElementById('startupEmail').value.trim(),password=document.getElementById('startupPassword').value,remember=document.getElementById('rememberSession').checked;if(!email||!password)return startupError('Email and password are required.');const btn=document.getElementById('startupLoginBtn');btn.disabled=true;btn.textContent='Signing in…';try{await state.sb.signIn(email,password,remember);await recordAuthEvent('SIGN_IN',{source:'web',remember_session:remember});await finishAuthenticatedSession();btn.disabled=false;btn.textContent='Sign in securely';}catch(e){startupError(e.message||'Sign in failed.');btn.disabled=false;btn.textContent='Sign in securely'}}

async function finishAuthenticatedSession(){startupStep('stepAuth','done');state.user=await state.sb.getUser();let profile=await state.sb.from('profiles').select('full_name,role,avatar,branch_id').eq('id',state.user.id).single();if(profile.error)profile=await state.sb.from('profiles').select('full_name,role').eq('id',state.user.id).single();state.userProfile=profile.data||{full_name:state.user.user_metadata?.full_name||'',role:'Borrower'};const perms=await state.sb.from('staff_permissions').select('section,can_view,can_create,can_edit,can_approve').eq('user_id',state.user.id);state.permissions={};(perms.data||[]).forEach(x=>state.permissions[x.section]=x);await loadStaff();updateSessionUI();startSessionRefresh();resetIdleTimer();startupStep('stepData','active');startupStatus('Loading MarkLend','Loading the records available to your account.');await loadData();startupStep('stepData','done');startupStatus('Dashboard ready','Your MarkLend workspace is ready.');revealDashboard();}

function openLogin(){showStartupLogin()}

async function signIn(){return startupSignIn()}

async function saveSettings(){state.config.supabaseUrl=document.getElementById('sbUrl').value.trim();state.config.supabaseAnonKey=document.getElementById('sbKey').value.trim();delete state.config.accessToken;delete state.config.refreshToken;await window.marklendAPI.saveConfig(state.config);connect({startup:false});}

async function connect(options={startup:true}){clearStartupError();if(!state.config.supabaseUrl||!state.config.supabaseAnonKey){document.getElementById('connection').textContent='Not configured';startupStep('stepConfig','active');startupStatus('Configure MarkLend','Enter the Supabase connection details to begin.');showStartupConfig();return false}try{startupStep('stepConfig','done');startupStep('stepConnection','active');startupStatus('Preparing secure connection','Connecting MarkLend to the configured Supabase project.');if(!state.config.accessToken&&sessionStorage.getItem('marklend-access-token')){state.config.accessToken=sessionStorage.getItem('marklend-access-token');state.config.refreshToken=sessionStorage.getItem('marklend-refresh-token')||'';state.config.rememberSession=false;}state.sb=new SupaClient(state.config.supabaseUrl,state.config.supabaseAnonKey,state.config);document.getElementById('connection').textContent=state.config.accessToken?'Supabase connected':'Supabase configured';document.getElementById('connection').classList.toggle('ok',!!state.config.accessToken);startupStep('stepConnection','done');if(!state.config.accessToken){startupStep('stepAuth','active');startupStatus('Sign in to MarkLend','Sign in or create a borrower account to continue.');showStartupLogin();return false}try{state.user=await state.sb.getUser();}catch(_){try{await state.sb.refresh();state.user=await state.sb.getUser();}catch(e){delete state.config.accessToken;delete state.config.refreshToken;await window.marklendAPI.saveConfig(state.config);sessionStorage.removeItem('marklend-access-token');sessionStorage.removeItem('marklend-refresh-token');startupStep('stepAuth','active');startupStatus('Sign in to MarkLend','Your saved session could not be restored. Please sign in again.');showStartupLogin();return false;}}await finishAuthenticatedSession();return true}catch(e){document.getElementById('connection').textContent='Connection error';startupError(e.message||'Unable to connect to Supabase.');startupStatus('Sign in to MarkLend','The previous session could not be restored. Please sign in again.');showStartupLogin();return false}}

function initStartupDots(){const host=document.getElementById('startupDots');if(!host)return;for(let i=0;i<70;i++){const d=document.createElement('span');d.className='startup-dot-float';d.style.left=(Math.random()*100)+'%';d.style.top=(70+Math.random()*45)+'%';d.style.animationDuration=(7+Math.random()*10)+'s';d.style.animationDelay=(-Math.random()*12)+'s';d.style.opacity=(.2+Math.random()*.5).toFixed(2);host.appendChild(d)}}


