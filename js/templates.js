// Generic trainings ("templates"): a training doc with `template: true` and a `frame` (type of
// unit/course). Its days carry placeholder dates (2000-01-01, -02, ...) and are shown as "יום N".
// fitTemplate() lays a template onto a different number of days:
//  - same number of days: exact copy
//  - meals/breaks are the day's frame: day 1 uses template day 1, the last day uses the template's
//    last day, middle days use a typical middle day (template day 2)
//  - everything else is content, kept in order; the template's last-day content goes on the last day
//  - fewer days: durations shrink toward each lesson's minimum, what still doesn't fit is returned
//    as `unscheduled` for manual placement
//  - more days: content is spread evenly over the days at (at least) its ideal duration
import { data } from './store.js';
import { addDays, snap, DAY_START, DAY_END } from './util.js';

export const TEMPLATE_BASE_DATE = '2000-01-01';
export const isTemplate = (t) => !!t?.template;
export const templateDate = (i) => addDays(TEMPLATE_BASE_DATE, i);

const FRAME_TYPES = new Set(['meal', 'break']);
const isFrame = (b) => FRAME_TYPES.has(b.type);
const sortDays = (t) => [...t.days].sort((a, b) => a.date.localeCompare(b.date));
const strip = ({ id, dayId, start, ...rest }) => rest;

export function templateStats(t) {
  const content = t.blocks.filter((b) => b.type === 'lesson');
  return { days: t.days.length, lessons: content.length, minutes: content.reduce((s, b) => s + b.duration, 0) };
}

/**
 * @returns {{ days: Array<Array<block>>, unscheduled: Array<block> }}
 *   days[k] = blocks for target day k (with start/duration, no id/dayId)
 */
export function fitTemplate(tpl, M) {
  const tdays = sortDays(tpl);
  const N = tdays.length;
  const byDay = tdays.map((d) => tpl.blocks.filter((b) => b.dayId === d.id).sort((a, b) => a.start - b.start));
  if (!N || M < 1) return { days: Array.from({ length: Math.max(M, 0) }, () => []), unscheduled: [] };
  if (M === N) return { days: byDay.map((list) => list.map((b) => ({ ...strip(b), start: b.start, duration: b.duration }))), unscheduled: [] };

  // which template day gives each target day its frame (meals, breaks) and working hours
  const pattern = (k) => (k === 0 ? 0 : k === M - 1 ? N - 1 : N >= 3 ? 1 : 0);
  const days = Array.from({ length: M }, (_, k) => {
    const src = byDay[pattern(k)];
    const ws = src.length ? Math.min(...src.map((b) => b.start)) : 8 * 60;
    const we = src.length ? Math.max(...src.map((b) => b.start + b.duration)) : 17 * 60;
    const frames = src.filter(isFrame).map((b) => ({ ...strip(b), start: b.start, duration: b.duration }));
    return { ws: Math.max(DAY_START, ws), we: Math.min(DAY_END, we), blocks: [...frames], cursor: Math.max(DAY_START, ws) };
  });

  // Content items in template order. Blocks that overlap in the template (parallel tracks, e.g.
  // two groups in separate lessons at the same time) form one item and stay side by side.
  const items = [];
  byDay.forEach((list, i) => {
    let cur = null;
    for (const b of list.filter((x) => !isFrame(x))) {
      if (cur && b.start < cur.end) { cur.members.push(b); cur.end = Math.max(cur.end, b.start + b.duration); continue; }
      cur = { start: b.start, end: b.start + b.duration, members: [b], fromDay: i };
      items.push(cur);
    }
  });
  for (const x of items) {
    x.members = x.members.map((b) => {
      const l = b.type === 'lesson' ? data.lessons.get(b.lessonId) : null;
      const base = b.duration;
      return {
        block: strip(b), off: b.start - x.start, base,
        min: l ? Math.min(l.min, base) : base,
        up: l ? Math.min(Math.max(l.max, base), Math.max(base, l.ideal)) : base, // "ideal" length when stretching
      };
    });
  }
  const span = (x, durOf) => Math.max(...x.members.map((m) => m.off + durOf(m)));
  const setDurations = (x, durOf) => { for (const m of x.members) m.dur = durOf(m); x.dur = span(x, (m) => m.dur); };

  const freeMinutes = (d) => {
    const busy = d.blocks.filter((b) => b.start < d.we && b.start + b.duration > d.ws)
      .reduce((s, b) => s + Math.min(d.we, b.start + b.duration) - Math.max(d.ws, b.start), 0);
    return Math.max(0, d.we - d.ws - busy);
  };

  const findSlot = (d, dur) => {
    const cands = [d.cursor, ...d.blocks.map((b) => b.start + b.duration)].filter((t) => t >= d.cursor).sort((a, b) => a - b);
    for (const t of cands) {
      if (t + dur > d.we) continue;
      if (d.blocks.every((b) => t + dur <= b.start || t >= b.start + b.duration)) return t;
    }
    return null;
  };

  const unscheduledItems = [];
  const pack = (group, targets) => {
    if (!group.length) return;
    const total = (durOf) => group.reduce((s, x) => s + span(x, durOf), 0);
    const cap = targets.reduce((s, k) => s + freeMinutes(days[k]), 0);
    // more days: lengthen toward ideal only if it still fits; otherwise template length; otherwise shrink
    let fits = true;
    if (M > N && total((m) => m.up) <= cap) group.forEach((x) => setDurations(x, (m) => m.up));
    else if (total((m) => m.base) <= cap) group.forEach((x) => setDurations(x, (m) => m.base));
    else {
      fits = false;
      const need = total((m) => m.base), needMin = total((m) => m.min);
      const f = need > needMin ? Math.min(1, (need - cap) / (need - needMin)) : 0;
      group.forEach((x) => setDurations(x, (m) => Math.max(m.min, snap(m.base - (m.base - m.min) * f))));
    }
    if (!targets.length) { unscheduledItems.push(...group); return; }
    let di = 0, used = 0;
    let remaining = group.reduce((s, x) => s + x.dur, 0);
    let quota = fits ? remaining / targets.length : Infinity;
    for (const x of group) {
      let placed = false;
      while (di < targets.length) {
        const d = days[targets[di]];
        // when there's room, move on once today has its fair share (keeps days balanced)
        const full = fits && used > 0 && used + x.dur / 2 > quota && di < targets.length - 1;
        const at = full ? null : findSlot(d, x.dur);
        if (at != null) {
          for (const m of x.members) d.blocks.push({ ...m.block, start: at + m.off, duration: m.dur });
          d.cursor = at + x.dur;
          used += x.dur; remaining -= x.dur; placed = true;
          break;
        }
        di++; used = 0;
        if (fits && di < targets.length) quota = remaining / (targets.length - di);
      }
      if (!placed) unscheduledItems.push(x);
    }
  };

  const allIdx = days.map((_, k) => k);
  if (M >= 2 && N >= 2) {
    pack(items.filter((x) => x.fromDay < N - 1), allIdx.slice(0, -1));
    pack(items.filter((x) => x.fromDay === N - 1), [M - 1]);
  } else {
    pack(items, allIdx);
  }

  return {
    days: days.map((d) => d.blocks.sort((a, b) => a.start - b.start)),
    unscheduled: unscheduledItems.flatMap((x) => x.members.map((m) => ({ ...m.block, duration: m.dur ?? m.base }))),
  };
}
