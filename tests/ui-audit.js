const chromium=require('@sparticuz/chromium').default||require('@sparticuz/chromium');
const puppeteer=require('puppeteer-core');const mock=require('./mockdb.js');
const ROOT=require('path').join(__dirname,'..')+'/';const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function open(b,theme,role='Admin'){mock.setRole(role,[]);const p=await b.newPage();await p.setViewport({width:1440,height:900});
  await p.evaluateOnNewDocument(t=>{localStorage.setItem('ml-theme',t);window.marklendAPI={getConfig:async()=>({supabaseUrl:'http://sb.test',supabaseAnonKey:'anon',accessToken:'tok',refreshToken:'rt',rememberSession:true}),saveConfig:async c=>c,onUpdateStatus(){},exportPDF:async()=>({path:'x'}),getLogo:async()=>null,composeEmail:async()=>true}},theme);
  await p.setRequestInterception(true);p.on('request',q=>{const u=q.url();if(u.startsWith('http://sb.test')){const r=mock.handle(u,q.method(),q.headers(),q.postData()||'');q.respond({status:r.status,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-expose-headers':'content-range',...(r.range?{'content-range':r.range}:{})},body:r.text})}else q.continue()});
  await p.goto('file://'+ROOT+'index.html');await sleep(1800);return p}
const audit=()=>{
  const parse=c=>{const m=c.match(/rgba?\(([^)]+)\)/);if(!m)return null;const a=m[1].split(',').map(x=>parseFloat(x));return{r:a[0],g:a[1],b:a[2],a:a.length>3?a[3]:1}};
  const lum=({r,g,b})=>{const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)};return .2126*f(r)+.7152*f(g)+.0722*f(b)};
  const over=(top,bot)=>({r:top.r*top.a+bot.r*(1-top.a),g:top.g*top.a+bot.g*(1-top.a),b:top.b*top.a+bot.b*(1-top.a),a:1});
  const bgOf=el=>{const stack=[];for(let e=el;e;e=e.parentElement){const cs=getComputedStyle(e);if(cs.backgroundImage!=='none'&&!/^url/.test(cs.backgroundImage)&&e!==el)return null;const c=parse(cs.backgroundColor);if(c&&c.a>0)stack.push(c);if(c&&c.a>=1)break}
    let base={r:255,g:255,b:255,a:1};if(!stack.length||stack[stack.length-1].a<1){const bd=parse(getComputedStyle(document.documentElement).backgroundColor);if(bd)base=bd}
    for(let i=stack.length-1;i>=0;i--)base=over(stack[i],base);return base};
  const bad=[];const seen=new Set();
  for(const el of document.querySelectorAll('body *')){
    if(el.closest('#startupScreen,.lock-screen,svg,script,style,.av-opt'))continue;
    const r=el.getBoundingClientRect();if(r.width<2||r.height<2)continue;const cs=getComputedStyle(el);if(cs.visibility==='hidden'||cs.display==='none'||parseFloat(cs.opacity)<.5)continue;
    const hasText=[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim().length>0);if(!hasText)continue;
    const fg=parse(cs.color);if(!fg)continue;const bg=bgOf(el);if(!bg)continue;
    const f=fg.a<1?over(fg,bg):fg;const L1=lum(f),L2=lum(bg),ratio=(Math.max(L1,L2)+.05)/(Math.min(L1,L2)+.05);
    const size=parseFloat(cs.fontSize),bold=parseInt(cs.fontWeight)>=700,large=size>=24||(size>=18.66&&bold);
    if(ratio<(large?3:4.5)){const key=el.tagName+'.'+el.className+'|'+el.textContent.trim().slice(0,24);if(!seen.has(key)){seen.add(key);bad.push({t:el.textContent.trim().slice(0,28),cls:el.tagName.toLowerCase()+'.'+String(el.className).split(' ')[0],ratio:+ratio.toFixed(2),size})}}
  }
  const heights={};
  for(const el of document.querySelectorAll('.btn:not(.mini),.hbtn,.signout-btn,.user,.cursel,.search,.field input:not([type=checkbox]):not([type=hidden]),.field select,.dr input,.picker input:not([type=hidden])')){
    const r=el.getBoundingClientRect();if(r.width<2)continue;const h=Math.round(r.height);(heights[h]=heights[h]||[]).push(el.className||el.tagName)}
  const ctl={};for(const [h,l] of Object.entries(heights))ctl[h]=l.length+' e.g. '+[...new Set(l)].slice(0,3).join(',');
  const overflow=[...document.querySelectorAll('.metric .value')].filter(e=>e.scrollWidth>e.clientWidth+1).length;
  const hscroll=document.documentElement.scrollWidth>document.documentElement.clientWidth+1;
  return{bad,ctl,overflow,hscroll}};
(async()=>{
  const b=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--allow-file-access-from-files'],executablePath:await chromium.executablePath(),headless:'shell'});
  let totalBad=0,uniformFail=0;const agg={};
  for(const theme of ['light','dark']){
    const p=await open(b,theme);
    const steps=[['dashboard',"go('dashboard')"],['borrowers',"go('borrowers')"],['loans',"go('loans')"],['collections',"go('collections')"],['repayments',"go('repayments')"],['ledger',"go('ledger')"],['reports',"go('reports')"],['capital',"go('capital')"],['audit',"go('audit')"],['settings',"go('settings')"],['loan-detail',"openLoanDetail('L5')"],['repayment-modal',"openRepaymentModal('L5')"],['review-modal',"reviewLoan('L1')"],['new-loan-modal',"openLoanModal()"],['capital-modal',"openCapitalModal()"]];
    for(const [name,code] of steps){
      await p.evaluate(()=>closeModal());await p.evaluate(code);await sleep(name.includes('modal')||name==='loan-detail'?900:600);
      const r=await p.evaluate(audit);
      const hs=Object.keys(r.ctl).filter(h=>+h!==38&&+h!==28);
      totalBad+=r.bad.length;r.bad.forEach(x=>{const k=theme+' '+x.cls+' ratio '+x.ratio+' "'+x.t+'"';agg[k]=(agg[k]||[]).concat(name)});if(hs.length)uniformFail++;
      if(process.env.VERBOSE)console.log(`${theme.padEnd(5)} ${name.padEnd(16)} lowContrast=${r.bad.length}${r.bad.length?' '+JSON.stringify(r.bad.slice(0,4)):''} ctlHeights=${JSON.stringify(Object.fromEntries(Object.entries(r.ctl).map(([h,v])=>[h,v.split(' ')[0]])))}${hs.length?' ODD:'+hs.map(h=>h+'→'+r.ctl[h]).join(';'):''} overflow=${r.overflow} hscroll=${r.hscroll}`);
    }
    await p.close();
  }
  for(const [k,v] of Object.entries(agg))console.log('  ',k,'→',[...new Set(v)].length,'screens');console.log('TOTAL low-contrast text items:',totalBad,'| screens with non-uniform controls:',uniformFail);
  await b.close();
})().catch(e=>{console.log('ERR',e.stack.slice(0,600));process.exit(1)});
