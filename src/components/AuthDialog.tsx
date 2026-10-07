import { useState, type FormEvent } from 'react';
import type { AppActions } from '../state/AppStore';
import { Modal, Field, Segmented } from './ui';
import { Icon } from './Icon';

export type AuthMode = 'signin' | 'signup';

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message);
  return 'Something went wrong. Please try again.';
}

export function AuthDialog({
  initialMode = 'signin',
  syncConfigured,
  actions,
  onClose,
}: {
  initialMode?: AuthMode;
  syncConfigured: boolean;
  actions: AppActions;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setNotice('');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      setError('Passwords must be at least 6 characters.');
      return;
    }
    if (mode === 'signup' && password !== confirm) {
      setError('The passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'signin') {
        await actions.signIn(email, password);
        onClose();
      } else {
        await actions.signUp(email, password);
        setNotice('Account created. Check your inbox to confirm your email address, then sign in.');
        setMode('signin');
        setPassword('');
        setConfirm('');
      }
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={mode === 'signin' ? 'Sign in to Bloomora' : 'Create your account'}
      description="An account keeps your notes, sessions and deadlines in sync across your devices. Bloomora works fully offline without one."
      onClose={onClose}
    >
      {!syncConfigured ? (
        <div className="callout callout-warning">
          <Icon name="cloudOff" />
          <div>
            <strong>Accounts are not set up on this deployment</strong>
            <p>Cloud sync needs <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>. Your data is still saved on this device.</p>
          </div>
        </div>
      ) : (
        <form className="authForm" onSubmit={submit} noValidate>
          <Segmented<AuthMode>
            value={mode}
            onChange={(next) => { setMode(next); setError(''); }}
            items={[['signin', 'Sign in'], ['signup', 'Create account']]}
            label="Account action"
          />
          <Field label="Email">
            <input className="input" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@school.ac.uk" />
          </Field>
          <Field label="Password">
            <input
              className="input"
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          {mode === 'signup' && (
            <Field label="Confirm password">
              <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
            </Field>
          )}
          {error && <p className="formError" role="alert">{error}</p>}
          {notice && <p className="formNotice" role="status">{notice}</p>}
          <button className="primaryButton fullWidth" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>
      )}
    </Modal>
  );
}
