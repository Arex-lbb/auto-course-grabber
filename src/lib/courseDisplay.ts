export type WeekdayKey = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

const TIME_FIELDS = ['scheduleTime', 'classTime', 'courseTime', 'teachingTime', 'classTimePlace', 'timeText', 'schedule'] as const;

const WEEKDAY_PATTERNS: readonly [WeekdayKey, RegExp][] = [
  ['monday', /周一|星期一|礼拜一|周1|Monday|Mon\b/i],
  ['tuesday', /周二|星期二|礼拜二|周2|Tuesday|Tue\b/i],
  ['wednesday', /周三|星期三|礼拜三|周3|Wednesday|Wed\b/i],
  ['thursday', /周四|星期四|礼拜四|周4|Thursday|Thu\b/i],
  ['friday', /周五|星期五|礼拜五|周5|Friday|Fri\b/i],
  ['saturday', /周六|星期六|礼拜六|周6|Saturday|Sat\b/i],
  ['sunday', /周日|周天|星期日|星期天|礼拜日|礼拜天|周7|Sunday|Sun\b/i],
];

const WEEKS_RE = /(\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)\s*周/;
const PERIOD_RE = /第?\s*(\d+)(?:\s*-\s*(\d+))?\s*节/;

export interface ScheduleSegment {
  raw: string;
  weeksText: string | null;
  weekday: WeekdayKey | null;
  periodStart: number | null;
  periodEnd: number | null;
  periodText: string | null;
}

function formatScalar(value: unknown): string | null {
  if (typeof value === 'string') { const t = value.trim(); return t === '' ? null : t; }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

export function getRawClassTime(course: Record<string, unknown>): string {
  for (const field of TIME_FIELDS) {
    const v = formatScalar(course[field]);
    if (v !== null) return v;
  }
  return '';
}

export function formatCourseClassTime(course: Record<string, unknown>): string {
  return getRawClassTime(course) || '-';
}

export function formatCourseNature(course: Record<string, unknown>): string {
  return formatScalar(course['courseType']) ?? '-';
}

export function getCourseNatureColor(nature: string): string {
  if (nature.includes('必修')) return '#c0392b';
  if (nature.includes('限选')) return '#d48806';
  if (nature.includes('任选') || nature.includes('选修')) return '#2f7dfa';
  return '#8b949e';
}

function detectWeekday(text: string): WeekdayKey | null {
  for (const [weekday, pattern] of WEEKDAY_PATTERNS) {
    if (pattern.test(text)) return weekday;
  }
  return null;
}

function parseOneSegment(raw: string): ScheduleSegment {
  const weeksMatch = raw.match(WEEKS_RE);
  const weeksText = weeksMatch ? `${weeksMatch[1]}周` : null;
  const weekday = detectWeekday(raw);
  const periodMatch = raw.match(PERIOD_RE);
  let periodStart: number | null = null, periodEnd: number | null = null, periodText: string | null = null;
  if (periodMatch) {
    periodStart = Number(periodMatch[1]);
    periodEnd = periodMatch[2] ? Number(periodMatch[2]) : periodStart;
    periodText = periodStart === periodEnd ? `${periodStart}节` : `${periodStart}-${periodEnd}节`;
  }
  return { raw: raw.trim(), weeksText, weekday, periodStart, periodEnd, periodText };
}

export function parseScheduleText(text: string): ScheduleSegment[] {
  const trimmed = (text ?? '').trim();
  if (trimmed === '' || trimmed === '-') return [];
  const parts = trimmed.split(/[;；\n]+/).map(s => s.trim()).filter(Boolean);
  return (parts.length > 0 ? parts : [trimmed]).map(parseOneSegment);
}

export function parseCourseSchedule(course: Record<string, unknown>): ScheduleSegment[] {
  return parseScheduleText(formatCourseClassTime(course));
}

export function isGridPlaceable(segment: ScheduleSegment): boolean {
  return segment.weekday !== null && segment.periodStart !== null;
}

export function formatSegmentInDay(segment: ScheduleSegment): string {
  const parts = [segment.weeksText, segment.periodText].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : segment.raw || '时间待定';
}
