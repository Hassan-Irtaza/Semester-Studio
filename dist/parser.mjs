export const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
export const STARTS = [480, 570, 660, 750, 840, 930];
export const fmt = (m) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export function findClashes(events) {
  let out = [];
  for (let i = 0; i < events.length; i++)
    for (let j = i + 1; j < events.length; j++)
      if (
        events[i].day === events[j].day &&
        events[i].start < events[j].end &&
        events[j].start < events[i].end
      )
        out.push([events[i], events[j]]);
  return out;
}
function mult(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
const uniq = (a) =>
  [...new Set(a.map((x) => Math.round(x * 10) / 10))].sort((a, b) => a - b);
function join(items) {
  let lines = [];
  for (const t of items.sort((a, b) => a.y - b.y || a.x - b.x)) {
    let l = lines.find((l) => Math.abs(l.y - t.y) < 1.5);
    if (!l) lines.push((l = { y: t.y, items: [] }));
    l.items.push(t);
  }
  return lines
    .map((l) =>
      l.items
        .sort((a, b) => a.x - b.x)
        .map((t) => t.str)
        .join(" "),
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
export async function parseTimetable(pdfjs, data, onProgress = () => {}) {
  const pdf = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const events = [],
    sections = new Set(),
    warnings = [];
  let title = "Imported timetable";
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    onProgress(pageNum, pdf.numPages);
    const p = await pdf.getPage(pageNum),
      height = p.view[3];
    const content = await p.getTextContent();
    const text = content.items
      .filter((t) => t.str?.trim())
      .map((t) => ({
        str: t.str.trim(),
        x: t.transform[4],
        cx: t.transform[4] + t.width / 2,
        y: height - t.transform[5] - t.height / 2,
        h: t.height,
      }));
    if (pageNum === 1) {
      let h = text
        .filter((t) => t.y < 50)
        .map((t) => t.str)
        .join(" ");
      if (h) title = h.replace(/Summary timetable of classes/i, "").trim();
    }
    let labels = text.filter(
      (t) =>
        /^(?:BSCS|BSIT|BSSE|BSAI|BSDS|BSCE|MSCS|MSIT|MSSE|MCS|PhD)[-\s]*\d+[A-Z]?(?:[-\s].*)?$/i.test(
          t.str,
        ) && t.cx < p.view[2] * 0.15,
    );
    if (!labels.length) {
      warnings.push(`Page ${pageNum}: no recognized section labels.`);
      continue;
    }
    const ops = await p.getOperatorList();
    let matrix = [1, 0, 0, 1, 0, 0],
      stack = [],
      lines = [];
    const pt = (x, y) => ({
      x: matrix[0] * x + matrix[2] * y + matrix[4],
      y: height - (matrix[1] * x + matrix[3] * y + matrix[5]),
    });
    for (let i = 0; i < ops.fnArray.length; i++) {
      let op = ops.fnArray[i],
        a = ops.argsArray[i];
      if (op === pdfjs.OPS.save) stack.push([...matrix]);
      else if (op === pdfjs.OPS.restore) matrix = stack.pop() || matrix;
      else if (op === pdfjs.OPS.transform) matrix = mult(matrix, a);
      else if (op === pdfjs.OPS.constructPath && a[2]) {
        const b = a[2],
          u = pt(b[0], b[1]),
          v = pt(b[2], b[3]);
        if (Math.abs(u.x - v.x) < 0.4 || Math.abs(u.y - v.y) < 0.4)
          lines.push({
            x0: Math.min(u.x, v.x),
            x1: Math.max(u.x, v.x),
            y0: Math.min(u.y, v.y),
            y1: Math.max(u.y, v.y),
          });
      }
    }
    const times = text
      .filter((t) => /^8:00$/.test(t.str))
      .sort((a, b) => a.x - b.x);
    if (times.length !== 6) {
      warnings.push(`Page ${pageNum}: expected six day columns; skipped.`);
      continue;
    }
    const step = (times[1].cx - times[0].cx) / 6,
      left = times[0].cx - step / 2,
      right = left + 36 * step;
    const rowLines = uniq(
      lines
        .filter(
          (l) =>
            l.x0 < left - 3 &&
            l.x1 > left - 5 &&
            l.x1 - l.x0 > 20 &&
            l.y1 - l.y0 < 0.5,
        )
        .map((l) => l.y0),
    );
    for (const label of labels) {
      let top = rowLines.filter((y) => y < label.y).at(-1),
        bottom = rowLines.find((y) => y > label.y);
      if (top == null || bottom == null) {
        warnings.push(`Cannot locate row for ${label.str}.`);
        continue;
      }
      const section = label.str.replace(/\s+/g, "").toUpperCase();
      sections.add(section);
      const boundaries = uniq([
        left,
        right,
        ...lines
          .filter(
            (l) =>
              l.x1 - l.x0 < 0.5 &&
              l.y0 <= label.y &&
              l.y1 >= label.y &&
              l.x0 >= left - 1 &&
              l.x0 <= right + 1,
          )
          .map((l) => l.x0),
      ]);
      // Snap printed column boundaries to the six-slot grid; merged cells remain merged.
      const columns = [
        ...new Set(
          boundaries.map((x) =>
            Math.max(0, Math.min(36, Math.round((x - left) / step))),
          ),
        ),
      ].sort((a, b) => a - b);
      for (let c = 0; c < columns.length - 1; c++) {
        const col = columns[c],
          endCol = columns[c + 1];
        if (col === 36) continue;
        const x0 = left + col * step,
          x1 = left + endCol * step;
        const parts = text.filter(
          (t) =>
            t.cx > x0 + 0.2 &&
            t.cx < x1 - 0.2 &&
            t.y > top + 0.4 &&
            t.y < bottom - 0.4,
        );
        const rh = bottom - top;
        let subject = join(
          parts.filter((t) => t.y > top + rh * 0.27 && t.y < top + rh * 0.66),
        )
          .replace(/E\.Writin\s+g/g, "E. Writing")
          .replace(/Prob\.\s*Stat/g, "Probability & Statistics");
        if (!subject) continue;
        let upper = join(parts.filter((t) => t.y <= top + rh * 0.27)),
          lower = join(parts.filter((t) => t.y >= top + rh * 0.66));
        if (/ Dr\.$/.test(subject)) {
          subject = subject.replace(/ Dr\.$/, "");
          lower = "Dr. " + lower;
        }
        subject = subject
          .replace(/C\.Netwo\s+rks/g, "C.Networks")
          .replace(/S\.Testin\s+g/g, "S.Testing")
          .replace(/Numeric\s+al/g, "Numerical")
          .replace(/Different\s+ial/g, "Differential")
          .replace(/Compile\s+r/g, "Compiler");
        upper = upper
          .replace(/Mubbash ar Saddiq ue/g, "Mubbashar Saddique")
          .replace(/M\. Noma n/g, "M. Noman");
        lower = lower
          .replace(/Mubbash ar Saddiq ue/g, "Mubbashar Saddique")
          .replace(/M\. Noma n/g, "M. Noman");
        let lab = /lab/i.test(subject),
          room = lab ? lower : upper,
          teacher = lab ? upper : lower;
        if (/\(2hr\)/i.test(subject)) {
          room = lower;
          teacher = upper;
        }
        const day = Math.floor(col / 6),
          slot = col % 6,
          span = Math.min(endCol - col, 6 - slot),
          start = STARTS[slot],
          end = STARTS[slot + span - 1] + 75;
        events.push({
          id: `p${pageNum}-${section}-${col}`,
          section,
          subject,
          teacher,
          room,
          day,
          start,
          end,
          kind: lab ? "Lab" : "Lecture",
          page: pageNum,
          raw: join(parts),
        });
      }
    }
  }
  await pdf.destroy();
  if (!events.length)
    throw new Error(
      "No timetable entries found. Upload the original, text-based semester-wise CS & IT PDF (not a scan).",
    );
  return {
    title,
    events,
    sections: [...sections].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    ),
    warnings,
    pages: pdf.numPages,
  };
}
