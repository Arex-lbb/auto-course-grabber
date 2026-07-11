import type { CSSProperties, MouseEvent } from 'react';
import {
  formatSegmentInDay,
  getCourseNatureColor,
  isGridPlaceable,
  parseCourseSchedule,
  formatCourseClassTime,
  type ScheduleSegment,
  type WeekdayKey,
} from '../lib/courseDisplay';

export interface TimetableCourse {
  id: string;
  courseName: string;
  courseType: string;
  teacher: string;
  teachId: string;
  classTimeText: string;
  segments: ScheduleSegment[];
  variant?: 'application' | 'grabTask';
  statusText?: string;
  statusColor?: string;
  onRemove?: () => void;
}

const WEEKDAYS: readonly { key: WeekdayKey; label: string }[] = [
  { key: 'monday', label: '周一' }, { key: 'tuesday', label: '周二' },
  { key: 'wednesday', label: '周三' }, { key: 'thursday', label: '周四' },
  { key: 'friday', label: '周五' }, { key: 'saturday', label: '周六' },
  { key: 'sunday', label: '周日' },
];

const PERIOD_COUNT = 12;
const PERIODS = Array.from({ length: PERIOD_COUNT }, (_, i) => i + 1);
const HEADER_H = 38;
const ROW_H = 56;
const LABEL_W = 46;
const LANE_W = 136;

interface PlacedBlock {
  key: string; course: TimetableCourse; segment: ScheduleSegment;
  dayIndex: number; start: number; end: number; lane: number;
}

function buildLayout(courses: TimetableCourse[]) {
  const byDay = new Map<number, { course: TimetableCourse; segment: ScheduleSegment; start: number; end: number }[]>();
  for (const c of courses) {
    for (const s of c.segments) {
      if (!isGridPlaceable(s)) continue;
      const di = WEEKDAYS.findIndex(d => d.key === s.weekday);
      if (di < 0) continue;
      const st = Math.min(PERIOD_COUNT, Math.max(1, s.periodStart as number));
      const en = Math.min(PERIOD_COUNT, Math.max(st, s.periodEnd ?? st));
      const arr = byDay.get(di) ?? [];
      arr.push({ course: c, segment: s, start: st, end: en });
      byDay.set(di, arr);
    }
  }
  const blocks: PlacedBlock[] = [];
  const dayLaneCounts = new Array(WEEKDAYS.length).fill(1);
  for (const [di, items] of byDay) {
    items.sort((a, b) => a.start - b.start || a.end - b.end);
    const laneEnds: number[] = [];
    items.forEach(item => {
      let lane = laneEnds.findIndex(ep => ep < item.start);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(item.end); }
      else { laneEnds[lane] = item.end; }
      blocks.push({ key: `${item.course.id}#${di}#${item.start}-${item.end}#${lane}`, course: item.course, segment: item.segment, dayIndex: di, start: item.start, end: item.end, lane });
    });
    dayLaneCounts[di] = Math.max(1, laneEnds.length);
  }
  return { blocks, dayLaneCounts };
}

// Dark-theme colors
const BG = '#161b22';
const BORDER = '#30363d';
const CELL_BG_ODD = '#1c2128';
const CELL_BG_EVEN = '#161b22';
const HEADER_BG = '#21262d';
const HEADER_FG = '#c9d1d9';
const LABEL_FG = '#8b949e';

