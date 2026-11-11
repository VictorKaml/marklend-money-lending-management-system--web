/* Browser implementation of the former Electron preload bridge.
 * Only the Supabase anon key is present here; never place service-role credentials in a browser.
 */
(function(){
  const defaults = {
    supabaseUrl: "https://omlcrgyiepnpcojjcjgm.supabase.co",
    supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tbGNyZ3lpZXBucGNvampjamdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5NjM2ODIsImV4cCI6MjEwNzUzOTY4Mn0.4h8tkpakJZe4Xk3yjwRVJ53wLEGW20lCL7gsgC09QZE"
  };
  const read = () => {
    try { return JSON.parse(localStorage.getItem('marklend-web-config') || '{}'); }
    catch (_) { return {}; }
  };
  const write = value => {
    const next = {...read(), ...(value || {})};
    localStorage.setItem('marklend-web-config', JSON.stringify(next));
    return next;
  };
  const safeMail = value => String(value || '').trim();
  window.marklendAPI = {
    getConfig: async () => ({...defaults, ...read()}),
    saveConfig: async config => write(config),
    openExternal: async url => {
      const u = new URL(String(url), window.location.href);
      if (!['https:', 'http:', 'mailto:'].includes(u.protocol)) throw new Error('Unsupported link');
      window.open(u.toString(), '_blank', 'noopener,noreferrer');
      return true;
    },
    exportPDF: async ({html: content, filename='marklend-export.pdf'}={}) => {
      const w = window.open('', '_blank');
      if (!w) throw new Error('Your browser blocked the print window. Allow pop-ups for this site and try again.');
      w.document.open();
      w.document.write(String(content || ''));
      w.document.close();
      const safeName = String(filename).replace(/[\\\\/:*?"<>|]/g, '-');
      w.document.title = safeName.replace(/\\.pdf$/i, '');
      const print = () => { try { w.focus(); w.print(); } catch (_) {} };
      if (w.document.readyState === 'complete') setTimeout(print, 250);
      else w.addEventListener('load', () => setTimeout(print, 250), {once:true});
      return {path: 'browser-print'};
    },
    getLogo: async () => {
      try {
        const response = await fetch('/assets/brand/logo.png');
        if (!response.ok) return null;
        const blob = await response.blob();
        return await new Promise(resolve => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        });
      } catch (_) { return null; }
    },
    composeEmail: async ({to, subject='', body=''}={}) => {
      const address = safeMail(to);
      if (!/^[^\\s@,;<>]+@[^\\s@,;<>]+\\.[^\\s@,;<>]+$/.test(address)) throw new Error('Invalid email address');
      const query = new URLSearchParams({subject: String(subject).slice(0,200), body: String(body).slice(0,1500)});
      window.location.href = `mailto:${address}?${query.toString()}`;
      return true;
    },
    onUpdateStatus: () => {},
    getVersion: async () => '1.0.0',
    getUpdateState: async () => null,
    checkForUpdates: async () => { window.location.reload(); return true; },
    restartAndInstall: async () => window.location.reload()
  };
})();
