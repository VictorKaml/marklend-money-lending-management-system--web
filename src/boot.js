/* Boot sequence */

['mousemove','mousedown','keydown','scroll','touchstart'].forEach(ev=>window.addEventListener(ev,activityPing,{passive:true}));

window.addEventListener('DOMContentLoaded',async()=>{initStartupDots();state.currency=state.currency||'MWK';applyUI();bindGlobalKeys();state.config=await window.marklendAPI.getConfig();renderNav();go('dashboard');startupStep('stepConfig','active');startupStatus('Preparing MarkLend','Checking your secure session.');ls.del('marklend-dashboard-snapshot');const restored=false;startupStep('stepConfig','done');startupStep('stepData',restored?'done':'active');if(restored){startupStatus('Portfolio snapshot restored','The latest known numbers are ready while MarkLend prepares authentication.');}await connect({startup:true});initUpdates();});

document.getElementById('modal').addEventListener('click',e=>{if(e.target.id==='modal')closeModal()});


