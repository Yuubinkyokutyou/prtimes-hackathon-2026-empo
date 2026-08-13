import { config } from './config.js';

export async function openAiRequest(path: string, body: object): Promise<unknown> {
  if (!config.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(`https://api.openai.com/v1/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.OPENAI_TIMEOUT_MS),
    });

    if (response.ok) return response.json();

    const detail = (await response.text()).slice(0, 500);
    const requestId = response.headers.get('x-request-id');
    const canRetry = response.status === 429 || response.status >= 500;
    if (attempt === 0 && canRetry) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      continue;
    }
    throw new Error(
      `OpenAI API ${response.status}${requestId ? ` (${requestId})` : ''}: ${detail}`,
    );
  }
  throw new Error('OpenAI API request failed');
}

export function extractResponseText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid OpenAI response');
  const response = payload as {
    output_text?: unknown;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };

  if (typeof response.output_text === 'string') return response.output_text;

  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  throw new Error('OpenAI response did not contain output text');
}
