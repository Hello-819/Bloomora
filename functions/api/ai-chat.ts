type ChatMessage = {
  role?: string;
  content?: string;
};

type AiRequestBody = {
  messages?: ChatMessage[];
  profile?: Record<string, unknown>;
  context?: Record<string, unknown>;
};

type PagesContext = {
  request: Request;
  env: {
    OPENROUTER_API_KEY?: string;
    OPENROUTER_MODEL?: string;
    CF_PAGES_URL?: string;
    API_AUTH_TOKEN?: string;
  };
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

async function parseRequest(request: Request): Promise<AiRequestBody> {
  try {
    return (await request.json()) as AiRequestBody;
  } catch {
    return {};
  }
}

export async function onRequestPost({ request, env }: PagesContext): Promise<Response> {
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return jsonResponse({ error: 'OPENROUTER_API_KEY is not configured in Cloudflare Pages.' }, 500);
  }

  const authToken = env.API_AUTH_TOKEN;
  if (!authToken) {
    return jsonResponse({ error: 'API_AUTH_TOKEN is not configured in Cloudflare Pages.' }, 500);
  }

  const authHeader = request.headers.get('authorization');
  if (!authHeader || authHeader !== `Bearer ${authToken}`) {
    return jsonResponse({ error: 'Unauthorized.' }, 401);
  }

  try {
    const body = await parseRequest(request);
    const messages = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
    const profile = body.profile || {};
    const context = body.context || {};
    const modelName = env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';

    const system = [
      'You are Bloomora AI, a warm but precise study tutor inside a study tracker app.',
      'Tailor every answer to the learner profile: qualification, exam board, subject, target grade, notes, tasks, and study history.',
      'If exam-board-specific details are uncertain, say so and advise checking the official specification. Do not invent mark schemes, grade boundaries, or required practical details.',
      'Prefer concise structured help: explain, quiz, plan, mark against criteria, produce revision tasks, and ask one useful follow-up when needed.',
      'Keep answers student-friendly and actionable. No medical, legal, or financial advice.',
      `Learner profile: ${JSON.stringify(profile)}`,
      `Bloomora context: ${JSON.stringify(context).slice(0, 6000)}`,
    ].join('\n');

    const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        'http-referer': env.CF_PAGES_URL || new URL(request.url).origin,
        'x-title': 'Bloomora Study Assistant',
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: 'system', content: system },
          ...messages.map((message) => ({
            role: message.role === 'assistant' ? 'assistant' : 'user',
            content: String(message.content || '').slice(0, 4000),
          })),
        ],
        temperature: 0.45,
        max_tokens: 900,
      }),
    });

    const upstreamText = await upstream.text();
    const data = upstreamText ? JSON.parse(upstreamText) : {};

    if (!upstream.ok) {
      return jsonResponse(
        { error: data?.error?.message || data?.message || 'OpenRouter request failed.' },
        upstream.status,
      );
    }

    return jsonResponse({
      reply: data?.choices?.[0]?.message?.content || 'I could not generate a response.',
      model: data?.model || modelName,
      usage: data?.usage,
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'AI chat failed.' }, 500);
  }
}

export function onRequest(): Response {
  return jsonResponse({ error: 'Method not allowed.' }, 405);
}
