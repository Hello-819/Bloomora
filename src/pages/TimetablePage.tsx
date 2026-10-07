import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import type { TimetableEntry } from '../types';
import type { PageProps } from '../components/study';
import { EmptyState, Field, PageHeader, Panel } from '../components/ui';
import { Icon } from '../components/Icon';
import { createId } from '../lib/id';

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function timeSortKey(value: string): number {
  const match = value.match(/(\d{1,2})[:.]?(\d{2})?\s*(am|pm)?/i);
  if (!match) return Number.MAX_SAFE_INTEGER;
  let hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

export function sortTimes<T extends { timeHr: string }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => timeSortKey(a.timeHr) - timeSortKey(b.timeHr) || a.timeHr.localeCompare(b.timeHr));
}

export function TimetablePage({ state, actions }: PageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const entries = state.timetable?.entries || [];
  const [day, setDay] = useState(WEEKDAYS[0]);
  const [time, setTime] = useState('09:00');
  const [module, setModule] = useState('');
  const todayName = WEEKDAYS[(new Date().getDay() + 6) % 7];

  const visibleDays = useMemo(() => {
    const weekend = entries.some((entry) => entry.day === 'Saturday' || entry.day === 'Sunday');
    return weekend ? WEEKDAYS : WEEKDAYS.slice(0, 5);
  }, [entries]);
  const times = useMemo(() => Array.from(new Set(sortTimes(entries).map((entry) => entry.timeHr))), [entries]);

  const handleFileUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (loadEvent) => {
      try {
        const XLSX = await import('xlsx');
        const workbook = XLSX.read(loadEvent.target?.result, { type: 'binary' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
        const imported: TimetableEntry[] = [];
        const headerRowIdx = rows.slice(0, 10).findIndex((row) => row?.some((cell) => typeof cell === 'string' && cell.toLowerCase().includes('monday')));
        if (headerRowIdx !== -1) {
          const headerRow = rows[headerRowIdx];
          const dayColumns: Record<string, number> = {};
          WEEKDAYS.forEach((weekday) => {
            const index = headerRow.findIndex((cell) => typeof cell === 'string' && cell.toLowerCase().includes(weekday.toLowerCase()));
            if (index !== -1) dayColumns[weekday] = index;
          });
          for (const row of rows.slice(headerRowIdx + 1)) {
            if (!row?.length || !row[0]) continue;
            const timeHr = String(row[0]).trim();
            for (const weekday of WEEKDAYS) {
              const cell = dayColumns[weekday] === undefined ? undefined : row[dayColumns[weekday]];
              if (typeof cell === 'string' && cell.trim() && cell.trim() !== '-') {
                imported.push({ id: createId('slot'), day: weekday, timeHr, module: cell.trim() });
              }
            }
          }
        }
        if (imported.length) {
          actions.setTimetable({ entries: imported, updatedAt: new Date().toISOString() });
          actions.notify('Timetable imported', `${imported.length} classes added.`, 'success');
        } else {
          actions.notify('Import failed', 'Could not find a row with weekday headings (Monday, Tuesday…) in the first sheet.', 'danger');
        }
      } catch (error) {
        console.error(error);
        actions.notify('Import failed', 'The spreadsheet could not be read.', 'danger');
      }
    };
    reader.readAsBinaryString(file);
    event.target.value = '';
  };

  return (
    <div className="page">
      <PageHeader
        title="Timetable"
        description="Your weekly lessons, lectures and seminars."
        actions={
          <>
            <input type="file" accept=".xlsx,.xls,.csv" ref={fileInputRef} hidden onChange={handleFileUpload} />
            <button className="secondaryButton" onClick={() => fileInputRef.current?.click()}><Icon name="upload" size={16} /> Import spreadsheet</button>
            {entries.length > 0 && (
              <button className="ghostButton" onClick={() => window.confirm('Remove every entry from your timetable?') && actions.setTimetable({ entries: [], updatedAt: new Date().toISOString() })}>
                Clear
              </button>
            )}
          </>
        }
      />

      <Panel title="Add a class">
        <form
          className="timetableComposer"
          onSubmit={(event) => {
            event.preventDefault();
            actions.addTimetableEntry({ day, timeHr: time, module });
            setModule('');
          }}
        >
          <Field label="Day">
            <select className="input" value={day} onChange={(event) => setDay(event.target.value)}>
              {WEEKDAYS.map((weekday) => <option key={weekday}>{weekday}</option>)}
            </select>
          </Field>
          <Field label="Time">
            <input className="input" value={time} onChange={(event) => setTime(event.target.value)} placeholder="09:00 or 9-11am" />
          </Field>
          <Field label="Class" className="grow">
            <input className="input" value={module} onChange={(event) => setModule(event.target.value)} placeholder="Chemistry · Room S12, or ECON101 Lecture" />
          </Field>
          <button className="primaryButton" disabled={!module.trim()}>Add</button>
        </form>
      </Panel>

      <Panel>
        {entries.length === 0 ? (
          <EmptyState icon="calendar" title="No timetable yet">
            Add classes above, or import a spreadsheet whose first column is the time and whose headings are weekdays.
          </EmptyState>
        ) : (
          <div className="tableScroll">
            <table className="timetable">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  {visibleDays.map((weekday) => (
                    <th scope="col" key={weekday} className={weekday === todayName ? 'isToday' : undefined}>{weekday}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {times.map((slot) => (
                  <tr key={slot}>
                    <th scope="row">{slot}</th>
                    {visibleDays.map((weekday) => {
                      const cells = entries.filter((entry) => entry.timeHr === slot && entry.day === weekday);
                      return (
                        <td key={weekday} className={weekday === todayName ? 'isToday' : undefined}>
                          {cells.map((entry) => (
                            <div className="classBlock" key={entry.id}>
                              <span>{entry.module}</span>
                              <button type="button" className="classRemove" onClick={() => actions.removeTimetableEntry(entry.id)} aria-label={`Remove ${entry.module}`}>
                                <Icon name="x" size={12} />
                              </button>
                            </div>
                          ))}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
