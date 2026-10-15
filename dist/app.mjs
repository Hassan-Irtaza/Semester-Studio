import { DAYS, STARTS, fmt, findClashes, parseTimetable } from "./parser.mjs";
import { groupCourses, generateAlternatives, ics, csv } from "./scheduling.mjs";
import { drawSchedule, canvasPDF } from "./exports.mjs";
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const escape = (x) =>
  String(x ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const option = (v, l = v) =>
  `<option value="${escape(v)}">${escape(l)}</option>`;
function read(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function persist(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    toast(
      "Device storage is full or unavailable. Export your schedule to keep a copy.",
    );
    return false;
  }
}
let dataset,
  view = "preset",
  layout = "week",
  custom = read("ss-custom", []),
  saved = read("ss-saved", []),
  customName = "My custom timetable",
  selectedSection = "BSCS-6A",
  sourceUrl = "source-timetable.pdf",
  importedURL = null,
  importing = false;
const current = () =>
  view === "custom"
    ? custom
    : dataset?.events.filter((e) => e.section === selectedSection) || [];
const title = () => (view === "custom" ? customName : selectedSection);
const subtitle = () =>
  dataset
    ? `${dataset.title.replace(/Department of CS & IT\s*-?\s*/i, "")} · ${new Set(current().map((e) => e.subject)).size} courses · ${new Set(current().map((e) => e.day)).size} campus days`
    : "";
let toastTimer;
function toast(s) {
  $("#toast").textContent = s;
  $("#toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 4200);
}
function modal(body) {
  $("#modal-body").innerHTML = body;
  if (!$("#modal").open) $("#modal").showModal();
}
const top = (t) =>
  `<div class="modal-top"><h2>${escape(t)}</h2><button data-close aria-label="Close dialog">×</button></div>`;
function close() {
  $("#modal").close();
}
function saveCustom() {
  persist("ss-custom", custom);
}
function renderCounts() {
  $("#saved-count").textContent = saved.length;
  $("#saved-inline").textContent = saved.length;
}
function program(s) {
  return s.match(/^[A-Z]+/)?.[0] || "Other";
}
function semester(s) {
  return s.match(/-(\d+)/)?.[1] || "Other";
}
function populateFilters(preferred = selectedSection) {
  if (!dataset) return;
  const programs = [...new Set(dataset.sections.map(program))];
  let prog = program(preferred);
  if (!programs.includes(prog)) prog = programs[0];
  $("#program").innerHTML = programs.map((x) => option(x)).join("");
  $("#program").value = prog;
  updateSemesters(preferred);
}
function updateSemesters(preferred) {
  let sems = [
    ...new Set(
      dataset.sections
        .filter((s) => program(s) === $("#program").value)
        .map(semester),
    ),
  ].sort((a, b) => +a - +b);
  let sem = semester(preferred || "");
  if (!sems.includes(sem)) sem = sems[0];
  $("#semester").innerHTML = sems
    .map((x) => option(x, `Semester ${x}`))
    .join("");
  $("#semester").value = sem;
  updateSections(preferred);
}
function updateSections(preferred) {
  let sections = dataset.sections.filter(
    (s) =>
      program(s) === $("#program").value &&
      semester(s) === $("#semester").value,
  );
  $("#section").innerHTML = sections
    .map((x) => option(x, x.split("-").at(-1)))
    .join("");
  selectedSection = sections.includes(preferred) ? preferred : sections[0];
  $("#section").value = selectedSection;
  render();
}
function setView(v) {
  view = v;
  $$("[data-view]").forEach((b) => {
    let active = b.dataset.view === v;
    b.classList.toggle("active", active && b.classList.contains("nav"));
    b.classList.toggle("selected", active && b.getAttribute("role") === "tab");
    if (b.getAttribute("role") === "tab")
      b.setAttribute("aria-selected", String(active));
  });
  $("#crumb").textContent = {
    preset: "Timetables",
    custom: "Custom builder",
    saved: "Saved schedules",
  }[v];
  $("#planner").classList.toggle("hidden", v === "saved");
  $("#saved-panel").classList.toggle("hidden", v !== "saved");
  $("#custom-panel").classList.toggle("hidden", v !== "custom");
  $("#copy-custom").classList.toggle("hidden", v === "custom");
  $("#page-title").innerHTML =
    v === "saved"
      ? "Good weeks, <em>worth keeping.</em>"
      : v === "custom"
        ? "Your semester, <em>on your terms.</em>"
        : "Your week, <em>thoughtfully planned.</em>";
  $("#page-description").textContent =
    v === "saved"
      ? "All your schedules, ready whenever you need them."
      : "Find your section. Shape your schedule. Make the semester yours.";
  render();
}
function render() {
  if (!dataset) return;
  renderCounts();
  if (view === "saved") {
    renderSaved();
    return;
  }
  if (view === "custom") renderCatalog();
  let events = current(),
    clashes = findClashes(events),
    clashIds = new Set(clashes.flat().map((e) => e.id));
  $("#schedule-title").textContent = title();
  $("#schedule-subtitle").textContent = subtitle();
  $("#clash-status").textContent = clashes.length
    ? `${clashes.length} clash${clashes.length === 1 ? "" : "es"}`
    : "✓ No clashes";
  $("#clash-status").classList.toggle("warning", !!clashes.length);
  $("#clash-detail").classList.toggle("hidden", !clashes.length);
  $("#clash-detail").innerHTML = clashes
    .map(
      ([a, b]) =>
        `${escape(DAYS[a.day])}: <b>${escape(a.subject)}</b> overlaps <b>${escape(b.subject)}</b> (${fmt(Math.max(a.start, b.start))}–${fmt(Math.min(a.end, b.end))}).`,
    )
    .join("<br>");
  $("#hours").textContent = (
    events.reduce((sum, e) => sum + e.end - e.start, 0) / 60
  ).toFixed(1);
  $("#classes").textContent = events.length;
  $("#calendar").innerHTML =
    layout === "week" ? grid(events, clashIds) : list(events);
}
function grid(events, clashIds) {
  let html =
    '<div class="week-grid"><div class="day-head">PKT</div>' +
    DAYS.map(
      (d, i) =>
        `<div class="day-head">${d.slice(0, 3).toUpperCase()} <small>${events.filter((e) => e.day === i).length || "—"}</small></div>`,
    ).join("") +
    '<div class="time-column">' +
    STARTS.map(
      (t, i) =>
        `<span class="time-label" style="top:${(i / 6) * 100}%">${fmt(t)}</span>`,
    ).join("") +
    "</div>";
  for (let day = 0; day < 6; day++) {
    const dayEvents = events
      .filter((e) => e.day === day)
      .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
    let lanes = [],
      placed = new Map();
    for (const e of dayEvents) {
      let lane = lanes.findIndex((end) => end <= e.start);
      if (lane < 0) lane = lanes.length;
      lanes[lane] = e.end;
      placed.set(e.id, lane);
    }
    html += '<div class="day-column">';
    if (!dayEvents.length)
      html +=
        '<div class="empty-day"><span>⌁</span>A little breathing room</div>';
    for (const e of dayEvents) {
      let overlap = dayEvents.filter((o) => e.start < o.end && o.start < e.end),
        num =
          overlap.length > 1
            ? Math.max(...overlap.map((o) => placed.get(o.id))) + 1
            : 1,
        lane = num > 1 ? placed.get(e.id) : 0;
      html += `<button class="class-event ${e.kind === "Lab" ? "lab" : e.kind === "Personal" ? "personal" : ""} ${clashIds.has(e.id) ? "clash" : ""}" data-event="${escape(e.id)}" style="top:${((e.start - 480) / 540) * 100}%;height:${((e.end - e.start) / 540) * 100 - 0.9}%;${num > 1 ? `left:calc(${(lane / num) * 100}% + 3px);width:calc(${100 / num}% - 6px);` : ""}" aria-label="${escape(`${e.subject}, ${DAYS[e.day]}, ${fmt(e.start)} to ${fmt(e.end)}, ${e.room}`)}"><span class="event-subject">${escape(e.subject)}</span><span class="event-time">${fmt(e.start)} – ${fmt(e.end)}</span><span class="event-room">${escape(e.room || "Room to be confirmed")}</span><span class="event-teacher">${escape(e.teacher)}</span>${view === "custom" ? `<span class="event-section">${escape(e.section)}</span>` : ""}</button>`;
    }
    html += "</div>";
  }
  return html + "</div>";
}
function list(events) {
  return (
    '<div class="list-view">' +
    DAYS.map(
      (d, i) =>
        `<div class="list-day">${d}</div>${
          events
            .filter((e) => e.day === i)
            .sort((a, b) => a.start - b.start)
            .map(
              (e) =>
                `<button class="list-class" data-event="${escape(e.id)}" style="width:100%;text-align:left"><span class="list-time">${fmt(e.start)} – ${fmt(e.end)}</span><div><b>${escape(e.subject)}</b><p>${escape([e.teacher, e.section].filter(Boolean).join(" · "))}</p></div><span>${escape(e.room)}</span></button>`,
            )
            .join("") ||
          '<p class="muted">No classes. Enjoy the breathing room.</p>'
        }`,
    ).join("") +
    "</div>"
  );
}
function renderCatalog() {
  let search = $("#course-search").value.toLowerCase();
  let groups = groupCourses(
    dataset.events.filter((e) => e.section === selectedSection),
  );
  let chosen = new Set(custom.map((e) => e.id));
  $("#catalog").innerHTML =
    groups
      .filter((g) =>
        [g.subject, ...g.events.map((e) => e.teacher + " " + e.room)]
          .join(" ")
          .toLowerCase()
          .includes(search),
      )
      .map((g) => {
        let added = g.events.every((e) => chosen.has(e.id));
        return `<div class="course ${added ? "added" : ""}"><div><b>${escape(g.subject)} <span class="course-count">${g.events.length}× / week</span></b><p>${escape([...new Set(g.events.map((e) => e.teacher))].join(" / "))}<br>${escape(g.events.map((e) => `${DAYS[e.day].slice(0, 3)} ${fmt(e.start)}`).join(" · "))}</p></div><button data-course="${escape(g.key)}" aria-label="${added ? "Remove" : "Add"} ${escape(g.subject)}">${added ? "✓" : "＋"}</button></div>`;
      })
      .join("") ||
    '<p class="muted">No matching courses in this section. Try another section.</p>';
  $("#selected-courses").innerHTML = groupCourses(custom)
    .map(
      (g) =>
        `<span class="chip">${escape(g.subject)} · ${escape(g.section)}<button data-remove-course="${escape(g.key)}" aria-label="Remove ${escape(g.subject)}">×</button></span>`,
    )
    .join("");
}
function renderSaved() {
  $("#saved-panel").innerHTML =
    `<div class="batch-controls"><button class="button secondary" id="import-json">↥ Import saved schedule</button><button class="button secondary" id="batch">＋ Save multiple sections</button></div>` +
    (saved.length
      ? `<div class="saved-grid">${saved.map((s) => `<article class="saved-card"><span class="muted">${new Date(s.created).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span><h3>${escape(s.name)}</h3><p>${s.events.length} meetings · ${(s.events.reduce((a, e) => a + e.end - e.start, 0) / 60).toFixed(1)} hours / week<br>${findClashes(s.events).length ? "Contains clashes" : "No clashes"}</p><div class="row"><button class="button primary" data-load="${escape(s.id)}">Open schedule ↗</button><button class="text-btn" data-delete="${escape(s.id)}" aria-label="Delete ${escape(s.name)}">Delete</button></div></article>`).join("")}</div>`
      : '<div class="empty-state"><span class="line-art">✧</span><h3>Make space for a great semester.</h3><p>Save a section or custom timetable and it will appear here.</p><button class="button primary" data-view="preset">Explore timetables ↗</button></div>');
}
function persistSaved(next) {
  if (!persist("ss-saved", next)) return false;
  saved = next;
  renderCounts();
  return true;
}
function saveDialog() {
  if (!current().length) {
    toast("Add a class before saving your timetable.");
    return;
  }
  modal(
    top("Keep this week.") +
      `<p class="modal-copy">Save a copy on this device. You can keep as many versions as your browser storage allows.</p><form id="save-form"><label>Schedule name<input name="name" required maxlength="100" value="${escape(title())}"></label><div class="modal-footer"><small>${current().length} weekly meetings</small><button class="button primary">Save schedule ↗</button></div></form>`,
  );
  $("#save-form").onsubmit = (e) => {
    e.preventDefault();
    const name = new FormData(e.target).get("name").trim();
    if (!name) return;
    if (
      persistSaved([
        ...saved,
        {
          id: crypto.randomUUID(),
          name,
          events: structuredClone(current()),
          source: dataset.title,
          created: Date.now(),
        },
      ])
    ) {
      close();
      toast("Schedule saved. A calmer week is ready.");
    }
  };
}
function eventDetail(id) {
  const e = current().find((e) => e.id === id);
  if (!e) return;
  modal(
    top(e.subject) +
      `<div class="detail-grid"><div><small>WHEN</small>${DAYS[e.day]} · ${fmt(e.start)}–${fmt(e.end)}</div><div><small>SECTION</small>${escape(e.section)}</div><div><small>ROOM</small>${escape(e.room || "To be confirmed")}</div><div><small>INSTRUCTOR</small>${escape(e.teacher || "To be confirmed")}</div></div>${e.page ? `<p class="muted">Imported from page ${e.page} of the source PDF. Lab durations follow the slots shown in that PDF.</p>` : ""}<div class="modal-footer">${e.page ? `<a class="text-btn" href="${sourceUrl}#page=${e.page}" target="_blank" rel="noopener">View source PDF ↗</a>` : "<span></span>"}<div class="row">${view === "custom" ? `<button class="text-btn" id="remove-meeting">Remove</button><button class="button primary" id="edit-meeting">Edit class</button>` : `<button class="button primary" id="use-section">Customize this section</button>`}</div></div>`,
  );
  if (view === "custom") {
    $("#remove-meeting").onclick = () => {
      custom = custom.filter((x) => x.id !== id);
      saveCustom();
      close();
      render();
    };
    $("#edit-meeting").onclick = () => manualDialog(e);
  } else
    $("#use-section").onclick = () => {
      custom = structuredClone(current());
      saveCustom();
      close();
      setView("custom");
    };
}
function manualDialog(entry = null) {
  modal(
    top(entry ? "Edit this class" : "Make room for something.") +
      `<p class="modal-copy">Add a lecture, study block or anything else that belongs in your week.</p><form id="manual-form"><div class="form-grid"><label class="full">Class or activity<input name="subject" required maxlength="100" value="${escape(entry?.subject || "")}" placeholder="e.g. Deep learning study session"></label><label>Day<select name="day">${DAYS.map((d, i) => option(i, d)).join("")}</select></label><label>Type<select name="kind">${["Personal", "Lecture", "Lab"].map((x) => option(x)).join("")}</select></label><label>Start time<input type="time" name="start" min="08:00" max="16:44" required value="${fmt(entry?.start ?? 480)}"></label><label>End time<input type="time" name="end" min="08:01" max="16:45" required value="${fmt(entry?.end ?? 555)}"></label><label>Room / location<input name="room" maxlength="80" value="${escape(entry?.room || "")}" placeholder="Library, CS-201…"></label><label>Instructor (optional)<input name="teacher" maxlength="80" value="${escape(entry?.teacher || "")}"></label><label class="full">Section / label<input name="section" maxlength="50" value="${escape(entry?.section || "Personal")}"></label></div><div id="manual-error"></div><div class="modal-footer"><small>Campus grid: 08:00–16:45 PKT</small><button class="button primary">${entry ? "Update" : "Add"} class ↗</button></div></form>`,
  );
  if (entry) {
    $("#manual-form").elements.day.value = entry.day;
    $("#manual-form").elements.kind.value = entry.kind;
  }
  $("#manual-form").onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target)),
      minutes = (s) => +s.split(":")[0] * 60 + +s.split(":")[1],
      start = minutes(f.start),
      end = minutes(f.end);
    if (end <= start || start < 480 || end > 1005) {
      $("#manual-error").innerHTML =
        '<div class="error">End time must follow the start, within 08:00–16:45.</div>';
      return;
    }
    const item = {
      ...f,
      subject: f.subject.trim(),
      start,
      end,
      day: +f.day,
      id: entry?.id || crypto.randomUUID(),
    };
    if (!item.subject) return;
    custom = entry
      ? custom.map((x) => (x.id === entry.id ? item : x))
      : [...custom, item];
    saveCustom();
    close();
    render();
    toast(entry ? "Class updated." : "Class added to your week.");
  };
}
function importDialog() {
  modal(
    top("A fresh start for your semester.") +
      `<p class="modal-copy">Upload a University of Lahore CS & IT <b>semester-wise PDF</b> in the same grid format as your supplied V1.6 file. All programs, sections and merged lab slots are read together.</p><div class="drop-zone" id="drop-zone" tabindex="0" role="button" aria-label="Choose timetable PDF"><span>↥</span><b>Drop your timetable here</b><p>or click to browse · Original text PDF · Up to 30 MB</p></div><div id="import-progress"></div><div class="modal-footer"><small>Processed privately, right in your browser.</small><a class="text-btn" href="source-timetable.pdf" download>Get sample PDF ↧</a></div>`,
  );
  let zone = $("#drop-zone");
  zone.onclick = () => $("#pdf-input").click();
  zone.onkeydown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      $("#pdf-input").click();
    }
  };
  zone.ondragover = (e) => {
    e.preventDefault();
    zone.style.background = "#e0e8d2";
  };
  zone.ondragleave = () => (zone.style.background = "");
  zone.ondrop = (e) => {
    e.preventDefault();
    zone.style.background = "";
    if (e.dataTransfer.files[0]) importPDF(e.dataTransfer.files[0]);
  };
}
async function importPDF(file) {
  if (importing) return;
  if (!/\.pdf$/i.test(file.name) || file.size > 30 * 1024 * 1024) {
    toast("Choose a PDF smaller than 30 MB.");
    return;
  }
  importing = true;
  if (!$("#import-progress")) importDialog();
  const progress = $("#import-progress");
  progress.innerHTML = '<p class="modal-copy">Opening PDF…</p>';
  try {
    const pdfjs = await import("./vendor/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.mjs";
    const data = await parseTimetable(
      pdfjs,
      new Uint8Array(await file.arrayBuffer()),
      (n, total) => {
        progress.innerHTML = `<p class="modal-copy">Reading page ${n} of ${total}…</p>`;
      },
    );
    modal(
      top("Your semester, decoded.") +
        `<div class="import-report"><b>${data.sections.length} sections · ${data.events.length} meetings · ${data.pages} pages</b><br>${escape(data.title)}</div><p class="modal-copy">Review the preview below, then use this timetable. You can inspect any class against its original PDF page.</p><div class="review-table"><table><thead><tr><th>Section</th><th>Course</th><th>Day / time</th><th>Room</th></tr></thead><tbody>${data.events
          .slice(0, 30)
          .map(
            (e) =>
              `<tr><td>${escape(e.section)}</td><td>${escape(e.subject)}</td><td>${DAYS[e.day].slice(0, 3)} ${fmt(e.start)}–${fmt(e.end)}</td><td>${escape(e.room)}</td></tr>`,
          )
          .join(
            "",
          )}</tbody></table></div><p class="muted">Showing the first ${Math.min(30, data.events.length)} meetings. All ${data.events.length} will be available.</p>${data.warnings.length ? `<div class="error">${data.warnings.map(escape).join("<br>")}</div>` : ""}<div class="modal-footer"><button class="text-btn" id="try-import">Choose another PDF</button><button class="button primary" id="apply-import">Use this timetable ↗</button></div>`,
    );
    $("#try-import").onclick = importDialog;
    $("#apply-import").onclick = async () => {
      dataset = data;
      dataset.fileName = file.name;
      persist("ss-dataset", dataset);
      if (importedURL) URL.revokeObjectURL(importedURL);
      importedURL = URL.createObjectURL(file);
      sourceUrl = importedURL;
      try {
        await putPDF(file);
      } catch {
        toast(
          "Timetable imported. Source PDF will be available until this page closes.",
        );
      }
      selectedSection = data.sections[0];
      updateSource();
      populateFilters();
      setView("preset");
      close();
      toast(`Ready. ${data.sections.length} sections are now available.`);
    };
  } catch (err) {
    if (progress.isConnected)
      progress.innerHTML = `<div class="error">${escape(err.message)}<br>Try the original PDF rather than an image or scanned copy.</div>`;
    else toast(err.message);
  } finally {
    importing = false;
    $("#pdf-input").value = "";
  }
}
function openDB() {
  return new Promise((resolve, reject) => {
    let r = indexedDB.open("semester-studio", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("files");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function putPDF(file) {
  let db = await openDB();
  await new Promise((resolve, reject) => {
    let tx = db.transaction("files", "readwrite");
    tx.objectStore("files").put(file, "source");
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
async function restorePDF() {
  try {
    let db = await openDB();
    let file = await new Promise((resolve, reject) => {
      let r = db.transaction("files").objectStore("files").get("source");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    db.close();
    if (file) {
      importedURL = URL.createObjectURL(file);
      sourceUrl = importedURL;
    }
  } catch {}
}
function updateSource() {
  $("#source-title").textContent =
    dataset.fileName || "CS & IT · Semester-wise timetable";
  $("#source-description").textContent =
    `${dataset.sections.length} sections available · ${dataset.pages} pages imported · All semesters in this PDF`;
  $("#source-status").textContent = "✓ Ready to plan";
  const term =
    dataset.title.match(/(FALL|SPRING|SUMMER)\s*\d{4}/i)?.[0] ||
    "YOUR SEMESTER";
  $("#term-tag").innerHTML =
    `◈ &nbsp; ${escape(term)} <small>${escape(dataset.title.match(/V\s*[\d.]+/i)?.[0] || "PDF")}</small>`;
}
function help() {
  modal(
    top("A calmer way to plan.") +
      `<ol class="help-list"><li><b>Pick your section.</b> Choose a program, semester and section to see every meeting from the PDF.</li><li><b>Make it personal.</b> Open Custom builder, select a section, and add courses. Change sections to mix your choices. Each course includes all weekly meetings of that type.</li><li><b>Check your options.</b> Generate alternatives to find clash-free combinations of your selected subjects, with lectures and labs kept in the same section.</li><li><b>Keep your week.</b> Save schedules, download images and PDFs, or add recurring classes to Apple or Google Calendar.</li><li><b>Refresh next semester.</b> Import an original text-based CS & IT semester-wise PDF. Review the detected classes before applying it.</li></ol><p class="muted">Schedules stay on this device and browser. Export JSON to back up or move them. This is an independent planner; verify department updates against the official PDF. Lab durations follow the PDF’s printed slot span.</p>`,
  );
}
function download(blob, name) {
  let url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
async function exportFile(type) {
  $("#export-menu").classList.add("hidden");
  if (!current().length) {
    toast("Add a class before exporting.");
    return;
  }
  let filename = title().replace(/[^a-z0-9_-]/gi, "_");
  if (type === "ics") {
    calendarDialog();
    return;
  }
  if (type === "json") {
    download(
      new Blob(
        [
          JSON.stringify(
            {
              format: "semester-studio",
              version: 1,
              name: title(),
              source: dataset.title,
              events: current(),
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
      filename + ".json",
    );
    return;
  }
  if (type === "csv") {
    download(
      new Blob([csv(current())], { type: "text/csv;charset=utf-8" }),
      filename + ".csv",
    );
    return;
  }
  toast("Preparing your timetable…");
  try {
    let canvas = drawSchedule(
      document.createElement("canvas"),
      current(),
      title(),
      subtitle(),
    );
    if (type === "pdf") {
      download(
        new Blob([canvasPDF(canvas)], { type: "application/pdf" }),
        filename + ".pdf",
      );
    } else
      await new Promise((resolve) =>
        canvas.toBlob((b) => {
          if (b) download(b, filename + ".png");
          else toast("Image export failed. Try PDF instead.");
          resolve();
        }, "image/png"),
      );
  } catch (err) {
    toast("Export failed: " + err.message);
  }
}
function calendarDialog() {
  let today = new Date().toISOString().slice(0, 10),
    end = new Date(Date.now() + 112 * 86400000).toISOString().slice(0, 10);
  modal(
    top("Take your week with you.") +
      `<p class="modal-copy">Create weekly repeating classes for Apple Calendar, Google Calendar or Outlook. Dates and times use <b>Asia/Karachi (PKT)</b>.</p><form id="calendar-form"><div class="form-grid"><label>Semester starts<input type="date" name="start" value="${today}" required></label><label>Semester ends<input type="date" name="end" value="${end}" required></label></div><div id="calendar-error"></div><div class="modal-footer"><small>Repeats every week within this range.</small><button class="button primary">Download .ics ↧</button></div></form>`,
  );
  $("#calendar-form").onsubmit = (e) => {
    e.preventDefault();
    let f = new FormData(e.target);
    try {
      let output = ics(current(), title(), f.get("start"), f.get("end"));
      download(
        new Blob([output], { type: "text/calendar;charset=utf-8" }),
        "semester-studio.ics",
      );
      close();
      toast("Calendar ready. Import the .ics file into your calendar.");
    } catch (err) {
      $("#calendar-error").innerHTML =
        `<div class="error">${escape(err.message)}</div>`;
    }
  };
}
function autoDialog() {
  if (!custom.filter((e) => e.kind !== "Personal").length) {
    toast("Add courses to your custom timetable first.");
    return;
  }
  modal(
    top("Explore the possibilities.") +
      `<p class="modal-copy">Find clash-free combinations of your selected subjects from sections in the same program. Lectures and labs for each subject stay together. Personal classes remain fixed.</p><form id="auto-form"><label>How many alternatives would you like?<input type="number" min="1" step="1" name="count" value="5" required></label><div id="auto-results"></div><div class="modal-footer"><small>Results depend on available combinations.</small><button class="button primary">Generate alternatives ✧</button></div></form>`,
  );
  $("#auto-form").onsubmit = async (e) => {
    e.preventDefault();
    let count = Number(new FormData(e.target).get("count"));
    if (!Number.isSafeInteger(count) || count < 1) return;
    let button = e.target.querySelector("button");
    button.disabled = true;
    $("#auto-results").innerHTML =
      '<p class="modal-copy">Finding room in your week…</p>';
    try {
      const result = await generateAlternatives(
        dataset.events,
        custom,
        count,
        (n, found) => {
          if ($("#auto-results"))
            $("#auto-results").innerHTML =
              `<p class="modal-copy">${n.toLocaleString()} combinations checked · ${found} found</p>`;
        },
      );
      if (!$("#auto-results")) return;
      $("#auto-results").innerHTML =
        `<div class="import-report"><b>${result.plans.length} alternative${result.plans.length === 1 ? "" : "s"} found</b><br>${result.limited ? "Search limit reached after 500,000 combinations. Try fewer subjects to explore further." : result.exhausted ? "All available combinations have been checked." : "Requested alternatives are ready."}</div>${result.plans.length ? '<button class="button secondary" type="button" id="keep-alternatives">Save all alternatives ↗</button>' : ""}`;
      if (result.plans.length)
        $("#keep-alternatives").onclick = () => {
          const stamp = Date.now();
          const next = result.plans.map((events, i) => ({
            id: crypto.randomUUID(),
            name: `Alternative ${i + 1} · ${new Date().toLocaleDateString()}`,
            events,
            source: dataset.title,
            created: stamp,
          }));
          if (persistSaved([...saved, ...next])) {
            close();
            setView("saved");
            toast(`${next.length} alternatives saved.`);
          }
        };
    } catch (err) {
      if ($("#auto-results"))
        $("#auto-results").innerHTML =
          `<div class="error">${escape(err.message)}</div>`;
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  };
}
function batchDialog() {
  modal(
    top("Every section you need.") +
      `<p class="modal-copy">Create separate saved timetables for any number of sections in this PDF.</p><label>Filter sections<input id="batch-search" placeholder="e.g. BSCS-6"></label><div class="row" style="margin:15px 0"><button class="text-btn" id="select-all">Select visible</button><button class="text-btn" id="select-none">Clear selection</button><span class="muted" id="batch-count">0 selected</span></div><div id="batch-list" class="catalog" style="grid-template-columns:repeat(3,1fr)"></div><div class="modal-footer"><small>One timetable per section.</small><button class="button primary" id="save-batch">Save sections ↗</button></div>`,
  );
  const chosen = new Set();
  const paint = () => {
    $("#batch-count").textContent = chosen.size + " selected";
    $("#batch-list").innerHTML = dataset.sections
      .filter((s) =>
        s.toLowerCase().includes($("#batch-search").value.toLowerCase()),
      )
      .map(
        (s) =>
          `<label class="course"><input type="checkbox" value="${escape(s)}" ${chosen.has(s) ? "checked" : ""} style="width:auto;margin:0">${escape(s)}</label>`,
      )
      .join("");
    $$("#batch-list input").forEach(
      (c) =>
        (c.onchange = () => {
          if (c.checked) chosen.add(c.value);
          else chosen.delete(c.value);
          $("#batch-count").textContent = chosen.size + " selected";
        }),
    );
  };
  paint();
  $("#batch-search").oninput = paint;
  $("#select-all").onclick = () => {
    $$("#batch-list input").forEach((c) => chosen.add(c.value));
    paint();
  };
  $("#select-none").onclick = () => {
    chosen.clear();
    paint();
  };
  $("#save-batch").onclick = () => {
    if (!chosen.size) {
      toast("Choose at least one section.");
      return;
    }
    let next = [...chosen].map((section) => ({
      id: crypto.randomUUID(),
      name: section,
      events: dataset.events.filter((e) => e.section === section),
      source: dataset.title,
      created: Date.now(),
    }));
    if (persistSaved([...saved, ...next])) {
      close();
      renderSaved();
      toast(`${next.length} section timetables saved.`);
    }
  };
}
function confirmDialog(message, onConfirm) {
  modal(
    top("Just checking.") +
      `<p class="modal-copy">${escape(message)}</p><div class="modal-footer"><button class="text-btn" data-close>Keep it</button><button class="button primary" id="confirm">Continue</button></div>`,
  );
  $("#confirm").onclick = () => {
    close();
    onConfirm();
  };
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("button,a");
  if (!b) return;
  if (b.hasAttribute("data-close")) close();
  if (b.dataset.view) {
    e.preventDefault();
    setView(b.dataset.view);
  }
  if (b.dataset.layout) {
    layout = b.dataset.layout;
    $$("[data-layout]").forEach((x) =>
      x.classList.toggle("selected", x.dataset.layout === layout),
    );
    render();
  }
  if (b.dataset.action === "import") importDialog();
  if (b.dataset.action === "help") help();
  if (b.dataset.event) eventDetail(b.dataset.event);
  if (b.dataset.export) exportFile(b.dataset.export);
  if (b.dataset.course) {
    const g = groupCourses(dataset.events).find(
      (g) => g.key === b.dataset.course,
    );
    if (!g) return;
    const ids = new Set(g.events.map((e) => e.id));
    if (g.events.every((e) => custom.some((c) => c.id === e.id)))
      custom = custom.filter((c) => !ids.has(c.id));
    else
      custom = [
        ...custom,
        ...g.events.filter((e) => !custom.some((c) => c.id === e.id)),
      ];
    saveCustom();
    render();
  }
  if (b.dataset.removeCourse) {
    let group = groupCourses(custom).find(
        (g) => g.key === b.dataset.removeCourse,
      ),
      ids = new Set(group.events.map((e) => e.id));
    custom = custom.filter((e) => !ids.has(e.id));
    saveCustom();
    render();
  }
  if (b.dataset.load) {
    let s = saved.find((x) => x.id === b.dataset.load);
    if (!s) return;
    const apply = () => {
      custom = structuredClone(s.events);
      customName = s.name;
      saveCustom();
      setView("custom");
    };
    if (custom.length)
      confirmDialog(
        "Open this saved schedule in the custom builder? Your current custom draft will be replaced.",
        apply,
      );
    else apply();
  }
  if (b.dataset.delete)
    confirmDialog("Delete this saved schedule from this device?", () => {
      if (persistSaved(saved.filter((x) => x.id !== b.dataset.delete)))
        renderSaved();
    });
  if (b.id === "import-json") $("#json-input").click();
  if (b.id === "batch") batchDialog();
});
$("#program").onchange = () => updateSemesters();
$("#semester").onchange = () => updateSections();
$("#section").onchange = () => {
  selectedSection = $("#section").value;
  render();
};
$("#course-search").oninput = renderCatalog;
$("#save").onclick = saveDialog;
$("#manual").onclick = () => manualDialog();
$("#auto-open").onclick = autoDialog;
$("#clear").onclick = () => {
  if (custom.length)
    confirmDialog(
      "Clear all classes from this custom draft? Saved copies will still be available.",
      () => {
        custom = [];
        customName = "My custom timetable";
        saveCustom();
        render();
      },
    );
};
$("#copy-custom").onclick = () => {
  let events = structuredClone(current());
  const apply = () => {
    custom = events;
    customName = `${selectedSection} · custom`;
    saveCustom();
    setView("custom");
  };
  if (custom.length)
    confirmDialog(
      "Replace your current custom draft with this section’s timetable?",
      apply,
    );
  else apply();
};
$("#export").onclick = (e) => {
  e.stopPropagation();
  $("#export-menu").classList.toggle("hidden");
};
document.addEventListener("click", (e) => {
  if (!e.target.closest(".export-wrap"))
    $("#export-menu").classList.add("hidden");
});
$("#pdf-input").onchange = (e) => {
  if (e.target.files[0]) importPDF(e.target.files[0]);
};
$("#modal").addEventListener("click", (e) => {
  if (e.target === $("#modal")) close();
});
$("#json-input").onchange = async (e) => {
  let file = e.target.files[0];
  if (!file) return;
  try {
    if (file.size > 10 * 1024 * 1024)
      throw new Error("Schedule file must be below 10 MB.");
    let d = JSON.parse(await file.text());
    if (
      d.format !== "semester-studio" ||
      d.version !== 1 ||
      !Array.isArray(d.events) ||
      !d.events.length
    )
      throw new Error("Choose a Semester Studio schedule JSON export.");
    if (
      d.events.some(
        (x) =>
          typeof x.subject !== "string" ||
          !x.subject.trim() ||
          typeof x.id !== "string" ||
          !Number.isInteger(x.day) ||
          x.day < 0 ||
          x.day > 5 ||
          !Number.isFinite(x.start) ||
          !Number.isFinite(x.end) ||
          x.start < 480 ||
          x.end > 1005 ||
          x.start >= x.end ||
          !["Lecture", "Lab", "Personal"].includes(x.kind),
      )
    )
      throw new Error(
        "Some schedule entries are invalid or outside the campus timetable hours.",
      );
    const events = d.events.map((x) => ({ ...x, id: crypto.randomUUID() }));
    if (
      persistSaved([
        ...saved,
        {
          id: crypto.randomUUID(),
          name: String(d.name || "Imported schedule").slice(0, 100),
          events,
          source: String(d.source || "Imported"),
          created: Date.now(),
        },
      ])
    ) {
      setView("saved");
      toast("Schedule imported.");
    }
  } catch (err) {
    toast(err.message);
  } finally {
    e.target.value = "";
  }
};
async function init() {
  try {
    dataset = read("ss-dataset", null);
    if (!dataset?.events?.length)
      dataset = await (await fetch("./dataset.json")).json();
    else await restorePDF();
    updateSource();
    populateFilters(
      dataset.sections.includes("BSCS-6A") ? "BSCS-6A" : dataset.sections[0],
    );
    setView("preset");
  } catch (err) {
    $("#source-description").textContent =
      "Could not load the starter timetable. Import your PDF to get started.";
    $("#source-status").textContent = "Import PDF";
    $("#calendar").innerHTML =
      '<div class="loading">Import a timetable PDF to begin.</div>';
    toast("Starter timetable failed to load. You can import your PDF.");
  }
}
init();
