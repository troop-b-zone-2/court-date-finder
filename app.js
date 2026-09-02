/* Court Date Finder – Troop B multi-county */
(function () {
  "use strict";
  let DATA = null;
  let FEDERAL = new Set();
  let CUSTOM = []; // {court, date, reason}
  let currentCopyText = "";
  let minDays = 30;

  const WEEKDAY_MAP = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  const ORDINAL_MAP = { "1st": 1, "2nd": 2, "3rd": 3, "4th": 4, "5th": 5, "first": 1, "second": 2, "third": 3, "fourth": 4 };

  const areaSelect = document.getElementById("stationSelect");
  const courtSelect = document.getElementById("courtSelect");
  const resultCard = document.getElementById("resultCard");
  const copyBtn = document.getElementById("copyBtn");
  const copyLabel = document.getElementById("copyLabel");
  const todayLabel = document.getElementById("todayLabel");
  const footerMeta = document.getElementById("footerMeta");
  const minDaysInput = document.getElementById("minDaysInput");

  // St. Lawrence County, NY approximate geographic center.
  // Solar calculations are performed locally so the feature does not depend on an API key.
  const LIGHTING_LOCATION = {
    latitude: 44.50,
    longitude: -75.00,
    timeZone: "America/New_York"
  };
  const LEGAL_LIGHTING_MINUTES = 30;
  const SAFETY_BUFFER_MINUTES = 2;
  const OPERATIONAL_LIGHTING_MINUTES = LEGAL_LIGHTING_MINUTES + SAFETY_BUFFER_MINUTES;

  const lightingStatus = document.getElementById("lightingStatus");
  const nextSunset = document.getElementById("nextSunset");
  const nextSunrise = document.getElementById("nextSunrise");
  const sunsetCutoff = document.getElementById("sunsetCutoff");
  const sunriseCutoff = document.getElementById("sunriseCutoff");
  const lightingUpdated = document.getElementById("lightingUpdated");

  function solarPosition(date) {
    // NOAA solar-position approximation; returns solar altitude in degrees.
    const start = Date.UTC(date.getUTCFullYear(), 0, 0);
    const dayOfYear = Math.floor((date.getTime() - start) / 86400000);
    const hourUTC = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
    const gamma = 2 * Math.PI / 365 * (dayOfYear - 1 + (hourUTC - 12) / 24);

    const eqTime = 229.18 * (
      0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma)
    );

    const decl = (
      0.006918 -
      0.399912 * Math.cos(gamma) +
      0.070257 * Math.sin(gamma) -
      0.006758 * Math.cos(2 * gamma) +
      0.000907 * Math.sin(2 * gamma) -
      0.002697 * Math.cos(3 * gamma) +
      0.00148 * Math.sin(3 * gamma)
    );

    const minutesUTC = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
    const trueSolarMinutes = ((minutesUTC + eqTime + 4 * LIGHTING_LOCATION.longitude) % 1440 + 1440) % 1440;
    let hourAngle = trueSolarMinutes / 4 - 180;
    if (hourAngle < -180) hourAngle += 360;

    const lat = LIGHTING_LOCATION.latitude * Math.PI / 180;
    const ha = hourAngle * Math.PI / 180;
    const cosZenith = Math.sin(lat) * Math.sin(decl) +
      Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
    const zenith = Math.acos(Math.max(-1, Math.min(1, cosZenith)));
    return 90 - zenith * 180 / Math.PI;
  }

  function refineSolarCrossing(a, b, rising) {
    const target = -0.833; // Atmospheric refraction + solar-disk correction.
    for (let i = 0; i < 20; i++) {
      const mid = new Date((a.getTime() + b.getTime()) / 2);
      const fa = solarPosition(a) - target;
      const fm = solarPosition(mid) - target;
      if (rising ? fa <= 0 && fm > 0 : fa > 0 && fm <= 0) b = mid;
      else a = mid;
    }
    return new Date((a.getTime() + b.getTime()) / 2);
  }

  function findSolarEvents(now) {
    const start = new Date(now.getTime() - 36 * 3600000);
    const end = new Date(now.getTime() + 36 * 3600000);
    const step = 5 * 60000;
    let previous = new Date(start);
    let previousAltitude = solarPosition(previous);
    const sunrises = [];
    const sunsets = [];

    for (let t = start.getTime() + step; t <= end.getTime(); t += step) {
      const current = new Date(t);
      const altitude = solarPosition(current);

      if (previousAltitude <= -0.833 && altitude > -0.833) {
        sunrises.push(refineSolarCrossing(previous, current, true));
      }
      if (previousAltitude > -0.833 && altitude <= -0.833) {
        sunsets.push(refineSolarCrossing(previous, current, false));
      }

      previous = current;
      previousAltitude = altitude;
    }

    const futureSunrises = sunrises.filter(d => d > now).sort((a, b) => a - b);
    const futureSunsets = sunsets.filter(d => d > now).sort((a, b) => a - b);
    const previousSunrises = sunrises.filter(d => d <= now).sort((a, b) => b - a);
    const previousSunsets = sunsets.filter(d => d <= now).sort((a, b) => b - a);

    return {
      sunrise: futureSunrises[0] || null,
      sunset: futureSunsets[0] || null,
      previousSunrise: previousSunrises[0] || null,
      previousSunset: previousSunsets[0] || null
    };
  }

  function formatEasternTime(date) {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: LIGHTING_LOCATION.timeZone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    }).format(date);
  }

  function formatEasternDateTime(date) {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: LIGHTING_LOCATION.timeZone,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    }).format(date);
  }

  function formatOffsetTime(date, minutes) {
    return formatEasternTime(new Date(date.getTime() + minutes * 60000));
  }

  function updateLightingReference() {
    if (!lightingStatus) return;

    const now = new Date();
    const events = findSolarEvents(now);
    if (!events.sunrise || !events.sunset) {
      lightingStatus.textContent = "LIGHTING: UNAVAILABLE";
      return;
    }

    // Legal nighttime period is 30 minutes after sunset through 30 minutes
    // before sunrise. The display adds a 2-minute safety buffer on each side.
    const operationalNightStart = new Date(
      events.sunset.getTime() + OPERATIONAL_LIGHTING_MINUTES * 60000
    );
    const operationalNightEnd = new Date(
      events.sunrise.getTime() - OPERATIONAL_LIGHTING_MINUTES * 60000
    );

    const currentOperationalNight =
      (events.previousSunset &&
        now >= new Date(events.previousSunset.getTime() + OPERATIONAL_LIGHTING_MINUTES * 60000)) ||
      (events.previousSunrise && now < new Date(events.previousSunrise.getTime() - OPERATIONAL_LIGHTING_MINUTES * 60000));

    nextSunset.textContent = formatEasternTime(events.sunset);
    nextSunrise.textContent = formatEasternTime(events.sunrise);

    if (currentOperationalNight) {
      lightingStatus.textContent = "LIGHTING: SAFE TO WRITE TICKETS";
      lightingStatus.className = "lighting-status night";
    } else {
      lightingStatus.textContent = "LIGHTING: DAYTIME";
      lightingStatus.className = "lighting-status day";
    }
  }

  function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function formatDate(d) { return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }); }
  function formatMMDDYYYY(d) {
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return mm + "/" + dd + "/" + d.getFullYear();
  }
  function formatShort(d) { return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  function ymd(d) {
    return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
  }

  function isExcluded(dateObj, courtName) {
    const key = ymd(dateObj);
    if (FEDERAL.has(key)) return true;
    for (const ex of CUSTOM) {
      if (ex.date === key && (ex.court === "*" || ex.court === courtName)) return true;
    }
    return false;
  }

  function parseWhen(whenStr) {
    const s = whenStr.toLowerCase().trim();
    let weekday = null;
    for (const [name, num] of Object.entries(WEEKDAY_MAP)) {
      if (s.includes(name)) { weekday = num; break; }
    }
    if (weekday === null && s.includes("monday") && s.includes("thursday")) {
      return { type: "weekdays", weekdays: [1, 2, 3, 4] };
    }
    if (weekday === null) return null;
    if (s.includes("every") || s.includes("each")) return { type: "weekly", weekday };
    if (s.includes("alternate")) return { type: "alternate", weekday };
    if (s.includes("first four")) return { type: "nth", weekday, ordinals: [1, 2, 3, 4] };
    const ordinals = [];
    for (const [word, num] of Object.entries(ORDINAL_MAP)) {
      if (s.includes(word)) ordinals.push(num);
    }
    const uniq = [...new Set(ordinals)].sort((a, b) => a - b);
    if (uniq.length === 0) return { type: "weekly", weekday };
    return { type: "nth", weekday, ordinals: uniq };
  }

  function getNthWeekday(year, month, weekday, ordinal) {
    const first = new Date(year, month, 1);
    const firstWeekday = first.getDay();
    let day = 1 + ((weekday - firstWeekday + 7) % 7);
    day += (ordinal - 1) * 7;
    const result = new Date(year, month, day);
    if (result.getMonth() !== month) return null;
    return result;
  }

  function candidatesFromMeet(meet, fromDate, monthsAhead) {
    monthsAhead = monthsAhead || 14;
    const rule = parseWhen(meet.when);
    if (!rule) return [];
    const candidates = [];
    let year = fromDate.getFullYear();
    let month = fromDate.getMonth();
    for (let m = 0; m < monthsAhead; m++) {
      const y = year + Math.floor((month + m) / 12);
      const mo = (month + m) % 12;
      if (rule.type === "nth") {
        for (const ord of rule.ordinals) {
          const d = getNthWeekday(y, mo, rule.weekday, ord);
          if (d) candidates.push({ date: d, time: meet.time });
        }
      } else if (rule.type === "weekly") {
        const first = getNthWeekday(y, mo, rule.weekday, 1);
        if (first) {
          let d = new Date(first);
          while (d.getMonth() === mo) {
            candidates.push({ date: new Date(d), time: meet.time });
            d.setDate(d.getDate() + 7);
          }
        }
      } else if (rule.type === "alternate") {
        const first = getNthWeekday(y, mo, rule.weekday, 1);
        if (first) {
          let d = new Date(first);
          let toggle = true;
          while (d.getMonth() === mo) {
            if (toggle) candidates.push({ date: new Date(d), time: meet.time });
            toggle = !toggle;
            d.setDate(d.getDate() + 7);
          }
        }
      } else if (rule.type === "weekdays") {
        for (const wd of rule.weekdays) {
          const first = getNthWeekday(y, mo, wd, 1);
          if (first) {
            let d = new Date(first);
            while (d.getMonth() === mo) {
              candidates.push({ date: new Date(d), time: meet.time });
              d.setDate(d.getDate() + 7);
            }
          }
        }
      }
    }
    return candidates;
  }

  function findNextCourtDate(court) {
    const today = startOfDay(new Date());
    const minDate = addDays(today, minDays);
    let all = [];
    for (const meet of court.meets || []) {
      all = all.concat(candidatesFromMeet(meet, today));
    }
    all.sort(function (a, b) { return a.date - b.date; });
    for (const item of all) {
      if (item.date >= minDate && !isExcluded(item.date, court.name)) {
        return {
          date: item.date, time: item.time, name: court.name, minDate: minDate,
          daysFromToday: Math.round((item.date - today) / 86400000),
          meets: court.meets || [], notes: court.notes || null
        };
      }
    }
    return null;
  }

  function areasList() { return DATA.areas || DATA.stations || []; }

  function populateAreas() {
    areaSelect.innerHTML = '<option value="">— Choose area / county —</option>';
    areasList().forEach(function (a, i) {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = a.name;
      areaSelect.appendChild(opt);
    });
  }

  function populateCourts(areaIndex) {
    courtSelect.innerHTML = "";
    resultCard.classList.remove("show");
    if (areaIndex === "" || areaIndex === null) {
      courtSelect.disabled = true;
      courtSelect.innerHTML = '<option value="">— Select an area first —</option>';
      return;
    }
    const area = areasList()[areaIndex];
    courtSelect.disabled = false;
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "— Choose a court —";
    courtSelect.appendChild(placeholder);
    (area.courts || []).forEach(function (c, i) {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = c.name;
      courtSelect.appendChild(opt);
    });
  }

  function showResult(court, area) {
    const result = findNextCourtDate(court);
    if (!result) {
      resultCard.classList.remove("show");
      document.getElementById("errorBox").style.display = "block";
      document.getElementById("errorBox").textContent =
        "Could not find a date ≥ " + minDays + " days out (exclusions or schedule).";
      return;
    }
    document.getElementById("errorBox").style.display = "none";
    document.getElementById("resultDate").textContent = formatDate(result.date);
    document.getElementById("resultTime").textContent = result.time;
    document.getElementById("resultCourt").textContent = result.name;
    document.getElementById("resultMinDate").textContent = formatShort(result.minDate);
    document.getElementById("resultDays").textContent = result.daysFromToday + " days";
    const rulesBox = document.getElementById("scheduleRules");
    let html = '<div class="label">Court Schedule</div>';
    for (const m of result.meets) {
      html += '<div class="rule">' + m.when + " @ " + m.time + "</div>";
    }
    if (result.notes) {
      html += '<div class="label" style="margin-top:6px">Notes</div>';
      html += '<div class="rule notes">' + result.notes + "</div>";
    }
    if (area && area.dataDate) {
      html += '<div class="label" style="margin-top:6px">Data source date</div>';
      html += '<div class="rule notes">' + area.dataDate + "</div>";
    }
    if (area && area.source) {
      html += '<div class="rule notes">' + area.source + "</div>";
    }
    rulesBox.innerHTML = html;
    currentCopyText = formatMMDDYYYY(result.date) + " " + result.time;
    autoCopy(currentCopyText);
    resultCard.classList.add("show");
  }

  async function autoCopy(text) {
    try {
      await navigator.clipboard.writeText(text);
      copyLabel.textContent = "Copied!";
      copyBtn.classList.add("copied");
      setTimeout(function () { copyLabel.textContent = "Copy Date & Time"; copyBtn.classList.remove("copied"); }, 1800);
    } catch (e) {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        copyLabel.textContent = "Copied!";
        copyBtn.classList.add("copied");
        setTimeout(function () { copyLabel.textContent = "Copy Date & Time"; copyBtn.classList.remove("copied"); }, 1800);
      } catch (e2) {}
    }
  }

  function handleCourtSelection() {
    const si = areaSelect.value;
    const ci = courtSelect.value;
    if (si === "" || ci === "") { resultCard.classList.remove("show"); return; }
    const area = areasList()[si];
    const court = area.courts[ci];
    if (court) showResult(court, area);
  }

  function readMinDays() {
    let v = parseInt(minDaysInput && minDaysInput.value, 10);
    if (isNaN(v) || v < 0) v = 0;
    if (v > 365) v = 365;
    minDays = v;
    if (minDaysInput) minDaysInput.value = String(v);
    // refresh result if court selected
    handleCourtSelection();
  }

  areaSelect.addEventListener("change", function () { populateCourts(areaSelect.value); });
  courtSelect.addEventListener("change", handleCourtSelection);
  copyBtn.addEventListener("click", function () { if (currentCopyText) autoCopy(currentCopyText); });
  if (minDaysInput) {
    minDaysInput.addEventListener("change", readMinDays);
    minDaysInput.addEventListener("blur", readMinDays);
  }

  const minDaysToggle = document.getElementById("minDaysToggle");
  const minDaysPanel = document.getElementById("minDaysPanel");
  if (minDaysToggle && minDaysPanel) {
    minDaysPanel.style.display = "none";
    minDaysToggle.addEventListener("click", function () {
      const open = minDaysPanel.style.display !== "none";
      minDaysPanel.style.display = open ? "none" : "flex";
    });
  }

  async function loadJson(path) {
    const res = await fetch(path + "?t=" + Date.now());
    if (!res.ok) throw new Error(path);
    return res.json();
  }

  async function init() {
    todayLabel.textContent = "Today: " + formatDate(new Date());
    try {
      DATA = await loadJson("schedules.json");
    } catch (err) {
      document.getElementById("errorBox").style.display = "block";
      document.getElementById("errorBox").textContent = "Could not load schedules.json.";
      return;
    }
    try {
      const fed = await loadJson("federal-holidays.json");
      (fed.holidays || []).forEach(function (h) { if (h.date) FEDERAL.add(h.date); });
    } catch (e) { console.warn("federal-holidays.json missing"); }
    try {
      const cust = await loadJson("custom-exclusions.json");
      CUSTOM = (cust.exclusions || []).filter(function (e) {
        return e.date && e.court && e.court.indexOf("EXAMPLE") === -1 && String(e.reason || "").indexOf("EXAMPLE") === -1;
      });
      // Keep examples out of live logic if marked EXAMPLE
      CUSTOM = (cust.exclusions || []).filter(function (e) {
        if (!e.date || !e.court) return false;
        const r = String(e.reason || "");
        if (e.court === "Example Town") return false;
        if (r.indexOf("EXAMPLE") !== -1) return false;
        return true;
      });
    } catch (e) { console.warn("custom-exclusions.json missing"); }

    if (minDaysInput) {
      minDays = parseInt(minDaysInput.value, 10) || 30;
    }
    populateAreas();
    const about = DATA.about || {};
    footerMeta.textContent = "Multi-county Troop B. Source dates shown per area. Holidays/exclusions applied." +
      (about.lastUpdated ? " Updated " + about.lastUpdated + "." : "");
  }
  updateLightingReference();
  setInterval(updateLightingReference, 60000);
  init();
})();
