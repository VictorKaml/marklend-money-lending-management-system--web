/* Browser replacement for Electron's preload bridge.
   Uses local browser storage, print-to-PDF, and mailto; no privileged credentials. */
(() => {
  const key = "marklend-web-config";
  const read = () => { try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch { return {}; } };
  const write = (v) => { localStorage.setItem(key, JSON.stringify(v || {})); return v; };
  window.marklendAPI = {
    getConfig: async () => read(),
    saveConfig: async (v) => write(v),
    openExternal: async (url) => window.open(url, "_blank", "noopener,noreferrer"),
    onUpdateStatus: () => {},
    exportPDF: async ({html, filename}) => {
      const w = window.open("", "_blank");
      if (!w) throw new Error("Allow pop-ups to create or print the PDF.");
      w.document.open(); w.document.write(html); w.document.close();
      w.document.title = filename || "MarkLend document";
      w.focus();
      setTimeout(() => w.print(), 350);
      return { browserPrint: true, filename };
    },
    getLogo: async () => {
      try {
        const r = await fetch("assets/brand/logo.png");
        if (!r.ok) return null;
        const b = await r.blob();
        return await new Promise(resolve => { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.readAsDataURL(b); });
      } catch { return null; }
    },
    composeEmail: async ({to, subject, body}) => {
      const url = "mailto:" + encodeURIComponent(to || "") + "?subject=" + encodeURIComponent(subject || "") + "&body=" + encodeURIComponent(body || "");
      window.location.href = url;
      return { opened: true };
    },
    getVersion: async () => "1.0.0-web",
    getUpdateState: async () => ({state:"web"}),
    checkForUpdates: async () => ({state:"web"}),
    restartAndInstall: async () => ({state:"web"})
  };
})();