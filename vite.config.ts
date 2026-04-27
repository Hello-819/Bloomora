import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { loadEnv, type Plugin } from 'vite';

function openRouterDevApi(apiKey: string | undefined, model: string | undefined): Plugin {
  return {
    name: 'bloomora-openrouter-dev-api',
    configureServer(server) {
      server.middlewares.use('/api/ai-chat', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'Method not allowed.' }));
          return;
        }

        if (!apiKey) {
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'OPENROUTER_API_KEY is not configured on the dev server.' }));
          return;
        }

        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(Buffer.from(chunk));
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          const messages = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
          const profile = body.profile || {};
          const context = body.context || {};
          const modelName = model || 'openai/gpt-4o-mini';

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
              'http-referer': 'http://127.0.0.1:5173',
              'x-title': 'Bloomora Study Assistant',
            },
            body: JSON.stringify({
              model: modelName,
              messages: [
                { role: 'system', content: system },
                ...messages.map((message: { role?: string; content?: string }) => ({
                  role: message.role === 'assistant' ? 'assistant' : 'user',
                  content: String(message.content || '').slice(0, 4000),
                })),
              ],
              temperature: 0.45,
              max_tokens: 900,
            }),
          });

          const data = await upstream.json();
          if (!upstream.ok) {
            res.statusCode = upstream.status;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: data?.error?.message || data?.message || 'OpenRouter request failed.' }));
            return;
          }

          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({
            reply: data?.choices?.[0]?.message?.content || 'I could not generate a response.',
            model: data?.model || modelName,
            usage: data?.usage,
          }));
        } catch (error) {
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'AI chat failed.' }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
  plugins: [react(), openRouterDevApi(env.OPENROUTER_API_KEY, env.OPENROUTER_MODEL)],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          storage: ['dexie'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
  },
};
});
