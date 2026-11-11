/* Web release information. Desktop auto-updater is not used in browsers. */
function applicationCard(){
  return `<p style="font-size:12px;color:var(--muted)">MarkLend Web <b>1.0.0</b> · Browser application · Supabase backend.</p>
  <p style="font-size:12px;color:var(--muted);margin-top:10px">Updates are published through the website deployment. Refresh your browser to load the latest version.</p>`;
}
function initUpdates(){}
function checkUpdatesNow(){window.location.reload();}
function installUpdate(){window.location.reload();}
function dismissUpdate(){const el=document.getElementById('updateBanner');if(el)el.remove();}
