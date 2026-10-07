// Anthropic mail provider. Uses the same isolated KITE client as research (KITE_ANTHROPIC_API_KEY
// and KITE_ANTHROPIC_MODEL only) and structured output. Not exercised against the live API in
// Phase 5; tests replace the HTTP layer.
import type Anthropic from '@anthropic-ai/sdk';
import type { ServerConfig } from '../config';
import { createKiteAnthropicClient, fallbackOptions, mapAnthropicError } from '../research/anthropicProvider';
import { ProviderError } from '../research/provider';
import type { MailProviderAdapter } from './provider';
import { FOLLOW_UP_OUTPUT_SCHEMA, followUpSystemPrompt, followUpUserPrompt } from './followUpPrompts';
import { PREP_OUTPUT_SCHEMA, prepSystemPrompt, prepUserPrompt } from './prepPrompts';

export function createAnthropicMailProvider(config: ServerConfig, options: { fetch?: typeof fetch } = {}): MailProviderAdapter {
  const client = createKiteAnthropicClient(config, options);
  const model = config.anthropicModel;

  async function structured(system: string, user: string, schema: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    try {
      const response = await client.beta.messages.create(
        {
          model,
          max_tokens: 4000,
          system,
          output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
          messages: [{ role: 'user', content: user }],
          ...fallbackOptions(model),
        },
        { signal },
      );
      if (response.stop_reason === 'refusal') throw new ProviderError('refused', 'Model declined the mail draft');
      if (response.stop_reason === 'max_tokens') throw new ProviderError('invalid_response', 'Mail output truncated');
      const text = response.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')?.text;
      if (!text) throw new ProviderError('invalid_response', 'Mail draft returned no text');
      try {
        return JSON.parse(text);
      } catch {
        throw new ProviderError('invalid_response', 'Mail output is not valid JSON');
      }
    } catch (e) {
      throw mapAnthropicError(e);
    }
  }

  return {
    id: 'anthropic',
    model,
    // Follow ups (Phase 7): not exercised against the live API during development.
    generateFollowUp: (ctx, signal) => structured(followUpSystemPrompt(ctx), followUpUserPrompt(ctx), FOLLOW_UP_OUTPUT_SCHEMA, signal),
    // Prepared drafts (Phase 13): not exercised against the live API during development.
    generatePrepared: (ctx, signal) => structured(prepSystemPrompt(ctx), prepUserPrompt(ctx), PREP_OUTPUT_SCHEMA, signal),
  };
}
