# Semester Studio

A warm beige and sage university timetable planner, based on the preset/custom workflow at uol.netlify.app. An independent student tool, not an official University of Lahore service.

## Features

- Includes the supplied Fall 2026 CS & IT semester-wise V1.6 PDF: 70 sections and 827 weekly meetings.
- Import text-based PDFs in the same semester-wise grid format, entirely in the browser with locally bundled PDF.js. Merged cell boundaries preserve lab slot spans. Scan/image OCR is not included.
- Program, semester, and section filters; weekly grid and agenda views.
- Custom timetable builder combines course meetings across sections; manual class editing, removals, and personal blocks.
- Clash detection; generate a requested number of clash-free alternatives. Subject lecture/lab meetings stay in the same section. Searches stop after 500,000 nodes and explicitly report exhaustion or the search limit.
- Save any number of section or custom schedules, subject to browser storage capacity; save multiple sections at once.
- PNG, PDF, CSV, schedule JSON, and weekly recurring iCalendar export with Asia/Karachi timezone and selected semester date range.
- Schedule JSON import for backup and transfer. Saved schedules and custom drafts use localStorage; imported source PDFs use IndexedDB.

## Run

Serve `dist/` with any static HTTP server. No build step or API keys are required. For example, run `python3 -m http.server 8000 --directory dist` and open localhost:8000. Opening `index.html` via file:// is not supported because ES modules and fetch require HTTP.

## Files

- `dist/app.mjs`: UI interactions, local persistence, imports and exports.
- `dist/parser.mjs`: geometric PDF grid parser and clash detector.
- `dist/scheduling.mjs`: course grouping, alternatives, CSV and iCalendar.
- `dist/exports.mjs`: canvas timetable rendering and PDF serialization.
- `dist/dataset.json`: parsed supplied source PDF.
- `dist/source-timetable.pdf`: supplied sample and source review link.
- `dist/vendor/`: PDF.js and its worker, licensed under Apache 2.0.

The importer intentionally targets the supplied semester-wise grid. A changed document layout can require parser changes. Class durations follow printed slots, including merged lab cells. Verify schedule changes against the department's official PDF.

## Validation

Verified PDF coverage against an independent text extraction: all 70 section labels included. Tested 827 meeting IDs and bounds, merged labs, wrapped subject normalization, clash detection, complete lecture/lab groupings in five generated alternatives, CSV records and iCalendar recurrence. Generated and visually inspected a PNG and verified the exported one-page PDF. DOM interaction checks passed for initial loading, section filters, course toggles, customization, manual classes, save/open, week/list views, class editing, batch section saving, and generation of two saved alternatives. Live browser layout QA was unavailable in the managed environment.
