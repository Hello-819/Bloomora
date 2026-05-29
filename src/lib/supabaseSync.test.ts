import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { legacyLabelForTest, legacySessionForTest } from './supabaseSync';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ dummyClient: true })),
}));

describe('Supabase Client Configuration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('isSupabaseConfigured returns true when url and key are provided', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://localhost');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'my-key');
    const { isSupabaseConfigured } = await import('./supabaseSync');
    expect(isSupabaseConfigured()).toBe(true);
  });

  it('isSupabaseConfigured returns false when url is missing', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'my-key');
    const { isSupabaseConfigured } = await import('./supabaseSync');
    expect(isSupabaseConfigured()).toBe(false);
  });

  it('isSupabaseConfigured returns false when key is missing', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://localhost');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    const { isSupabaseConfigured } = await import('./supabaseSync');
    expect(isSupabaseConfigured()).toBe(false);
  });

  it('getSupabaseClient returns null when not configured', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    const { getSupabaseClient } = await import('./supabaseSync');
    expect(getSupabaseClient()).toBeNull();
  });

  it('getSupabaseClient returns client and uses singleton', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://localhost');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'my-key');
    const supabase = await import('@supabase/supabase-js');
    const { getSupabaseClient } = await import('./supabaseSync');

    const client1 = getSupabaseClient();
    expect(client1).toEqual({ dummyClient: true });
    expect(supabase.createClient).toHaveBeenCalledWith('http://localhost', 'my-key', expect.any(Object));
    expect(supabase.createClient).toHaveBeenCalledTimes(1);

    const client2 = getSupabaseClient();
    expect(client2).toBe(client1);
    // Should not call createClient again
    expect(supabase.createClient).toHaveBeenCalledTimes(1);
  });
});

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
