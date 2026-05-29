export type ChatMessage = { role: 'user' | 'assistant'; content: string };

export type AiApiResponse = { reply?: string; error?: string; model?: string; usage?: unknown };

export async function readAiResponse(response: Response): Promise<AiApiResponse> {
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
    return {
      error: text.slice(0, 300) || 'The AI route returned a non-JSON response.',
    };
  }
}
