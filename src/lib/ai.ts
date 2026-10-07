import type { AppState, StudySubject } from '../types';
import { educationLabel } from './selectors';

export type ChatMessage = { role: 'user' | 'assistant'; content: string };
type AiApiResponse = { reply?: string; error?: string; model?: string; usage?: unknown };

async function readAiResponse(response: Response): Promise<AiApiResponse> {
  const text = await response.text();
  if (!text.trim()) {
    return {
      error: response.ok
        ? 'The AI route returned an empty response.'
        : `The AI route returned ${response.status} ${response.statusText || 'without a response body'}.`,
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
  const response = await fetch('/api/ai-chat', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${import.meta.env.VITE_API_AUTH_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  const data = await readAiResponse(response);
  if (!response.ok) throw new Error(data?.error || 'AI request failed.');
  return String(data.reply || '');
}
