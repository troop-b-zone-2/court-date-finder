/* =========================================================
   Court Date Finder – Troop B Zone 2
   ========================================================= */

(function () {
  "use strict";

  // ---------- State ----------
  let DATA = null;
  let currentCopyText = "";

  // ---------- Constants ----------
  const WEEKDAY_MAP = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6
  };

  const ORDINAL_MAP = {
    "1st": 1,
    "2nd": 2,
    "3rd": 3,
    "4th": 4,
    "5th": 5
  };

  // ---------- DOM refs ----------
  const stationSelect = document.getElementById("stationSelect");
  const courtSelect = document.getElementById("courtSelect");
  const resultCard = document.getElementById("resultCard");
  const copyBtn = document.getElementById("copyBtn");
  const copyLabel = document.getElementById("copyLabel");
  const todayLabel = document.getElementById("todayLabel");
  const footerMeta = document.getElementById("footerMeta");
  const metaNote = document.getElementById("metaNote");

  // ---------- Date helpers ----------
  function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  function formatDate(d) {
    return d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  }

  function formatMMDDYYYY(d) {
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return mm + "/" + dd + "/" + d.getFullYear();
  }

  function formatShort(d) {
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  }

  // ---------- Schedule parsing ----------
  function parseWhen(whenStr) {
    const s = whenStr.toLowerCase().trim();
    let weekday = null;

    for (const [name, num] of Object.entries(WEEKDAY_MAP)) {
      if (s.includes(name)) {
        weekday = num;
        break;
      }
    }
    if (weekday === null) return null;

    if (s.startsWith("every")) {
      return { type: "weekly", weekday };
    }

    const ordinals = [];
    for (const [word, num] of Object.entries(ORDINAL_MAP)) {
      if (s.includes(word)) ordinals.push(num);
    }
    ordinals.sort((a, b) => a - b);
    if (ordinals.length === 0) return null;

    return { type: "nth", weekday, ordinals };
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

  function candidatesFromMeet(meet, fromDate, monthsAhead = 10) {
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
      }
    }
    return candidates;
  }

  function findNextCourtDate(court) {
    const today = startOfDay(new Date());
    const minDate = addDays(today, 30);
    let all = [];

    for (const meet of court.meets) {
      all = all.concat(candidatesFromMeet(meet, today));
    }

    all.sort((a, b) => a.date - b.date);

    for (const item of all) {
      if (item.date >= minDate) {
        return {
          date: item.date,
          time: item.time,
          name: court.name,
          minDate,
          daysFromToday: Math.round((item.date - today) / (1000 * 60 * 60 * 24)),
          meets: court.meets,
          notes: court.notes || null
        };
      }
    }
    return null;
  }

  // ---------- UI ----------
  function populateStations() {
    stationSelect.innerHTML = '<option value="">— Choose a station —</option>';
    DATA.stations.forEach((s, i) => {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = s.name;
      stationSelect.appendChild(opt);
    });
  }

  function populateCourts(stationIndex) {
    courtSelect.innerHTML = "";
    resultCard.classList.remove("show");

    if (stationIndex === "" || stationIndex === null) {
      courtSelect.disabled = true;
      courtSelect.innerHTML = '<option value="">— Select a station first —</option>';
      return;
    }

    const station = DATA.stations[stationIndex];
    courtSelect.disabled = false;

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "— Choose a court —";
    courtSelect.appendChild(placeholder);

    station.courts.forEach((c, i) => {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = c.name;
      courtSelect.appendChild(opt);
    });
  }

  function showResult(court) {
    const result = findNextCourtDate(court);
    if (!result) {
      resultCard.classList.remove("show");
      return;
    }

    document.getElementById("resultDate").textContent = formatDate(result.date);
    document.getElementById("resultTime").textContent = result.time;
    document.getElementById("resultCourt").textContent = result.name;
    document.getElementById("resultMinDate").textContent = formatShort(result.minDate);
    document.getElementById("resultDays").textContent = result.daysFromToday + " days";

    const rulesBox = document.getElementById("scheduleRules");
    let lines = result.meets.map((m) => m.when + " @ " + m.time);
    if (result.notes) lines.push(result.notes);

    rulesBox.innerHTML =
      '<div class="label">Court Schedule</div>' +
      lines.map((l) => '<div class="rule">' + l + "</div>").join("");

    currentCopyText = formatMMDDYYYY(result.date) + " " + result.time;
    autoCopy(currentCopyText);
    resultCard.classList.add("show");
  }

  async function autoCopy(text) {
    try {
      await navigator.clipboard.writeText(text);
      copyLabel.textContent = "Copied!";
      copyBtn.classList.add("copied");
      setTimeout(() => {
        copyLabel.textContent = "Copy Date & Time";
        copyBtn.classList.remove("copied");
      }, 1800);
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
        setTimeout(() => {
          copyLabel.textContent = "Copy Date & Time";
          copyBtn.classList.remove("copied");
        }, 1800);
      } catch (e2) {
        /* ignore */
      }
    }
  }

  function handleCourtSelection() {
    const si = stationSelect.value;
    const ci = courtSelect.value;

    if (si === "" || ci === "") {
      resultCard.classList.remove("show");
      return;
    }

    const court = DATA.stations[si].courts[ci];
    if (court) showResult(court);
  }

  // ---------- Events ----------
  stationSelect.addEventListener("change", () => {
    populateCourts(stationSelect.value);
    // Move focus to Court once it is enabled
    if (stationSelect.value !== "") {
      courtSelect.focus();
    }
  });

  courtSelect.addEventListener("change", handleCourtSelection);

  let prevCourt = "";
  courtSelect.addEventListener("focus", () => {
    prevCourt = courtSelect.value;
  });
  courtSelect.addEventListener("blur", () => {
    if (courtSelect.value && courtSelect.value === prevCourt) {
      handleCourtSelection();
    }
  });

  copyBtn.addEventListener("click", () => {
    if (currentCopyText) autoCopy(currentCopyText);
  });

  // ---------- Init ----------
  async function init() {
    todayLabel.textContent = "Today: " + formatDate(new Date());

    try {
      const res = await fetch("schedules.json?t=" + Date.now());
      if (!res.ok) throw new Error("Could not load schedules.json");
      DATA = await res.json();
    } catch (err) {
      console.error(err);
      document.getElementById("errorBox").style.display = "block";
      document.getElementById("errorBox").textContent =
        "Could not load schedules.json. Make sure it is in the same folder as this page.";
      return;
    }

    populateStations();

    const about = DATA.about || {};
    const updated = about.lastUpdated ? " Updated " + about.lastUpdated + "." : "";
    footerMeta.textContent =
      "Data from the Troop B Zone 2 Court Cheat Sheet and station post map." + updated;
    metaNote.textContent = "";
  }

  init();
})();
