import { DAYS, STARTS, fmt, findClashes } from "./parser.mjs";
export function drawSchedule(canvas, events, title, subtitle) {
  canvas.width = 2400;
  canvas.height = 1500;
  const c = canvas.getContext("2d");
  c.fillStyle = "#f7f5ef";
  c.fillRect(0, 0, 2400, 1500);
  c.fillStyle = "#778567";
  c.font = "24px sans-serif";
  c.fillText("SEMESTER STUDIO", 65, 65);
  c.fillStyle = "#35412e";
  c.font = "48px Georgia";
  c.fillText(title.slice(0, 70), 65, 130);
  c.fillStyle = "#909980";
  c.font = "22px sans-serif";
  c.fillText(subtitle.slice(0, 150), 65, 175);
  const x = 150,
    y = 280,
    w = 365,
    h = 177;
  const colors = {
    Lecture: ["#edf1e6", "#9aab86"],
    Lab: ["#f7ece2", "#c6a086"],
    Personal: ["#f3ecd5", "#b6a669"],
  };
  c.font = "25px sans-serif";
  DAYS.forEach((d, i) => {
    c.fillStyle = "#778468";
    c.fillText(d, x + i * w + 20, y - 35);
  });
  STARTS.forEach((t, i) => {
    c.fillStyle = "#969f86";
    c.font = "21px sans-serif";
    c.fillText(fmt(t), 50, y + i * h + 30);
  });
  c.strokeStyle = "#e1e6d8";
  for (let i = 0; i <= 6; i++) {
    c.beginPath();
    c.moveTo(x, y + i * h);
    c.lineTo(x + 6 * w, y + i * h);
    c.stroke();
    c.beginPath();
    c.moveTo(x + i * w, y);
    c.lineTo(x + i * w, y + 6 * h);
    c.stroke();
  }
  function wrap(text, width, maxLines = 2) {
    let words = text.split(/\s+/),
      lines = [],
      line = "";
    for (let word of words) {
      if (c.measureText((line + " " + word).trim()).width > width && line) {
        lines.push(line);
        line = word;
      } else line = (line + " " + word).trim();
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      while (
        c.measureText(lines.at(-1) + "…").width > width &&
        lines.at(-1).length
      )
        lines[lines.length - 1] = lines.at(-1).slice(0, -1);
      lines[lines.length - 1] += "…";
    }
    return lines;
  }
  const clashes = new Set(
    findClashes(events)
      .flat()
      .map((e) => e.id),
  );
  for (const e of events) {
    const overlapping = events
      .filter((o) => o.day === e.day && o.start < e.end && e.start < o.end)
      .sort((a, b) => a.id.localeCompare(b.id));
    const lanes = overlapping.length,
      lane = overlapping.findIndex((o) => o.id === e.id),
      cw = (w - 16) / lanes;
    let ex = x + e.day * w + 8 + lane * cw,
      ey = y + ((e.start - 480) / 90) * h + 5,
      eh = ((e.end - e.start) / 90) * h - 10;
    const color = colors[e.kind] || colors.Lecture;
    c.fillStyle = color[0];
    c.beginPath();
    c.roundRect(ex, ey, cw - 3, eh, 10);
    c.fill();
    c.fillStyle = clashes.has(e.id) ? "#c06d4b" : color[1];
    c.fillRect(ex, ey + 8, 5, eh - 16);
    const pad = 17,
      tw = cw - pad * 2;
    c.fillStyle = "#44523a";
    c.font = "bold 24px sans-serif";
    let lines = wrap(e.subject, tw, 2),
      ty = ey + 32;
    for (const line of lines) {
      c.fillText(line, ex + pad, ty);
      ty += 29;
    }
    c.font = "19px sans-serif";
    c.fillStyle = "#849171";
    c.fillText(`${fmt(e.start)} - ${fmt(e.end)}`, ex + pad, ty + 3);
    c.font = "20px sans-serif";
    let ry = ty + 35;
    for (const line of wrap(e.room || "", tw, 1)) {
      c.fillText(line, ex + pad, ry);
      ry += 25;
    }
    c.font = "18px sans-serif";
    if (ry < ey + eh - 15)
      for (const line of wrap(e.teacher || e.section, tw, 2)) {
        if (ry < ey + eh - 8) c.fillText(line, ex + pad, ry);
        ry += 23;
      }
  }
  c.font = "19px sans-serif";
  c.fillStyle = "#9ba58b";
  c.fillText(
    "All times in Asia/Karachi (PKT) · Verify changes against your department’s official timetable.",
    65,
    1430,
  );
  return canvas;
}
export function canvasPDF(canvas) {
  const bytes = Uint8Array.from(
    atob(canvas.toDataURL("image/jpeg", 0.94).split(",")[1]),
    (c) => c.charCodeAt(0),
  );
  const enc = new TextEncoder();
  let chunks = [],
    offset = 0,
    offsets = [0];
  const push = (x) => {
    let b = typeof x === "string" ? enc.encode(x) : x;
    chunks.push(b);
    offset += b.length;
  };
  push("%PDF-1.4\n");
  const obj = (n, s) => {
    offsets[n] = offset;
    push(`${n} 0 obj\n${s}\nendobj\n`);
  };
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  obj(
    3,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 960 600] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>",
  );
  offsets[4] = offset;
  push(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`,
  );
  push(bytes);
  push("\nendstream\nendobj\n");
  const stream = "q 960 0 0 600 0 0 cm /Im0 Do Q";
  obj(5, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  let start = offset;
  push("xref\n0 6\n0000000000 65535 f \n");
  for (let i = 1; i <= 5; i++)
    push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`);
  const result = new Uint8Array(offset);
  let at = 0;
  for (const ch of chunks) {
    result.set(ch, at);
    at += ch.length;
  }
  return result;
}
