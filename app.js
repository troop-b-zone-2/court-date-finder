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
  init();
})();
