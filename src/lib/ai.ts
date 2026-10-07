import type { AppState, StudySubject } from '../types';
import { educationLabel } from './selectors';
import { isNativeApp, nativeHttp } from './native';

/** Where the Android app reaches the AI route; the web build uses its own origin. */
const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') || 'https://bloomora.pages.dev';

export type ChatMessage = { role: 'user' | 'assistant'; content: string };
type AiApiResponse = { reply?: string; error?: string; model?: string; usage?: unknown };

function parseAiResponse(status: number, statusText: string, text: string): AiApiResponse {
  const ok = status >= 200 && status < 300;
  if (!text.trim()) {
    return {
      error: ok
        ? 'The AI route returned an empty response.'
        : `The AI route returned ${status} ${statusText || 'without a response body'}.`,
    };
  }
  try {
    return JSON.parse(text) as AiApiResponse;
  } catch {
    return { error: text.slice(0, 300) || 'The AI route returned a non-JSON response.' };
  }
}

export function aiProfile(state: AppState, subject?: StudySubject) {
  return {
    displayName: state.profile.displayName,
    educationLevel: educationLabel(state.profile.educationLevel),
    institution: state.profile.institution,
    course: state.profile.course,
    yearOfStudy: state.profile.yearOfStudy,
    qualification: subject?.qualification || '',
    examBoard: subject?.examBoard || '',
    subject: subject?.name || '',
    targetGrade: subject?.targetGrade || '',
    examDate: subject?.examDate || '',
  };
}

/** Sends a chat request to the AI route and returns the reply text, throwing on failure. */
export async function askAi(body: { messages: ChatMessage[]; profile: ReturnType<typeof aiProfile>; context?: Record<string, unknown> }): Promise<string> {
  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${import.meta.env.VITE_API_AUTH_TOKEN}`,
  };
  let data: AiApiResponse;
  if (isNativeApp()) {
    const result = await nativeHttp(`${API_BASE}/api/ai-chat`, { method: 'POST', headers, body: JSON.stringify(body) });
    data = parseAiResponse(result.status, '', result.body);
    if (result.status < 200 || result.status >= 300) throw new Error(data?.error || 'AI request failed.');
  } else {
    const response = await fetch('/api/ai-chat', { method: 'POST', headers, body: JSON.stringify(body) });
    data = parseAiResponse(response.status, response.statusText, await response.text());
    if (!response.ok) throw new Error(data?.error || 'AI request failed.');
  }
  return String(data.reply || '');
}
