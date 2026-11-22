// MotoHava — uygulama kabuğunu önbellekte tutar (hava ve rota her zaman canlı çekilir)
const SURUM = "czz-moto-hava-v6";
const KABUK = ["./", "index.html", "style.css", "app.js", "hava.js", "logo.png", "icon-180.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "manifest.webmanifest"];
self.addEventListener("install", e => e.waitUntil(caches.open(SURUM).then(c => c.addAll(KABUK)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== SURUM).map(x => caches.delete(x)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return;   // dış servisler (hava, rota, harita) önbelleğe alınmaz
  // her açılışta sunucuya "değişti mi?" diye sor (GitHub'ın 10 dk önbelleğini atla); internet yoksa kayıtlı kopya
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then(r => { const k = r.clone(); caches.open(SURUM).then(c => c.put(e.request, k)); return r; }).catch(() => caches.match(e.request)));
});
