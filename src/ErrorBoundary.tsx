import { Component, type ErrorInfo, type ReactNode } from 'react';
import { getSupabaseClient, signOut } from './lib/supabaseSync';

interface ErrorBoundaryState {
  error?: Error;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Bloomora render failed', error, info);
  }

  async signOutAndRefresh() {
    try {
      const client = getSupabaseClient();
      if (client) await signOut(client);
      for (let i = localStorage.length - 1; i >= 0; i -= 1) {
        const key = localStorage.key(i);
        if (key?.startsWith('sb-') && key.includes('auth-token')) localStorage.removeItem(key);
      }
    } catch (error) {
      console.warn('Sign out from error screen failed', error);
    } finally {
      window.location.reload();
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="crashScreen">
        <div className="brandMark">B</div>
        <h1>Bloomora hit a display error.</h1>
        <p>
          Your local study data is still stored in this browser. Refresh the page; if this happened
          after sync, sign out and run the latest Supabase V2 SQL.
        </p>
        <pre>{this.state.error.message}</pre>
        <button className="primaryButton" onClick={() => window.location.reload()}>
          Refresh Bloomora
        </button>
        <button className="secondaryButton" onClick={() => void this.signOutAndRefresh()}>
          Sign out and refresh
        </button>
      </main>
    );
  }
}
