import { describe, expect, it } from 'vitest';
import { legacyLabelForTest, legacySessionForTest } from './supabaseSync';

describe('legacy Supabase conversion', () => {
  it('maps v1 labels and sessions into the v2 shape', () => {
    const label = legacyLabelForTest({
      local_id: 'lbl_math',
      name: 'Maths',
      color: '#2563eb',
      favorite: true,
      created_ts: '2026-01-01T10:00:00.000Z',
      updated_at: '2026-01-02T10:00:00.000Z',
    });
    const session = legacySessionForTest(
      {
        client_id: 'old_session_1',
        started_at: '2026-01-03T10:00:00.000Z',
        ended_at: '2026-01-03T10:30:00.000Z',
        duration_sec: 1800,
        label_name: 'Maths',
        source: 'timer',
        reward_mode: 'garden',
      },
      new Map([[label.name.toLowerCase(), label]]),
    );

    expect(label).toMatchObject({ id: 'lbl_math', name: 'Maths', favorite: true });
    expect(session).toMatchObject({
      id: 'old_session_1',
      durationSec: 1800,
      method: 'timer',
      rewardMode: 'garden',
      labelId: 'lbl_math',
      labelNameSnapshot: 'Maths',
    });
  });
});
