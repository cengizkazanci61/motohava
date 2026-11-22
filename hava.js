// MotoHava — motorcu hesapları (arayüzden bağımsız)
// Her rota noktası için: o noktaya varış saatindeki hava → motorcuya göre puan, uyarılar, hissedilen sıcaklık, yan rüzgâr.
"use strict";

const Hava = (() => {
  const R = 6371000;
  const rad = d => d * Math.PI / 180;

  function mesafe(a, b) {   // [lon, lat] → metre
    const dLa = rad(b[1] - a[1]), dLo = rad(b[0] - a[0]);
    const s = Math.sin(dLa / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  function yon(a, b) {      // a'dan b'ye gidiş yönü (derece, kuzey = 0)
    const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
    const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  // Rüzgârda hissedilen sıcaklık: motorun hızı + karşıdan esen rüzgâr (Kanada/ABD rüzgâr soğuğu formülü, ≤10 °C'de geçerli)
  function hissedilen(t, surusKmh, karsiRuzgarKmh) {
    const v = Math.max(5, surusKmh + Math.max(0, karsiRuzgarKmh));
    if (t > 10) return t - Math.min(4, v / 40);            // ılıkta hafif serinleme
    return 13.12 + 0.6215 * t - 11.37 * Math.pow(v, 0.16) + 0.3965 * t * Math.pow(v, 0.16);
  }

  const KOD = { 0: "Açık", 1: "Az bulutlu", 2: "Parçalı bulutlu", 3: "Kapalı", 45: "Sis", 48: "Kırağılı sis",
    51: "Hafif çisenti", 53: "Çisenti", 55: "Yoğun çisenti", 56: "Donan çisenti", 57: "Donan çisenti",
    61: "Hafif yağmur", 63: "Yağmur", 65: "Kuvvetli yağmur", 66: "Donan yağmur", 67: "Donan yağmur",
    71: "Hafif kar", 73: "Kar", 75: "Yoğun kar", 77: "Kar taneleri", 80: "Sağanak", 81: "Sağanak", 82: "Şiddetli sağanak",
    85: "Kar sağanağı", 86: "Kar sağanağı", 95: "Gök gürültülü fırtına", 96: "Dolu ile fırtına", 99: "Dolu ile fırtına" };
  const kodYazi = k => KOD[k] ?? "—";

  // saatlik dizide verilen zamana (unix sn) doğrusal ara değer
  function araDeger(saatler, dizi, t) {
    if (!dizi) return null;
    let i = saatler.findIndex(s => s > t);
    if (i <= 0) return dizi[Math.max(0, i === -1 ? dizi.length - 1 : 0)];
    const f = (t - saatler[i - 1]) / (saatler[i] - saatler[i - 1]);
    const a = dizi[i - 1], b = dizi[i];
    if (a == null || b == null) return a ?? b;
    return a + (b - a) * f;
  }
  const enYakin = (saatler, dizi, t) => {
    let en = 0; for (let i = 1; i < saatler.length; i++) if (Math.abs(saatler[i] - t) < Math.abs(saatler[en] - t)) en = i;
    return dizi ? dizi[en] : null;
  };

  // bir nokta + varış zamanı → durum, puan, uyarılar
  function degerlendir(h, t, yolYonu, surusKmh) {
    const s = h.hourly.time;
    const T = araDeger(s, h.hourly.temperature_2m, t);
    const yag = Math.max(0, araDeger(s, h.hourly.precipitation, t) || 0);
    const kar = Math.max(0, araDeger(s, h.hourly.snowfall, t) || 0);
    const olas = araDeger(s, h.hourly.precipitation_probability, t) ?? 0;
    const ruz = araDeger(s, h.hourly.wind_speed_10m, t) || 0;
    const ani = araDeger(s, h.hourly.wind_gusts_10m, t) || ruz;
    const ruzYon = enYakin(s, h.hourly.wind_direction_10m, t) ?? 0;     // rüzgârın geldiği yön
    const gor = araDeger(s, h.hourly.visibility, t);
    const nem = araDeger(s, h.hourly.relative_humidity_2m, t) ?? 60;
    const kod = enYakin(s, h.hourly.weather_code, t);
    const gunduz = enYakin(s, h.hourly.is_day, t) === 1;

    // rüzgârın yola göre bileşenleri: karşıdan (+) ve yandan
    const aci = rad(((ruzYon - yolYonu) % 360 + 540) % 360 - 180);   // 0 = tam karşıdan
    const karsi = ruz * Math.cos(aci), yan = Math.abs(ani * Math.sin(aci));
    const his = hissedilen(T, surusKmh, karsi);

    let puan = 100; const uy = [];
    const ekle = (ceza, seviye, yazi) => { puan -= ceza; uy.push({ seviye, yazi }); };
    if (kar > 0.05 || [71, 73, 75, 77, 85, 86].includes(kod)) ekle(60, "kirmizi", "Kar");
    else if ([66, 67, 56, 57].includes(kod)) ekle(60, "kirmizi", "Donan yağmur");
    else if (yag >= 2) ekle(Math.min(45, 18 + yag * 6), "kirmizi", `Yağmur ${yag.toFixed(1)} mm/sa`);
    else if (yag >= 0.2) ekle(10 + yag * 8, "sari", `Yağmur ${yag.toFixed(1)} mm/sa`);
    else if (olas >= 55) ekle(7, "sari", `Yağmur ihtimali %${Math.round(olas)}`);
    if ([95, 96, 99].includes(kod)) ekle(35, "kirmizi", "Fırtına / yıldırım");
    if (T <= 0.5) ekle(40, "kirmizi", "Buzlanma: sıcaklık 0°");
    else if (T <= 3 && (nem > 85 || yag > 0)) ekle(25, "kirmizi", "Buzlanma riski");
    else if (T < 6) ekle(10, "sari", "Soğuk yol (lastik tutuşu düşük)");
    if (T >= 35) ekle(15, "sari", "Aşırı sıcak");
    if (ani >= 70) ekle(40, "kirmizi", `Fırtına rüzgârı ${Math.round(ani)} km/sa`);
    else if (ani >= 50) ekle(22, "kirmizi", `Sert ani rüzgâr ${Math.round(ani)} km/sa`);
    else if (ani >= 35) ekle(9, "sari", `Ani rüzgâr ${Math.round(ani)} km/sa`);
    if (yan >= 40) ekle(12, ani >= 50 ? "kirmizi" : "sari", `Yan rüzgâr ${Math.round(yan)} km/sa`);
    if (gor != null && gor < 300) ekle(35, "kirmizi", "Çok yoğun sis");
    else if (gor != null && gor < 1000) ekle(18, "sari", `Sis (görüş ${Math.round(gor)} m)`);
    else if (gor != null && gor < 3000) ekle(5, "sari", "Görüş azalmış");
    if (!gunduz) ekle(5, "sari", "Karanlık");
    puan = Math.max(0, Math.min(100, Math.round(puan)));
    const seviye = puan >= 75 ? "yesil" : puan >= 50 ? "sari" : "kirmizi";
    return { T, his, yag, kar, olas, ruz, ani, ruzYon, yan, karsi, gor, nem, kod, gunduz, puan, seviye, uy, durum: kodYazi(kod) };
  }

  // rota boyunca nokta seç (her ~adim metrede bir) + her noktaya varış süresi (OSRM süreleri × tempo + mola)
  function noktalar(koord, sureler, tempo, mola) {
    const top = [0]; const zam = [0];
    for (let i = 1; i < koord.length; i++) { top.push(top[i - 1] + mesafe(koord[i - 1], koord[i])); zam.push(zam[i - 1] + (sureler[i - 1] || 0) * tempo); }
    const L = top[top.length - 1];
    const adim = Math.max(8000, Math.min(20000, L / 36));
    const sec = [0];
    for (let i = 1; i < koord.length; i++) if (top[i] - top[sec[sec.length - 1]] >= adim) sec.push(i);
    if (sec[sec.length - 1] !== koord.length - 1) sec.push(koord.length - 1);
    return sec.map(i => {
      let sn = zam[i];
      if (mola) sn += Math.floor(sn / 7200) * 900;   // her 2 saat sürüşte 15 dk
      const j = Math.min(koord.length - 1, i + 4), k = Math.max(0, i - 4);
      return { i, km: top[i] / 1000, sn, koord: koord[i], yon: yon(koord[k], koord[j]) };
    });
  }

  function rotaDegerlendir(nok, havalar, cikisSn, surusKmh) {
    return nok.map((n, x) => ({ ...n, varis: cikisSn + n.sn, rakim: havalar[x].elevation, ...degerlendir(havalar[x], cikisSn + n.sn, n.yon, surusKmh) }));
  }

  function ozet(sonuc) {
    const ort = Math.round(sonuc.reduce((a, s) => a + s.puan, 0) / sonuc.length);
    const enKotu = Math.min(...sonuc.map(s => s.puan));
    const puan = Math.round(ort * 0.6 + enKotu * 0.4);   // en kötü bölüm de önemli
    return { puan, ort, enKotu, seviye: puan >= 75 ? "yesil" : puan >= 50 ? "sari" : "kirmizi",
      minHis: Math.min(...sonuc.map(s => s.his)), minT: Math.min(...sonuc.map(s => s.T)), maxT: Math.max(...sonuc.map(s => s.T)),
      maxAni: Math.max(...sonuc.map(s => s.ani)), yagisli: sonuc.filter(s => s.yag >= 0.2 || s.kar > 0.05).length,
      maxRakim: Math.max(...sonuc.map(s => s.rakim ?? 0)), gece: sonuc.some(s => !s.gunduz) };
  }

  // farklı çıkış saatlerini dene (−2 … +8 saat, yarım saat arayla), en iyisini bul
  function enIyiCikis(nok, havalar, cikisSn, surusKmh, simdi) {
    let en = null;
    for (let d = -4; d <= 16; d++) {
      const c = cikisSn + d * 1800;
      if (c < simdi - 600) continue;
      const sonVaris = c + nok[nok.length - 1].sn;
      if (sonVaris > havalar[0].hourly.time[havalar[0].hourly.time.length - 1]) break;
      const o = ozet(rotaDegerlendir(nok, havalar, c, surusKmh));
      if (!en || o.puan > en.puan) en = { c, puan: o.puan, d };
    }
    return en;
  }

  function giyim(o) {
    const l = [];
    if (o.minHis < 3) l.push("Kışlık mont", "Termal içlik", "Kışlık eldiven", "Boyunluk", "Isıtmalı yelek varsa tak");
    else if (o.minHis < 10) l.push("Ara mevsim mont + astarı", "Termal içlik", "Kalın eldiven", "Boyunluk");
    else if (o.minHis < 18) l.push("Korumalı mont", "Ara mevsim eldiven");
    else if (o.maxT < 30) l.push("Fileli / yazlık mont", "Yazlık eldiven");
    else l.push("Fileli mont", "Yazlık eldiven", "Bol su, sık mola");
    if (o.yagisli) l.push("Yağmurluk takımı", "Su geçirmez bot / galoş", "Buğu önleyici vizör");
    if (o.gece) l.push("Şeffaf vizör", "Reflektörlü yelek");
    if (o.maxAni >= 50) l.push("Rüzgârda sıkı tutuş — çanta/yükü sabitle");
    return l;
  }

  return { mesafe, noktalar, rotaDegerlendir, ozet, enIyiCikis, giyim, kodYazi };
})();
