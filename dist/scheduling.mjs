import {findClashes,DAYS,fmt} from './parser.mjs';
export const baseSubject=s=>{let base=s.replace(/\s*\((?:lab|2hr)\)\s*/ig,'').trim().toLowerCase();return ({'c.networks':'cn','c.netwo rks':'cn'})[base]||base;};
export function groupCourses(events){const groups=new Map();for(const e of events){const key=`${e.section}|${e.subject.toLowerCase()}`;if(!groups.has(key))groups.set(key,{key,section:e.section,subject:e.subject,events:[]});groups.get(key).events.push(e);}return [...groups.values()];}
export async function generateAlternatives(dataset,selected,count,onProgress=()=>{}){
 const bases=[...new Set(selected.filter(e=>e.kind!=='Personal').map(e=>baseSubject(e.subject)))];
 if(!bases.length)throw new Error('Add at least one course to the custom timetable first.');
 const fixed=selected.filter(e=>e.kind==='Personal');if(findClashes(fixed).length)throw new Error('Your personal classes overlap. Resolve those clashes first.');
 const selectedPrograms=new Set(selected.filter(e=>e.kind!=='Personal').map(e=>e.section.match(/^[A-Z]+/)?.[0]));
 let options=bases.map(base=>{let groups=new Map();for(const e of dataset.filter(e=>baseSubject(e.subject)===base&&selectedPrograms.has(e.section.match(/^[A-Z]+/)?.[0]))){if(!groups.has(e.section))groups.set(e.section,[]);groups.get(e.section).push(e);}return [...groups.values()].filter(group=>!findClashes(group).length);}).sort((a,b)=>a.length-b.length);
 if(options.some(a=>!a.length))return {plans:[],exhausted:true,visited:0};
 let plans=[],visited=0,limited=false;const limit=500000;
 async function search(index,current){if(plans.length>=count||limited)return;if(++visited>limit){limited=true;return;}if(visited%1000===0){onProgress(visited,plans.length);await new Promise(r=>setTimeout(r,0));}if(index===options.length){plans.push(current);return;}for(const group of options[index]){if(group.some(e=>current.some(c=>e.day===c.day&&e.start<c.end&&c.start<e.end)))continue;await search(index+1,[...current,...group]);if(plans.length>=count||limited)return;}}
 await search(0,fixed);return {plans,exhausted:plans.length<count&&!limited,limited,visited};
}
export function ics(events,name,startDate,endDate){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate)||!/^\d{4}-\d{2}-\d{2}$/.test(endDate)||endDate<startDate)throw new Error('Choose a valid semester date range.');
 const esc=s=>String(s).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
 const dateString=d=>d.toISOString().slice(0,10).replaceAll('-','');const stamp=new Date().toISOString().replace(/[-:]/g,'').split('.')[0]+'Z';
 const out=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Semester Studio//UOL Timetables//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH',`X-WR-CALNAME:${esc(name)}`,'X-WR-TIMEZONE:Asia/Karachi','BEGIN:VTIMEZONE','TZID:Asia/Karachi','BEGIN:STANDARD','DTSTART:19700101T000000','TZOFFSETFROM:+0500','TZOFFSETTO:+0500','TZNAME:PKT','END:STANDARD','END:VTIMEZONE'];
 for(const e of events){let d=new Date(startDate+'T00:00:00Z');let weekday=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()+(e.day-weekday+7)%7);if(d.toISOString().slice(0,10)>endDate)continue;const ds=dateString(d),time=m=>fmt(m).replace(':','')+'00';out.push('BEGIN:VEVENT',`UID:${esc(e.id)}-${ds}@semester-studio.local`,`DTSTAMP:${stamp}`,`DTSTART;TZID=Asia/Karachi:${ds}T${time(e.start)}`,`DTEND;TZID=Asia/Karachi:${ds}T${time(e.end)}`,`RRULE:FREQ=WEEKLY;UNTIL=${endDate.replaceAll('-','')}T185959Z`,`SUMMARY:${esc(e.subject)}`,`LOCATION:${esc(e.room||'')}`,`DESCRIPTION:${esc([e.section,e.teacher].filter(Boolean).join(' · '))}`,'END:VEVENT');}out.push('END:VCALENDAR');
 // Fold UTF-8 lines at 75 octets without cutting a code point.
 return out.map(l=>{let line='',result=[],bytes=0;for(const c of l){const n=new TextEncoder().encode(c).length;if(bytes+n>74){result.push(line);line=' ';bytes=1;}line+=c;bytes+=n;}result.push(line);return result.join('\r\n');}).join('\r\n')+'\r\n';
}
export function csv(events){const q=x=>'"'+String(x??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';return '\uFEFF'+[['Subject','Section','Day','Start','End','Instructor','Room','Type'],...events.map(e=>[e.subject,e.section,DAYS[e.day],fmt(e.start),fmt(e.end),e.teacher,e.room,e.kind])].map(r=>r.map(q).join(',')).join('\r\n');}
