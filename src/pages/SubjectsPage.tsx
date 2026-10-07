import { useState } from 'react';
import type { StudySubject } from '../types';
import type { PageProps } from '../components/study';
import { Badge, EmptyState, Field, Modal, PageHeader, Panel } from '../components/ui';
import { Icon } from '../components/Icon';
import { daysUntil, relativeDays, subjectNoun, visibleAssessments, visibleDeadlines, visibleFlashcards, visibleSubjects } from '../lib/selectors';
import { weightedAverage } from '../lib/grades';

type SubjectDraft = Pick<StudySubject, 'name' | 'qualification' | 'examBoard' | 'targetGrade' | 'examDate'>;

const EMPTY: SubjectDraft = { name: '', qualification: '', examBoard: '', targetGrade: '', examDate: '' };

function qualificationHint(level: string): string {
  if (level === 'university' || level === 'postgraduate') return 'e.g. BSc Economics, Year 2 module';
  if (level === 'college') return 'e.g. BTEC Level 3, T Level, Access';
  return 'e.g. A level, IB HL, AS';
}

function SubjectDialog({ initial, noun, level, onSave, onClose }: { initial: SubjectDraft; noun: string; level: string; onSave: (draft: SubjectDraft) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(initial);
  const isoDate = /^\d{4}-\d{2}-\d{2}$/.test(draft.examDate) ? draft.examDate : '';
  const university = level === 'university' || level === 'postgraduate';
  return (
    <Modal title={initial.name ? `Edit ${noun}` : `Add a ${noun}`} onClose={onClose} width={520}>
      <form className="stack" onSubmit={(event) => { event.preventDefault(); onSave(draft); }}>
        <Field label="Name">
          <input className="input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder={university ? 'ECON2001 Intermediate Microeconomics' : 'Biology'} />
        </Field>
        <div className="formGrid">
          <Field label={university ? 'Course / level' : 'Qualification'}>
            <input className="input" value={draft.qualification} onChange={(event) => setDraft({ ...draft, qualification: event.target.value })} placeholder={qualificationHint(level)} />
          </Field>
          <Field label={university ? 'Module leader / department' : 'Exam board'}>
            <input className="input" value={draft.examBoard} onChange={(event) => setDraft({ ...draft, examBoard: event.target.value })} placeholder={university ? 'School of Economics' : 'AQA, OCR, Edexcel, WJEC…'} />
          </Field>
          <Field label="Target grade">
            <input className="input" value={draft.targetGrade} onChange={(event) => setDraft({ ...draft, targetGrade: event.target.value })} placeholder={university ? '70%' : 'A*'} />
          </Field>
          <Field label="Exam date" hint={draft.examDate && !isoDate ? `Currently “${draft.examDate}”` : undefined}>
            <input className="input" type="date" value={isoDate} onChange={(event) => setDraft({ ...draft, examDate: event.target.value })} />
          </Field>
        </div>
        <div className="buttonRow end">
          <button type="button" className="ghostButton" onClick={onClose}>Cancel</button>
          <button className="primaryButton" disabled={!draft.name.trim()}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

export function SubjectsPage({ state, actions, navigate }: PageProps) {
  const subjects = visibleSubjects(state);
  const level = state.profile.educationLevel;
  const noun = subjectNoun(level);
  const plural = subjectNoun(level, true);
  const [editing, setEditing] = useState<StudySubject | 'new' | null>(null);
  const deadlines = visibleDeadlines(state);
  const assessments = visibleAssessments(state);
  const cards = visibleFlashcards(state);

  return (
    <div className="page">
      <PageHeader
        title={plural[0].toUpperCase() + plural.slice(1)}
        description={`Your ${plural}, exam dates and targets. The AI tutor tailors its answers to the active ${noun}.`}
        actions={<button className="primaryButton" onClick={() => setEditing('new')}><Icon name="plus" size={16} /> Add {noun}</button>}
      />
      {subjects.length === 0 ? (
        <Panel>
          <EmptyState icon="book" title={`No ${plural} yet`} action={<button className="secondaryButton" onClick={() => setEditing('new')}>Add your first {noun}</button>}>
            Add each {noun} once. Deadlines, grades and flashcards can then be filed under it.
          </EmptyState>
        </Panel>
      ) : (
        <div className="subjectGrid">
          {subjects.map((subject) => {
            const days = daysUntil(subject.examDate);
            const subjectDeadlines = deadlines.filter((item) => item.subjectId === subject.id && item.status !== 'submitted');
            const average = weightedAverage(assessments.filter((item) => item.subjectId === subject.id));
            const cardCount = cards.filter((card) => card.subjectId === subject.id).length;
            const active = state.profile.aiTutor.activeSubjectId === subject.id;
            return (
              <article className={active ? 'subjectCard subjectCardActive' : 'subjectCard'} key={subject.id}>
                <div className="subjectCardHeader">
                  <div>
                    <h3>{subject.name}</h3>
                    <span>{[subject.qualification, subject.examBoard].filter(Boolean).join(' · ') || 'No details yet'}</span>
                  </div>
                  {active && <Badge tone="accent">Active</Badge>}
                </div>
                <dl className="subjectStats">
                  <div><dt>Exam</dt><dd>{subject.examDate ? (days !== null ? relativeDays(days) : subject.examDate) : '—'}</dd></div>
                  <div><dt>Target</dt><dd>{subject.targetGrade || '—'}</dd></div>
                  <div><dt>Average</dt><dd>{average === null ? '—' : `${average.toFixed(1)}%`}</dd></div>
                  <div><dt>Due</dt><dd>{subjectDeadlines.length}</dd></div>
                  <div><dt>Cards</dt><dd>{cardCount}</dd></div>
                </dl>
                <div className="subjectActions">
                  {!active && <button className="textButton" onClick={() => actions.setActiveSubject(subject.id)}>Set active</button>}
                  <button className="textButton" onClick={() => navigate('grades')}>Grades</button>
                  <button className="textButton" onClick={() => setEditing(subject)}>Edit</button>
                  <button className="textButton dangerText" onClick={() => actions.deleteSubject(subject.id)}>Archive</button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {editing && (
        <SubjectDialog
          initial={editing === 'new' ? EMPTY : { name: editing.name, qualification: editing.qualification, examBoard: editing.examBoard, targetGrade: editing.targetGrade, examDate: editing.examDate }}
          noun={noun}
          level={level}
          onClose={() => setEditing(null)}
          onSave={(draft) => {
            if (editing === 'new') actions.createSubject(draft);
            else actions.updateSubject(editing.id, draft);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
