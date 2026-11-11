const { app, BrowserWindow, dialog, Menu, ipcMain, shell } = require("electron");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const fs = require("fs");
const { autoUpdater } = require("electron-updater");

let mainWindow = null;
let splashWindow = null;
let updateReadyToInstall = false;
let installTriggered = false;

const APP_ICON = path.join(__dirname, "assets", "icons", "icon.ico");
const CONFIG_PATH = () => path.join(app.getPath("userData"), "marklend-config.json");

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH(), "utf8")); } catch (_) { return {}; }
}
function writeConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_PATH()), { recursive: true });
  fs.writeFileSync(CONFIG_PATH(), JSON.stringify(config, null, 2), "utf8");
  return config;
}
let lastUpdateState = null;
function sendUpdateStatus(data) {
  lastUpdateState = data;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("update-status", data);
}
function silentInstallAndRelaunch() {
  if (installTriggered) return;
  installTriggered = true;
  autoUpdater.quitAndInstall(true, true);
}
function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on("checking-for-update", () => sendUpdateStatus({state:"checking"}));
  autoUpdater.on("update-available", info => sendUpdateStatus({state:"available", version:info.version}));
  autoUpdater.on("update-not-available", () => sendUpdateStatus({state:"not-available"}));
  autoUpdater.on("error", err => sendUpdateStatus({state:"error", message:err.message}));
  autoUpdater.on("download-progress", p => sendUpdateStatus({state:"downloading", percent:Math.round(p.percent)}));
  autoUpdater.on("update-downloaded", info => { updateReadyToInstall=true; sendUpdateStatus({state:"downloaded",version:info.version}); });
}
function checkForUpdates(manual) {
  if (!app.isPackaged) { if (manual === true) sendUpdateStatus({state:"dev"}); return; }
  if (updateReadyToInstall) return;
  autoUpdater.checkForUpdates().catch(err => sendUpdateStatus({state:"error",message:err.message}));
}
function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label:"File",submenu:[
      {label:"Reload MarkLend",accelerator:"CmdOrCtrl+R",click:()=>mainWindow?.reload()},
      {type:"separator"},{role:"quit"}
    ]},
    {label:"View",submenu:[{role:"reload"},{role:"toggleDevTools"},{type:"separator"},{role:"resetZoom"},{role:"zoomIn"},{role:"zoomOut"},{type:"separator"},{role:"togglefullscreen"}]},
    {label:"Help",submenu:[{label:"Check for Updates...",click:()=>checkForUpdates(true)},{label:"MarkLend Help",click:()=>shell.openExternal("https://supabase.com/docs")} ]}
  ]));
}
function createWindow() {
  mainWindow=new BrowserWindow({width:1440,height:900,minWidth:1100,minHeight:680,show:false,icon:fs.existsSync(APP_ICON)?APP_ICON:undefined,backgroundColor:"#000000",webPreferences:{preload:path.join(__dirname,"preload.js"),contextIsolation:true,nodeIntegration:false,sandbox:false}});
  mainWindow.loadFile(path.join(__dirname,"index.html"));
  buildMenu();
  mainWindow.on("closed",()=>{mainWindow=null});
  return mainWindow;
}
async function startup() {
  createWindow();
  mainWindow.once("ready-to-show",()=>{
    mainWindow?.show();
    mainWindow?.webContents.send("app-config",readConfig());
    setTimeout(()=>checkForUpdates(false),8000);
  });
}
ipcMain.handle("get-config",()=>{
  const saved=readConfig();
  return {
    supabaseUrl: saved.supabaseUrl || process.env.SUPABASE_URL || "",
    supabaseAnonKey: saved.supabaseAnonKey || process.env.SUPABASE_ANON_KEY || "",
    ...saved
  };
});
ipcMain.handle("save-config",(_e,config)=>writeConfig(config));
ipcMain.handle("open-external",(_e,url)=>{let u;try{u=new URL(String(url))}catch(_){return false}if(!["https:","http:","mailto:"].includes(u.protocol))return false;return shell.openExternal(u.toString())});
ipcMain.handle("get-version",()=>app.getVersion());
ipcMain.handle("get-update-state",()=>lastUpdateState);
ipcMain.handle("check-for-updates",()=>{checkForUpdates(true);return true;});
ipcMain.handle("restart-and-install",()=>silentInstallAndRelaunch());
ipcMain.handle("export-pdf",async(_e,{html,filename,landscape,reveal}={})=>{
  // Render from a temp file (not a data: URL) so large embedded images such as the logo are safe.
  const tmp=path.join(app.getPath("temp"),`marklend-${Date.now()}-${Math.random().toString(16).slice(2)}.html`);
  fs.writeFileSync(tmp,String(html||""),"utf8");
  const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,javascript:false}});
  try{
    await win.loadFile(tmp);
    const pdf=await win.webContents.printToPDF({pageSize:"A4",landscape:landscape!==false,printBackground:true,margins:{marginType:"default"}});
    const safe=String(filename||"marklend-export.pdf").replace(/[\\/:*?"<>|]/g,"-");
    const r=await dialog.showSaveDialog(mainWindow,{defaultPath:safe,filters:[{name:"PDF",extensions:["pdf"]}]});
    if(r.canceled||!r.filePath)return {canceled:true};
    fs.writeFileSync(r.filePath,pdf);
    if(reveal)shell.showItemInFolder(r.filePath);
    return {path:r.filePath};
  } finally { win.destroy(); try{fs.unlinkSync(tmp)}catch(_){} }
});
let LOGO_DATA_URI;
ipcMain.handle("get-logo",()=>{
  if(LOGO_DATA_URI!==undefined)return LOGO_DATA_URI;
  try{LOGO_DATA_URI="data:image/png;base64,"+fs.readFileSync(path.join(app.getAppPath(),"assets","brand","logo.png")).toString("base64")}catch(_){LOGO_DATA_URI=null}
  return LOGO_DATA_URI;
});
// Opens the default mail app with a prefilled message. mailto: cannot attach files, so the PDF is revealed in its folder.
ipcMain.handle("compose-email",async(_e,{to,subject,body}={})=>{
  const addr=String(to||"").trim();
  if(!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(addr))throw new Error("Invalid email address");
  const q=`subject=${encodeURIComponent(String(subject||"").slice(0,200))}&body=${encodeURIComponent(String(body||"").slice(0,1500))}`;
  await shell.openExternal(`mailto:${addr}?${q}`);
  return true;
});
setupAutoUpdater();
app.on("before-quit",event=>{if(updateReadyToInstall&&!installTriggered){event.preventDefault();silentInstallAndRelaunch();}});
app.whenReady().then(startup);
app.on("window-all-closed",()=>{if(process.platform!=="darwin") app.quit();});
app.on("activate",()=>{if(BrowserWindow.getAllWindows().length===0) startup();});
setInterval(()=>checkForUpdates(false),4*60*60*1000);
