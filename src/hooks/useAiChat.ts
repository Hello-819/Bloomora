import { useState } from 'react';
import type { ChatMessage } from '../lib/ai';
import { readAiResponse } from '../lib/ai';

type BuildPayloadFn = (nextMessages: ChatMessage[]) => Record<string, unknown>;

export function useAiChat(initialMessages: ChatMessage[], buildPayload: BuildPayloadFn) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  const sendMessage = async (text = input) => {
    const clean = text.trim();
    if (!clean || sending) return;
    const nextMessages = [...messages, { role: 'user' as const, content: clean }];
    setMessages(nextMessages);
    setInput('');
    setSending(true);
    try {
      const response = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildPayload(nextMessages)),
      });
      const data = await readAiResponse(response);
      if (!response.ok) throw new Error(data?.error || 'AI request failed.');
      setMessages([...nextMessages, { role: 'assistant', content: data.reply || 'I could not generate a response.' }]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The AI assistant could not respond.';
      setMessages([...nextMessages, { role: 'assistant', content: `I could not reach the AI model: ${message}` }]);
    } finally {
      setSending(false);
    }
  };

  return {
    messages,
    input,
    setInput,
    sending,
    sendMessage,
  };
}