function CourseBlock({ block }: { block: PlacedBlock }) {
  const { course } = block;
  const isGrab = course.variant === 'grabTask';
  const accent = getCourseNatureColor(course.courseType);

  const style: CSSProperties = {
    gridColumn: block.dayIndex + 2,
    gridRow: `${block.start + 1} / ${block.end + 2}`,
    width: LANE_W - 6,
    marginLeft: block.lane * LANE_W + 3,
    marginTop: 2, marginBottom: 2,
    justifySelf: 'start', alignSelf: 'stretch',
    position: 'relative', zIndex: isGrab ? 3 : 2, overflow: 'hidden',
    background: isGrab ? 'rgba(210,153,34,0.12)' : 'rgba(47,125,250,0.08)',
    border: `1px solid ${isGrab ? 'rgba(210,153,34,0.3)' : 'rgba(47,125,250,0.2)'}`,
    borderLeft: `3px solid ${accent}`,
    borderRadius: 6, padding: '3px 6px',
    paddingRight: course.onRemove ? 20 : 6,
    fontSize: 11, lineHeight: 1.25,
    display: 'flex', flexDirection: 'column', gap: 1,
    color: '#e6edf3',
    cursor: course.onRemove ? 'pointer' : 'default',
  };

  return (
    <div title={`${course.courseName} ${course.teacher} ${course.classTimeText}`} style={style}>
      {course.onRemove && (
        <button onClick={(e: MouseEvent) => { e.stopPropagation(); course.onRemove?.(); }}
          style={{ position: 'absolute', top: 1, right: 1, width: 18, height: 18, padding: 0, lineHeight: '16px', textAlign: 'center', border: 'none', borderRadius: 4, background: 'rgba(248,81,73,0.2)', color: '#f85149', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
          ×
        </button>
      )}
      <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{course.courseName}</div>
      <div style={{ color: '#58a6ff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{formatSegmentInDay(block.segment)}</div>
      <div style={{ color: '#8b949e', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {course.teacher}
        {isGrab && course.statusText ? <span style={{ color: course.statusColor ?? '#d29922' }}> · {course.statusText}</span> : null}
      </div>
    </div>
  );
}

export function TimetableGrid({ courses }: { courses: TimetableCourse[] }) {
  const { blocks, dayLaneCounts } = buildLayout(courses);
  const cols = `${LABEL_W}px ${dayLaneCounts.map(n => `${n * LANE_W}px`).join(' ')}`;
  const minW = LABEL_W + dayLaneCounts.reduce((s, n) => s + n * LANE_W, 0);

  return (
    <div style={{ overflowX: 'auto', marginTop: 8 }}>
      <div style={{
        display: 'grid', gridTemplateColumns: cols,
        gridTemplateRows: `${HEADER_H}px repeat(${PERIOD_COUNT}, ${ROW_H}px)`,
        border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden', minWidth: minW, background: BG,
      }}>
        <div style={{ ...hdr, gridColumn: 1, gridRow: 1, borderLeft: 'none', fontSize: 12, color: LABEL_FG }}>节次</div>
        {WEEKDAYS.map((d, i) => (
          <div key={d.key} style={{ ...hdr, gridColumn: i + 2, gridRow: 1 }}>{d.label}</div>
        ))}
        {PERIODS.map(p => (
          <div key={`l-${p}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: LABEL_FG, background: HEADER_BG, borderTop: `1px solid ${BORDER}`, gridColumn: 1, gridRow: p + 1 }}>{p}</div>
        ))}
        {WEEKDAYS.map((d, i) => PERIODS.map(p => (
          <div key={`bg-${d.key}-${p}`} style={{ borderLeft: `1px solid ${BORDER}`, borderTop: `1px solid ${BORDER}`, gridColumn: i + 2, gridRow: p + 1, background: i % 2 === 1 ? CELL_BG_ODD : CELL_BG_EVEN }} />
        )))}
        {blocks.map(b => <CourseBlock key={b.key} block={b} />)}
      </div>
    </div>
  );
}

const hdr: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontWeight: 600, fontSize: 13, background: HEADER_BG, color: HEADER_FG,
  borderLeft: `1px solid ${BORDER}`, borderBottom: `1px solid ${BORDER}`,
};

export function TimetableView({ courses, itemLabel = '门课程' }: { courses: TimetableCourse[]; itemLabel?: string }) {
  const apps = courses.filter(c => c.variant !== 'grabTask');
  const grabs = courses.filter(c => c.variant === 'grabTask');
  const placed = courses.reduce((s, c) => s + c.segments.filter(isGridPlaceable).length, 0);
  const unplaced = courses.filter(c => !c.segments.some(isGridPlaceable));

  return (
    <div>
      <p className="hint" style={{ marginTop: 16 }}>
        共 {apps.length} {itemLabel}{grabs.length > 0 ? `,${grabs.length} 门抢课任务` : ''},已排入课表 {placed} 个时段
        {unplaced.length > 0 ? `,${unplaced.length} 门时间待确认` : ''}。
      </p>
      {courses.length > 0 && <TimetableGrid courses={courses} />}
      {unplaced.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <h3 style={{ color: '#e6edf3' }}>时间待确认</h3>
          <p className="hint">以下课程无法解析出具体星期几/节次（常见于课程设计、实训、集中周等）。</p>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>编号</th><th>课程名称</th><th>性质</th><th>教师</th><th>上课时间</th></tr></thead>
              <tbody>
                {unplaced.map(c => (
                  <tr key={c.id}>
                    <td><code>{c.teachId}</code></td>
                    <td>{c.courseName}{c.variant === 'grabTask' && <span style={{ marginLeft: 6, fontSize: 11, color: '#d29922' }}>[抢课]</span>}</td>
                    <td style={{ fontSize: 12 }}>{c.courseType || '-'}</td>
                    <td>{c.teacher}</td>
                    <td style={{ fontSize: 12 }}>{c.classTimeText}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
