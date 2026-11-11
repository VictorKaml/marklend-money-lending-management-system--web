/* Profile and avatars */

const AVATAR_SETS={
 Individual:[['ind-smile','🙂','#FFF1EA'],['ind-cool','😎','#E8F1FF'],['ind-farmer','🧑‍🌾','#E7F7EC'],['ind-teacher','🧑‍🏫','#F3E8FF'],['ind-worker','👷','#FFF6D6'],['ind-student','🧑‍🎓','#E0F4FA'],['ind-lion','🦁','#FFE9C7'],['ind-sun','🌻','#FFF3B8']],
 Business:[['biz-office','🏢','#E8F1FF'],['biz-store','🏪','#FFF1EA'],['biz-factory','🏭','#EDEEF2'],['biz-truck','🚚','#E0F4FA'],['biz-cart','🛒','#FDE8EF'],['biz-farm','🌾','#F5EDC8'],['biz-deal','🤝','#E7F7EC'],['biz-case','💼','#F3E8FF']],
 Staff:[['stf-chart','📊','#E8F1FF'],['stf-card','💳','#F3E8FF'],['stf-clip','📋','#FFF6D6'],['stf-compass','🧭','#E0F4FA'],['stf-deal','🤝','#E7F7EC'],['stf-person','🧑‍💼','#FFF1EA'],['stf-target','🎯','#FDE8EF'],['stf-bulb','💡','#FFF3B8']],
 Admin:[['adm-shield','🛡️','#E8F1FF'],['adm-crown','👑','#FFF3B8'],['adm-key','🔑','#FFF6D6'],['adm-star','⭐','#FFF1EA'],['adm-eagle','🦅','#EDEEF2'],['adm-bank','🏛️','#F3E8FF'],['adm-lock','🔐','#E7F7EC'],['adm-gem','💎','#E0F4FA']]
};

function avatarDef(key){if(!key)return null;for(const k in AVATAR_SETS){const x=AVATAR_SETS[k].find(a=>a[0]===key);if(x)return{key:x[0],e:x[1],bg:x[2]}}return null}

function profileKind(){const r=state.userProfile?.role;if(r==='Admin')return'Admin';if(r==='Loan Officer'||r==='Branch Manager')return'Staff';const b=(state.borrowers||[])[0];return b?.borrower_type==='Business'?'Business':'Individual'}

function profileKindLabel(){return{Admin:'Administrator',Staff:'Loan officer',Business:'Business borrower',Individual:'Individual borrower'}[profileKind()]}

function profileDetails(){const b=(state.borrowers||[])[0],k=profileKind(),rows=[['Name',state.userProfile?.full_name||'—'],['Email',state.user?.email||'—']];if(k==='Business'||k==='Individual'){if(k==='Business')rows.push(['Business',b?.business_name||'—']);if(b?.phone)rows.push(['Phone',b.phone]);rows.push(['KYC',b?.kyc_status||'—'])}return rows.map(r=>`<div><small>${r[0]}</small><b>${esc(String(r[1]))}</b></div>`).join('')}

function avatarPicker(){const cur=state.userProfile?.avatar;return`<div class="av-grid">${AVATAR_SETS[profileKind()].map(a=>`<div class="av-opt${cur===a[0]?' sel':''}" style="background:${a[2]}" title="${a[0]}" onclick="pickAvatar('${a[0]}')">${a[1]}</div>`).join('')}</div>`}

function profileHead(){const a=avatarDef(state.userProfile?.avatar);return`<div class="av-head"><div class="av-big" ${a?`style="background:${a[2]}"`:''}>${a?a.e:esc((state.user?.email||'U').charAt(0).toUpperCase())}</div><div><b style="font-size:15px">${esc(state.userProfile?.full_name||state.user?.email||'')}</b><div style="margin-top:4px"><span class="pill">${profileKindLabel()}</span></div></div></div>`}

function profileCard(){return`<div class="card panel"><h3>My profile</h3>${profileHead()}<div class="session-grid">${profileDetails()}</div><div style="margin-top:14px;font-size:12px;color:var(--muted)">Choose an avatar</div>${avatarPicker()}</div>`}

function openProfileModal(){if(!state.user)return;modal(`<div class="modal-head"><div><h2 style="margin-bottom:4px">My profile</h2><span style="font-size:11px;color:var(--muted)">Pick an avatar that suits your ${profileKindLabel().toLowerCase()} account.</span></div><button class="close" onclick="closeModal()">×</button></div>${profileHead()}<div class="session-grid">${profileDetails()}</div>${avatarPicker()}<div style="margin-top:14px"><button class="btn" onclick="pickAvatar(null)">Use my initial</button> <button class="btn primary" onclick="closeModal()">Done</button></div>`)}

function updateSessionUI(){renderNav();const email=document.getElementById('userEmail');const role=document.getElementById('roleText');const avatar=document.getElementById('userAvatar');if(email)email.textContent=state.user?.email||'Not signed in';if(role)role.textContent=state.userProfile?.role||'Borrower';if(avatar){const a=avatarDef(state.userProfile?.avatar);if(a){avatar.textContent=a.e;avatar.style.background=a.bg;avatar.classList.add('emoji')}else{avatar.textContent=(state.user?.email||'U').charAt(0).toUpperCase();avatar.style.background='';avatar.classList.remove('emoji')}}}

async function setAvatar(k){const {error}=await state.sb.rpc('set_my_avatar',{p_avatar:k});if(error)throw error;state.userProfile.avatar=k;updateSessionUI();if($('modal').classList.contains('show'))openProfileModal();if(state.view==='settings')render()}

async function pickAvatar(key){const prev=state.userProfile?.avatar||null;try{await setAvatar(key)}catch(e){return toast(/set_my_avatar|schema cache/i.test(e.message||'')?'Apply the schema.sql in Supabase to enable avatars.':(e.message||'Could not save avatar.'))}toast('Avatar updated',{undo:()=>setAvatar(prev)})}


