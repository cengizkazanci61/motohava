// MotoHava — arayüz: yer arama (Photon), rota (OSRM), hava (Open-Meteo), harita (MapLibre + OpenFreeMap)
"use strict";

const $ = s => document.querySelector(s);
const TR_BBOX = "25.6,35.8,44.9,42.2";
const secim = { nereden: null, nereye: null };
let harita, sonVeri = null;

// ------------------------------------------------------------------ harita
function haritaKur() {
  harita = new maplibregl.Map({
    container: "harita", style: "https://tiles.openfreemap.org/styles/dark",
    center: [33.5, 39.3], zoom: 5.2, attributionControl: { compact: true }
  });
  harita.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  new ResizeObserver(() => harita.resize()).observe($("#harita"));   // yerleşim değişince harita tuvali de büyüsün
  harita.on("load", () => {
    // harita yazıları Türkçe (yoksa yerel ad)
    for (const k of harita.getStyle().layers)
      if (k.type === "symbol" && harita.getLayoutProperty(k.id, "text-field"))
        harita.setLayoutProperty(k.id, "text-field", ["coalesce", ["get", "name:tr"], ["get", "name:latin"], ["get", "name"]]);
    harita.addSource("rota", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    const yuv = { "line-cap": "round", "line-join": "round" };
    harita.addLayer({ id: "rota-parlama", type: "line", source: "rota", paint: { "line-color": ["get", "renk"], "line-width": 18, "line-blur": 12, "line-opacity": .55 }, layout: yuv });
    harita.addLayer({ id: "rota-alt", type: "line", source: "rota", paint: { "line-color": "#0c0d10", "line-width": 8 }, layout: yuv });
    harita.addLayer({ id: "rota", type: "line", source: "rota", paint: { "line-color": ["get", "renk"], "line-width": 5 }, layout: yuv });
    harita.addSource("nokta", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    harita.addLayer({ id: "nokta", type: "circle", source: "nokta", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 2.5, 10, 6], "circle-color": ["get", "renk"], "circle-stroke-color": "#fff", "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 5, 1, 10, 2] } });
    harita.on("click", "nokta", e => noktaPopup(e.features[0].properties.x));
    harita.on("mouseenter", "nokta", () => harita.getCanvas().style.cursor = "pointer");
    harita.on("mouseleave", "nokta", () => harita.getCanvas().style.cursor = "");
    // haritada boş bir yere dokun → "Buradan başla / Buraya git" (listede çıkmayan yerler için)
    harita.on("click", e => {
      if (surus) return;
      if (harita.queryRenderedFeatures(e.point, { layers: ["nokta"] }).length) return;
      const c = { lon: e.lngLat.lng, lat: e.lngLat.lat };
      const d = el("div", "sec-popup");
      d.appendChild(el("b", null, "Bu nokta"));
      const yaz = el("div", "sec-ad", "…"); d.appendChild(yaz);
      const p = new maplibregl.Popup({ offset: 8 }).setLngLat(e.lngLat).setDOMContent(d).addTo(harita);
      const b1 = el("button", null, "Buradan başla"), b2 = el("button", null, "Buraya git");
      d.append(b1, b2);
      let ad = "Haritadan seçilen yer";
      fetch(`https://photon.komoot.io/reverse?lon=${c.lon}&lat=${c.lat}&limit=1`).then(r => r.json()).then(j => {
        const pr = j.features?.[0]?.properties; if (pr) { ad = [pr.name, pr.district || pr.city].filter(Boolean).join(", ") || ad; yaz.textContent = ad; }
      }).catch(() => yaz.textContent = "");
      const ata = alan => { secim[alan] = { ad, ...c }; $("#" + alan).value = ad; p.remove(); if (secim.nereden && secim.nereye) hesapla(); };
      b1.onclick = () => ata("nereden"); b2.onclick = () => ata("nereye");
    });
    if (sonVeri) cizHarita(sonVeri);
  });
}
const RENK = { yesil: "#35d07f", sari: "#ffc61a", kirmizi: "#ff4d42" };
let isaretler = [];
let surus = null;   // sürüş modu durumu

// ------------------------------------------------------------------ hava ikonları (WMO kodu + gece)
function ikon(kod, gunduz, ani) {
  const gunes = `<circle cx="24" cy="22" r="8" fill="#ffc61a"/><g stroke="#ffc61a" stroke-width="2.4" stroke-linecap="round"><path d="M24 7v4M24 33v4M9 22h4M35 22h4M13.4 11.4l2.8 2.8M31.8 29.8l2.8 2.8M13.4 32.6l2.8-2.8M31.8 14.2l2.8-2.8"/></g>`;
  const ay = `<path d="M30 10a12 12 0 1 0 8 19 10 10 0 0 1-8-19z" fill="#c9d3ff"/>`;
  const bulut = (y = 0, r = "#d7dbe2") => `<path d="M15 ${36 + y}h20a8 8 0 0 0 0-16 11 11 0 0 0-21-2 7 7 0 0 0 1 18z" fill="${r}"/>`;
  const damla = `<g stroke="#4fb3ff" stroke-width="2.6" stroke-linecap="round"><path d="M17 40l-2 5M25 40l-2 5M33 40l-2 5"/></g>`;
  const kar = `<g fill="#fff"><circle cx="17" cy="42" r="2"/><circle cx="25" cy="45" r="2"/><circle cx="33" cy="42" r="2"/></g>`;
  const simsek = `<path d="M26 36l-5 8h5l-3 7 8-10h-5l3-5z" fill="#ffc61a"/>`;
  const sis = `<g stroke="#aab1bc" stroke-width="2.6" stroke-linecap="round"><path d="M9 32h30M13 38h26M9 44h24"/></g>`;
  const ruzgar = `<g stroke="#9fe0ff" stroke-width="2.6" fill="none" stroke-linecap="round"><path d="M6 40h26a5 5 0 1 0-5-5M6 46h18a4 4 0 1 1-4 4"/></g>`;
  const gk = gunduz ? gunes : ay;
  let ic;
  if ([45, 48].includes(kod)) ic = bulut(-8, "#8a919c") + sis;
  else if ([95, 96, 99].includes(kod)) ic = bulut(-4, "#7c8491") + simsek;
  else if ([71, 73, 75, 77, 85, 86].includes(kod)) ic = bulut(-4) + kar;
  else if (kod >= 51 && kod <= 82) ic = bulut(-4, "#a9b0bb") + damla;
  else if (kod === 3) ic = bulut(0, "#a9b0bb");
  else if (kod === 1 || kod === 2) ic = `<g transform="translate(-6,-5)">${gk}</g>` + bulut(2);
  else ic = gk;
  if (ani >= 45) ic += `<g transform="translate(20,-4) scale(.55)">${ruzgar}</g>`;
  return `<svg viewBox="0 0 48 52" aria-hidden="true">${ic}</svg>`;
}

// kilometre saati gibi puan göstergesi
function gosterge(puan, seviye) {
  const cx = 75, cy = 78, r = 58, bas = 210, bit = -30, top = bas - bit;
  const nk = a => [cx + r * Math.cos(a * Math.PI / 180), cy - r * Math.sin(a * Math.PI / 180)];
  const yay = (a1, a2, renk, w) => { const [x1, y1] = nk(a1), [x2, y2] = nk(a2); return `<path d="M${x1},${y1} A${r},${r} 0 ${a1 - a2 > 180 ? 1 : 0} 1 ${x2},${y2}" stroke="${renk}" stroke-width="${w}" fill="none" stroke-linecap="round"/>`; };
  const a = bas - top * puan / 100, [ix, iy] = [cx + (r - 14) * Math.cos(a * Math.PI / 180), cy - (r - 14) * Math.sin(a * Math.PI / 180)];
  let cizgiler = "";
  for (let i = 0; i <= 10; i++) { const aa = bas - top * i / 10, c = Math.cos(aa * Math.PI / 180), s = Math.sin(aa * Math.PI / 180);
    cizgiler += `<line x1="${cx + (r + 7) * c}" y1="${cy - (r + 7) * s}" x2="${cx + (r + 12) * c}" y2="${cy - (r + 12) * s}" stroke="#555" stroke-width="2"/>`; }
  return `<svg viewBox="0 0 150 126" role="img" aria-label="Sürüş puanı ${puan}">
    ${yay(bas, bas - top * .5, "rgba(255,77,66,.35)", 9)}${yay(bas - top * .5, bas - top * .75, "rgba(255,198,26,.35)", 9)}${yay(bas - top * .75, bit, "rgba(53,208,127,.35)", 9)}
    ${yay(bas, a, RENK[seviye], 9)}${cizgiler}
    <line x1="${cx}" y1="${cy}" x2="${ix}" y2="${iy}" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="5" fill="#fff"/>
    <text x="${cx}" y="${cy + 30}" text-anchor="middle" font-family="Barlow Condensed" font-weight="800" font-size="34" fill="${RENK[seviye]}">${puan}</text>
    <text x="${cx}" y="${cy + 42}" text-anchor="middle" font-family="Inter" font-size="8.5" letter-spacing="1.5" fill="#9ca1aa">SÜRÜŞ PUANI</text></svg>`;
}
const IST = {
  yol: `<svg viewBox="0 0 24 24"><path d="M8 3L4 21M16 3l4 18M12 5v3M12 11v3M12 17v3" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`,
  saat: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 7v5l3 2" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`,
  soguk: `<svg viewBox="0 0 24 24"><path d="M12 3v18M4 7.5l16 9M4 16.5l16-9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  ruzgar: `<svg viewBox="0 0 24 24"><path d="M3 9h12a3 3 0 1 0-3-3M3 15h16a3 3 0 1 1-3 3" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`
};

// ------------------------------------------------------------------ yer arama (otomatik tamamlama)
// yer türü (öneri listesinde gösterilir)
const TUR = { restaurant: "Restoran", fast_food: "Lokanta", cafe: "Kafe", bakery: "Fırın", aerodrome: "Havalimanı", bus_station: "Otogar", fuel: "Benzinlik",
  hotel: "Otel", motel: "Motel", guest_house: "Pansiyon", camp_site: "Kamp alanı", city: "Şehir", town: "İlçe", village: "Köy", suburb: "Mahalle",
  neighbourhood: "Mahalle", hamlet: "Köy", peak: "Zirve", mountain_pass: "Geçit", viewpoint: "Seyir noktası", parking: "Otopark", hospital: "Hastane",
  motorcycle: "Motor servisi", car_repair: "Oto tamir", supermarket: "Market", attraction: "Gezilecek yer", ferry_terminal: "İskele", station: "İstasyon" };
function yerAdi(p) {
  const pr = p.properties;
  const ust = [pr.district, pr.county, pr.city, pr.state].filter((v, i, a) => v && v !== pr.name && a.indexOf(v) === i);
  return { ad: pr.name || ust[0] || "Yer", alt: [TUR[pr.osm_value], ...ust.slice(0, 2)].filter(Boolean).join(" · ") };
}
// motorcunun yazdığı günlük kelimeler → aranacak kelime
const ES = [[/\b(uçak|havaalanı|havaalani|hava alanı|havalimani)\b/gi, "havalimanı"], [/\botogar\b/gi, "otogar"], [/\bbenzinci\b/gi, "benzinlik"]];
const duzelt = q => ES.reduce((s, [r, y]) => s.replace(r, y), q);
// arama: Photon (yakına göre sıralı), sonuç yoksa Nominatim
async function yerAra(q, limit = 7, yakin = null) {
  q = duzelt(q);
  let u = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=${limit}&bbox=${TR_BBOX}`;
  if (yakin) u += `&lat=${yakin.lat}&lon=${yakin.lon}&location_bias_scale=0.4`;
  let f = [];
  try { f = ((await (await fetch(u)).json()).features || []).filter(x => x.properties.countrycode === "TR"); } catch { }
  if (!f.length) {
    try {
      const n = await (await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=tr&accept-language=tr&limit=${limit}&q=${encodeURIComponent(q)}`)).json();
      f = n.map(x => ({ geometry: { coordinates: [+x.lon, +x.lat] }, properties: { name: x.name || x.display_name.split(",")[0], osm_value: x.type, countrycode: "TR",
        city: x.display_name.split(",").slice(-4, -3)[0]?.trim(), district: x.display_name.split(",").slice(-5, -4)[0]?.trim() } }));
    } catch { }
  }
  return f;
}
const referans = alan => alan === "nereye" ? (secim.nereden || sonKonum) : sonKonum;
let sonKonum = null;
function aramaKur(alan) {
  const giris = $("#" + alan), liste = $("#oneri-" + alan);
  let zam, sira = -1, sonuclar = [];
  giris.addEventListener("input", () => {
    secim[alan] = null; clearTimeout(zam);
    const q = giris.value.trim(); if (q.length < 2) { liste.hidden = true; return; }
    zam = setTimeout(async () => {
      try {
        sonuclar = await yerAra(q, 7, referans(alan));
        if (giris.value.trim() !== q) return;   // bu arada yazmaya devam ettiyse eski sonucu gösterme
        liste.innerHTML = ""; sira = -1;
        sonuclar.forEach((f, i) => {
          const y = yerAdi(f), li = document.createElement("li");
          li.innerHTML = `<div></div><small></small>`; li.firstChild.textContent = y.ad; li.lastChild.textContent = y.alt;
          li.addEventListener("mousedown", ev => { ev.preventDefault(); sec(i); });
          liste.appendChild(li);
        });
        liste.hidden = sonuclar.length === 0;
      } catch { liste.hidden = true; }
    }, 280);
  });
  function sec(i) {
    const f = sonuclar[i]; if (!f) return;
    const y = yerAdi(f); giris.value = y.ad + (y.alt ? ", " + y.alt.split(", ")[0] : "");
    secim[alan] = { ad: y.ad, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] };
    liste.hidden = true;
  }
  giris.addEventListener("keydown", e => {
    if (liste.hidden) return;
    const li = [...liste.children];
    if (e.key === "ArrowDown") { sira = Math.min(li.length - 1, sira + 1); e.preventDefault(); }
    else if (e.key === "ArrowUp") { sira = Math.max(0, sira - 1); e.preventDefault(); }
    else if (e.key === "Enter" && sira >= 0) { sec(sira); e.preventDefault(); return; }
    else if (e.key === "Escape") { liste.hidden = true; return; }
    li.forEach((x, i) => x.classList.toggle("secili", i === sira));
  });
  giris.addEventListener("blur", () => setTimeout(() => liste.hidden = true, 150));
}

async function metindenYer(alan) {   // kullanıcı listeden seçmeden yazdıysa ilk sonucu al
  if (secim[alan]) return secim[alan];
  const q = $("#" + alan).value.trim();
  const f = (await yerAra(q, 3, referans(alan)))[0];
  if (!f) throw new Error(`"${q}" bulunamadı — listeden seç ya da haritada yere dokun`);
  const y = yerAdi(f);
  return secim[alan] = { ad: y.ad, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] };
}

// ------------------------------------------------------------------ rota + hava
async function rotaAl(a, b) {
  const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson&annotations=duration`);
  const j = await r.json();
  if (j.code !== "Ok" || !j.routes?.length) throw new Error("Rota bulunamadı");
  const ro = j.routes[0];
  return { koord: ro.geometry.coordinates, sureler: ro.legs.flatMap(l => l.annotation.duration), km: ro.distance / 1000, sn: ro.duration };
}

async function havaAl(nok) {
  const P = "temperature_2m,relative_humidity_2m,precipitation,precipitation_probability,snowfall,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,visibility,is_day";
  const parca = [];
  for (let i = 0; i < nok.length; i += 40) parca.push(nok.slice(i, i + 40));
  const sonuc = [];
  for (const p of parca) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${p.map(n => n.koord[1].toFixed(4)).join(",")}&longitude=${p.map(n => n.koord[0].toFixed(4)).join(",")}` +
      `&hourly=${P}&wind_speed_unit=kmh&timeformat=unixtime&timezone=Europe%2FIstanbul&forecast_days=4`;
    const r = await fetch(url); if (!r.ok) throw new Error("Hava verisi alınamadı");
    const j = await r.json(); sonuc.push(...(Array.isArray(j) ? j : [j]));
  }
  return sonuc;
}

const ortHiz = (rota, tempo) => rota.km / (rota.sn * tempo / 3600);

async function hesapla(e) {
  e?.preventDefault();
  const dur = $("#durum"), btn = $("#hesapla");
  dur.className = "durum"; btn.disabled = true;
  try {
    dur.textContent = "Yerler bulunuyor…";
    const a = await metindenYer("nereden"), b = await metindenYer("nereye");
    dur.textContent = "Rota çiziliyor…";
    const rota = await rotaAl(a, b);
    const tempo = +$("#tempo").value, mola = $("#mola").checked;
    const nok = Hava.noktalar(rota.koord, rota.sureler, tempo, mola);
    dur.textContent = `Rota ${Math.round(rota.km)} km · ${nok.length} noktada hava alınıyor…`;
    const havalar = await havaAl(nok);
    const cikis = Math.floor(new Date($("#cikis").value).getTime() / 1000);
    const hiz = Math.min(110, Math.max(40, ortHiz(rota, tempo) * 1.15));   // düzlükte seyir hızı (ortalamanın biraz üstü)
    const sonuc = Hava.rotaDegerlendir(nok, havalar, cikis, hiz);
    sonVeri = { a, b, rota, nok, havalar, cikis, hiz, sonuc, tempo, mola };
    goster(sonVeri);
    dur.textContent = "";
    try { localStorage.setItem("motohava-son", JSON.stringify({ a, b, tempo, mola })); } catch { }
    yerAdlari(sonuc);
  } catch (err) {
    dur.textContent = "Olmadı: " + err.message + ". İnternet bağlantını ve yer adlarını kontrol et.";
    dur.className = "durum hata";
  } finally { btn.disabled = false; }
}

// ------------------------------------------------------------------ gösterim
const saatYaz = sn => new Date(sn * 1000).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
const gunYaz = sn => new Date(sn * 1000).toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long" });
const sureYaz = sn => { const s = Math.floor(sn / 3600), d = Math.round(sn % 3600 / 60); return (s ? s + " sa " : "") + d + " dk"; };
const el = (etiket, sinif, yazi) => { const x = document.createElement(etiket); if (sinif) x.className = sinif; if (yazi != null) x.textContent = yazi; return x; };

function goster(v) {
  const o = Hava.ozet(v.sonuc);
  $("#sonuc").hidden = false; document.body.classList.add("sonuclu");
  const son = v.sonuc[v.sonuc.length - 1];
  $("#gosterge").innerHTML = gosterge(o.puan, o.seviye);
  const ust = $("#hukumUst"); ust.textContent = o.seviye === "yesil" ? "Yeşil ışık" : o.seviye === "sari" ? "Sarı alarm" : "Kırmızı alarm"; ust.style.color = RENK[o.seviye];
  $("#hukum").textContent = o.seviye === "yesil" ? "Yol senin, keyfini çıkar" : o.seviye === "sari" ? "Dikkatli sür" : "Zor yol, ertelemeyi düşün";
  // tahmin güveni: varış ne kadar ileride ise tahmin o kadar oynak (dağlık Karadeniz'de daha da)
  const ileri = (son.varis - Date.now() / 1000) / 3600;
  const guven = ileri <= 12 ? "yüksek" : ileri <= 36 ? "orta" : "düşük";
  $("#rotaBilgi").textContent = `${v.a.ad} → ${v.b.ad} · ${gunYaz(v.cikis)}, çıkış ${saatYaz(v.cikis)} · varış ${saatYaz(son.varis)} · tahmin güveni: ${guven}`;
  const ist = $("#istatistik"); ist.innerHTML = "";
  [[IST.yol, Math.round(v.rota.km), "km"], [IST.saat, sureYaz(son.sn).replace(" dk", "").replace(" sa ", ":").replace(/^(\d+)$/, "0:$1"), "süre"], [IST.soguk, Math.round(o.minHis) + "°", "kaskta en soğuk"], [IST.ruzgar, Math.round(o.maxAni), "en sert rüzgâr"]]
    .forEach(([s, d, a]) => { const k = el("div", "ist"); k.innerHTML = s; k.append(el("b", null, d), el("span", null, a)); ist.appendChild(k); });
  const uy = $("#uyarilar"); uy.innerHTML = "";
  const tum = new Map();
  v.sonuc.forEach(s => s.uy.forEach(u => { const k = u.yazi.replace(/[\d.,]+.*$/, "").trim(); if (!tum.has(k) || u.seviye === "kirmizi") tum.set(k, u); }));
  if (!tum.size) uy.appendChild(el("span", "etiket yesil", "Yol boyunca belirgin bir risk yok"));
  [...tum.values()].sort((x, y) => (y.seviye === "kirmizi") - (x.seviye === "kirmizi")).slice(0, 8).forEach(u => uy.appendChild(el("span", "etiket " + u.seviye, u.yazi)));

  // en iyi çıkış saati
  const en = Hava.enIyiCikis(v.nok, v.havalar, v.cikis, v.hiz, Date.now() / 1000);
  const kutu = $("#enIyi");
  if (en && en.d !== 0 && en.puan >= o.puan + 8) {
    kutu.hidden = false; kutu.innerHTML = "";
    kutu.appendChild(el("h3", null, "Daha iyi çıkış saati"));
    kutu.appendChild(el("div", "saat-buyuk", saatYaz(en.c)));
    kutu.appendChild(el("p", null, `Bu saatte çıkarsan sürüş puanın ${o.puan} → ${en.puan} olur (${en.d > 0 ? "+" : ""}${(en.d / 2).toString().replace(".", ",")} saat).`));
    const b = el("button", null, saatYaz(en.c) + " çıkışını göster");
    b.onclick = () => { $("#cikis").value = yerelZaman(en.c); v.cikis = en.c; v.sonuc = Hava.rotaDegerlendir(v.nok, v.havalar, en.c, v.hiz); goster(v); yerAdlari(v.sonuc); };
    kutu.appendChild(b);
  } else kutu.hidden = true;

  // ne giyeyim
  const g = $("#giyim"); g.innerHTML = "";
  g.appendChild(el("h3", null, "Ne giyeyim"));
  const gs = el("div", "giysi"); Hava.giyim(o).forEach(x => gs.appendChild(el("span", null, x))); g.appendChild(gs);

  profilCiz(v.sonuc);
  listeCiz(v.sonuc);
  cizHarita(v);
}

function listeCiz(sonuc) {
  const ol = $("#zaman"); ol.innerHTML = "";
  sonuc.forEach((s, x) => {
    const li = el("li", "nokta " + s.seviye); li.dataset.x = x;
    const sol = el("div"); sol.appendChild(el("div", "saat", saatYaz(s.varis))); sol.appendChild(el("div", "km", Math.round(s.km) + " km"));
    const ik = el("div", "ikon"); ik.innerHTML = ikon(s.kod, s.gunduz, s.ani); li.appendChild(sol); li.appendChild(ik);
    const orta = el("div"); const yer = el("div", "yer", s.ad || (x === 0 ? "Çıkış" : x === sonuc.length - 1 ? "Varış" : "…")); yer.dataset.yer = x; orta.appendChild(yer);
    orta.appendChild(el("div", "detay", `${s.durum} · rüzgâr ${Math.round(s.ruz)}–${Math.round(s.ani)} km/sa${s.yag >= 0.1 ? ` · ${s.yag.toFixed(1)} mm` : ""} · ${Math.round(s.rakim ?? 0)} m`));
    const sag = el("div"); sag.appendChild(el("div", "derece", Math.round(s.T) + "°")); sag.appendChild(el("div", "his", "kaskta " + Math.round(s.his) + "°"));
    li.append(orta, sag);
    if (s.uy.length) { const u = el("div", "uy"); s.uy.forEach(k => u.appendChild(el("span", "etiket " + k.seviye, k.yazi))); li.appendChild(u); }
    li.onclick = () => noktaPopup(x);
    ol.appendChild(li);
  });
}

function profilCiz(sonuc) {   // rakım profili, renkli bölümler
  const W = 600, H = 90, maxKm = sonuc[sonuc.length - 1].km || 1;
  const r = sonuc.map(s => s.rakim ?? 0), mn = Math.min(...r), mx = Math.max(...r, mn + 50);
  const X = km => km / maxKm * W, Y = h => H - 8 - (h - mn) / (mx - mn) * (H - 24);
  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Rakım profili">`;
  for (let i = 1; i < sonuc.length; i++) {
    const a = sonuc[i - 1], b = sonuc[i];
    svg += `<path d="M${X(a.km)},${H} L${X(a.km)},${Y(a.rakim)} L${X(b.km)},${Y(b.rakim)} L${X(b.km)},${H}Z" fill="${RENK[b.seviye]}" opacity=".85"/>`;
  }
  svg += `<text x="4" y="12" font-size="11" fill="currentColor" opacity=".7">${Math.round(mx)} m</text></svg>`;
  $("#profil").innerHTML = svg;
}

// ------------------------------------------------------------------ sürüş modu (canlı takip)
async function yolaCik() {
  const v = sonVeri; if (!v || surus) return;
  // rota boyunca birikimli mesafe ve süre (kilometre ve kalan süre için)
  const kum = [0], zam = [0];
  for (let i = 1; i < v.rota.koord.length; i++) { kum.push(kum[i - 1] + Hava.mesafe(v.rota.koord[i - 1], v.rota.koord[i])); zam.push(zam[i - 1] + (v.rota.sureler[i - 1] || 0) * v.tempo); }
  surus = { kum, zam, idx: 0, son: null, hizlar: [], havaZaman: Date.now(), wake: null, izle: null, sim: null };
  document.body.classList.add("surusta"); $("#hud").hidden = false;
  try { surus.wake = await navigator.wakeLock?.request("screen"); } catch { }   // sürüşte ekran kapanmasın
  const d = el("div", "ben"); surus.isaret = new maplibregl.Marker({ element: d }).setLngLat(v.rota.koord[0]).addTo(harita);
  harita.easeTo({ center: v.rota.koord[0], zoom: 11.5, duration: 800 });
  const sim = new URLSearchParams(location.search).get("sim");
  if (sim) {   // deneme: rotada sanal sürüş (gerçek zamandan "sim" kat hızlı)
    let m = 0; const k = +sim || 30;
    surus.sim = setInterval(() => { m += 80 / 3.6 * k; let i = kum.findIndex(x => x >= m); if (i < 0) i = kum.length - 1; konumGeldi(v.rota.koord[i][0], v.rota.koord[i][1], 80 / 3.6); }, 1000);
  } else if (navigator.geolocation) {
    $("#hudRisk").textContent = "GPS bekleniyor…";
    surus.izle = navigator.geolocation.watchPosition(p => konumGeldi(p.coords.longitude, p.coords.latitude, p.coords.speed),
      () => { $("#hudRisk").textContent = "Konum alınamadı — telefonun konum iznini aç."; }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 });
  }
}

function konumGeldi(lon, lat, hizMs) {
  const v = sonVeri, s = surus; if (!v || !s) return;
  const k = v.rota.koord, p = [lon, lat];
  // rotaya oturt: son bilinen noktanın çevresinde en yakın rota noktası
  let en = s.idx, enM = Infinity;
  for (let i = Math.max(0, s.idx - 60); i < Math.min(k.length, s.idx + 900); i++) { const m = Hava.mesafe(p, k[i]); if (m < enM) { enM = m; en = i; } }
  if (enM > 2000) for (let i = 0; i < k.length; i += 5) { const m = Hava.mesafe(p, k[i]); if (m < enM) { enM = m; en = i; } }   // çok uzaktaysa tüm rotada ara
  s.idx = en;
  // hız: GPS hızı, yoksa iki konum arası
  let kmh = hizMs != null && hizMs >= 0 ? hizMs * 3.6 : null;
  const simdi = Date.now();
  if (kmh == null && s.son) { const dt = (simdi - s.son.t) / 1000; if (dt > 0) kmh = Hava.mesafe(s.son.p, p) / dt * 3.6; }
  s.son = { p, t: simdi };
  s.hizlar.push(kmh || 0); if (s.hizlar.length > 4) s.hizlar.shift();
  const ortKmh = s.hizlar.reduce((a, b) => a + b, 0) / s.hizlar.length;
  s.isaret.setLngLat(p);
  harita.easeTo({ center: p, duration: 900 });

  const top = s.kum[k.length - 1], gidilen = s.kum[en], kalanM = top - gidilen;
  let kalanSn = s.zam[k.length - 1] - s.zam[en];
  if (v.mola) kalanSn += Math.floor(kalanSn / 7200) * 900;
  const simdiSn = simdi / 1000;
  $("#hudHiz").textContent = Math.round(ortKmh);
  $("#hudGidilen").textContent = (gidilen / 1000).toFixed(gidilen < 10000 ? 1 : 0) + " km gidildi";
  $("#hudKalan").textContent = "kalan " + Math.round(kalanM / 1000) + " km";
  $("#hudBar").style.width = Math.min(100, gidilen / top * 100) + "%";
  $("#hudVaris").textContent = "varış " + saatYaz(simdiSn + kalanSn);

  // öndeki hava: şu anki konum ve saate göre yeniden hesapla
  const curSn = v.nok.length ? (s.zam[en] + (v.mola ? Math.floor(s.zam[en] / 7200) * 900 : 0)) : 0;
  const yeni = Hava.rotaDegerlendir(v.nok, v.havalar, simdiSn - curSn, v.hiz);
  yeni.forEach((n, x) => n.ad = v.sonuc[x]?.ad);
  const yakin = yeni.reduce((a, n) => Math.abs(n.i - en) < Math.abs(a.i - en) ? n : a, yeni[0]);
  $("#hudHava").textContent = `${Math.round(yakin.T)}° · kaskta ${Math.round(yakin.his)}° · ${yakin.durum}`;
  const ondeki = yeni.filter(n => n.i > en);
  const risk = ondeki.find(n => n.seviye !== "yesil");
  const kutu = $("#hudRisk"); kutu.innerHTML = "";
  const nok = el("span", "nok"); kutu.appendChild(nok);
  if (enM > 300) { kutu.className = "hud-risk kirmizi"; nok.style.background = RENK.kirmizi; kutu.append("Rotadan çıktın (" + Math.round(enM) + " m). Yeni rota için bitirip tekrar hesapla."); }
  else if (risk) {
    kutu.className = "hud-risk " + risk.seviye; nok.style.background = RENK[risk.seviye];
    const uzak = Math.max(0, (s.kum[risk.i] - gidilen) / 1000);
    kutu.append(`${Math.round(uzak)} km sonra · ${risk.ad || Math.round(risk.km) + ". km"} · ${saatYaz(risk.varis)} · ${risk.uy[0]?.yazi || risk.durum}`);
  } else { kutu.className = "hud-risk yesil"; nok.style.background = RENK.yesil; kutu.append(ondeki.length ? "Önündeki yol temiz görünüyor" : "Vardın, iyi yolculuklar!"); }
  // rota renkleri her 2 dakikada bir güncellensin; hava her 30 dakikada bir yeniden çekilsin
  if (!s.renkZaman || simdi - s.renkZaman > 120000) { s.renkZaman = simdi; v.sonuc = yeni; cizHarita(v, false); }
  if (simdi - s.havaZaman > 30 * 60000) { s.havaZaman = simdi; havaAl(v.nok).then(h => { v.havalar = h; v.alinma = Date.now(); }).catch(() => { }); }
  if (!ondeki.length && kalanM < 150) { /* varış */ }
}

function surusBitir() {
  const s = surus; if (!s) return;
  if (s.izle != null) navigator.geolocation.clearWatch(s.izle);
  if (s.sim) clearInterval(s.sim);
  try { s.wake?.release(); } catch { }
  s.isaret?.remove(); surus = null;
  document.body.classList.remove("surusta"); $("#hud").hidden = true;
  if (sonVeri) { sonVeri.sonuc = Hava.rotaDegerlendir(sonVeri.nok, sonVeri.havalar, sonVeri.cikis, sonVeri.hiz); cizHarita(sonVeri); }
}
document.addEventListener("visibilitychange", async () => { if (surus && document.visibilityState === "visible") try { surus.wake = await navigator.wakeLock?.request("screen"); } catch { } });

function cizHarita(v, sigdir = true) {
  if (!harita || !harita.getSource("rota")) return;
  const f = [];
  for (let x = 1; x < v.sonuc.length; x++) {
    const a = v.sonuc[x - 1].i, b = v.sonuc[x].i;
    f.push({ type: "Feature", properties: { renk: RENK[v.sonuc[x].seviye] }, geometry: { type: "LineString", coordinates: v.rota.koord.slice(a, b + 1) } });
  }
  harita.getSource("rota").setData({ type: "FeatureCollection", features: f });
  harita.getSource("nokta").setData({ type: "FeatureCollection", features: v.sonuc.map((s, x) => ({ type: "Feature", properties: { x, renk: RENK[s.seviye] }, geometry: { type: "Point", coordinates: s.koord } })) });
  if (!sigdir) return;
  isaretler.forEach(m => m.remove());
  isaretler = [[v.rota.koord[0], RENK.yesil], [v.rota.koord[v.rota.koord.length - 1], RENK.kirmizi]].map(([c, renk]) => {
    const d = el("div", "isaret"); d.style.background = renk; return new maplibregl.Marker({ element: d }).setLngLat(c).addTo(harita);
  });
  const b = new maplibregl.LngLatBounds(); v.rota.koord.forEach(c => b.extend(c));
  const telefon = innerWidth <= 760;
  harita.fitBounds(b, { padding: telefon ? { top: 30, bottom: innerHeight * 0.66, left: 30, right: 30 } : { top: 60, bottom: 60, left: 480, right: 60 }, duration: 700 });
}

function noktaPopup(x) {
  const s = sonVeri?.sonuc[x]; if (!s || !harita) return;
  const d = el("div"); d.appendChild(el("b", null, `${saatYaz(s.varis)} · ${s.ad || Math.round(s.km) + ". km"}`));
  d.appendChild(el("div", null, `${s.durum}, ${Math.round(s.T)}° (hissedilen ${Math.round(s.his)}°)`));
  d.appendChild(el("div", null, `Rüzgâr ${Math.round(s.ruz)}, ani ${Math.round(s.ani)} km/sa · yağış ${s.yag.toFixed(1)} mm`));
  new maplibregl.Popup({ offset: 10 }).setLngLat(s.koord).setDOMContent(d).addTo(harita);
  harita.easeTo({ center: s.koord, duration: 400 });
}

// noktalara yer adı (en fazla 1 istek/0,4 sn; önce çıkış, varış ve riskli noktalar)
async function yerAdlari(sonuc) {
  const sira = sonuc.map((s, x) => x).sort((p, q) => (p === 0 || p === sonuc.length - 1 ? -1 : 0) - (q === 0 || q === sonuc.length - 1 ? -1 : 0) || sonuc[p].puan - sonuc[q].puan);
  for (const x of sira) {
    const s = sonuc[x]; if (s.ad) continue;
    try {
      const r = await fetch(`https://photon.komoot.io/reverse?lon=${s.koord[0]}&lat=${s.koord[1]}&limit=1`);
      const p = (await r.json()).features?.[0]?.properties;
      if (p) { s.ad = [p.name && p.name.length < 30 ? p.name : null, p.district || p.city || p.county].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ");
        const e = document.querySelector(`[data-yer="${x}"]`); if (e && s.ad) e.textContent = s.ad; }
    } catch { }
    await new Promise(r => setTimeout(r, 400));
    if (sonVeri?.sonuc !== sonuc) return;   // yeni hesap başladıysa dur
  }
}

// ------------------------------------------------------------------ başlangıç
function yerelZaman(sn) { const d = new Date(sn * 1000); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); }

function basla() {
  const s = new Date(); s.setMinutes(Math.ceil(s.getMinutes() / 15) * 15, 0, 0);
  $("#cikis").value = yerelZaman(s.getTime() / 1000);
  aramaKur("nereden"); aramaKur("nereye");
  $("#form").addEventListener("submit", hesapla);
  $("#yolaCik").onclick = yolaCik; $("#hudDur").onclick = surusBitir;
  document.querySelectorAll("#ornekler button").forEach(b => b.onclick = () => {
    secim.nereden = secim.nereye = null; $("#nereden").value = b.dataset.a; $("#nereye").value = b.dataset.b; hesapla();
  });
  $("#konumum").onclick = () => {
    if (!navigator.geolocation) return;
    $("#durum").textContent = "Konum alınıyor…";
    navigator.geolocation.getCurrentPosition(async p => {
      secim.nereden = { ad: "Konumum", lon: p.coords.longitude, lat: p.coords.latitude };
      sonKonum = { lon: p.coords.longitude, lat: p.coords.latitude };
      $("#nereden").value = "Konumum"; $("#durum").textContent = "";
    }, () => { $("#durum").textContent = "Konum izni verilmedi; yer adını yaz."; });
  };
  try {
    const son = JSON.parse(localStorage.getItem("motohava-son") || "null");
    if (son) { secim.nereden = son.a; secim.nereye = son.b; $("#nereden").value = son.a.ad; $("#nereye").value = son.b.ad; $("#tempo").value = son.tempo; $("#mola").checked = son.mola; }
  } catch { }
  try { haritaKur(); } catch (e) { console.warn("harita açılamadı", e); }
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => { });
}
basla();
