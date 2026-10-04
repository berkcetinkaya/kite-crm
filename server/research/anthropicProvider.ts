import Anthropic from '@anthropic-ai/sdk';
import type { ResearchProviderAdapter, DiscoveryInput, DiscoveryOutput, AnalysisInput } from './provider';
import { ProviderError } from './provider';
import { ANALYSIS_SCHEMA, DISCOVERY_TOOL_NAME, DISCOVERY_TOOL_SCHEMA } from './schemas';
import { ANALYSIS_SYSTEM, DISCOVERY_SYSTEM, analysisUserPrompt, discoveryUserPrompt } from './prompts';
import type { ServerConfig } from '../config';

/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). */
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const MAX_CONTINUATIONS = 4;

export function mapAnthropicError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new ProviderError('auth', 'Anthropic authentication failed');
  }
  if (e instanceof Anthropic.RateLimitError) return new ProviderError('rate_limit', 'Anthropic rate limit');
  if (e instanceof Anthropic.APIUserAbortError) return new ProviderError('cancelled', 'Aborted');
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new ProviderError('timeout', 'Anthropic request timed out');
  if (e instanceof Anthropic.APIConnectionError) return new ProviderError('unavailable', 'Cannot reach Anthropic');
  if (e instanceof Anthropic.InternalServerError) return new ProviderError('unavailable', 'Anthropic server error');
  if (e instanceof Anthropic.BadRequestError) return new ProviderError('invalid_request', `Anthropic rejected the request: ${e.message}`);
  if (e instanceof Anthropic.APIError) return new ProviderError('unavailable', `Anthropic API error ${e.status}`);
  return new ProviderError('internal', e instanceof Error ? e.message : 'Unknown provider error');
}

export function createAnthropicProvider(config: ServerConfig): ResearchProviderAdapter {
  const client = new Anthropic({
    apiKey: config.anthropicApiKey!,
    // Explicit base URL so an unrelated ANTHROPIC_BASE_URL in the environment is never picked up.
    baseURL: config.anthropicBaseUrl,
    maxRetries: 2,
    timeout: config.limits.providerTimeoutMs,
  });
  const model = config.anthropicModel;
  const fallback = FALLBACK_MODELS.has(model) ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : { betas: [] };

  async function discoverCompanies(input: DiscoveryInput): Promise<DiscoveryOutput> {
    const tools: Anthropic.Beta.BetaToolUnion[] = [
      {
        type: 'web_search_20260209',
        name: 'web_search',
        max_uses: input.maxSearches,
        ...(input.criteria.countryCode
          ? {
              user_location: {
                type: 'approximate' as const,
                country: input.criteria.countryCode,
                ...(input.criteria.city ? { city: input.criteria.city } : {}),
              },
            }
          : {}),
      },
      {
        name: DISCOVERY_TOOL_NAME,
        description: 'Submit the final list of verified candidate companies. Call once, at the end.',
        strict: true,
        input_schema: DISCOVERY_TOOL_SCHEMA as Anthropic.Beta.BetaTool.InputSchema,
      },
    ];
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      { role: 'user', content: discoveryUserPrompt(input.criteria, input.targetCount, input.knownHosts) },
    ];
    const searchResults: { url: string; title: string }[] = [];
    let searchesUsed = 0;
    let nudged = false;

    try {
      for (let turn = 0; turn <= MAX_CONTINUATIONS + 1; turn++) {
        const response = await client.beta.messages.create(
          {
            model,
            max_tokens: 16000,
            system: DISCOVERY_SYSTEM,
            output_config: { effort: config.discoveryEffort },
            tools,
            tool_choice: { type: 'auto' },
            messages,
            ...fallback,
          },
          { signal: input.signal },
        );
        if (response.stop_reason === 'refusal') throw new ProviderError('refused', 'Model declined the discovery request');

        for (const block of response.content) {
          if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
            for (const r of block.content) {
              if (r.type === 'web_search_result') searchResults.push({ url: r.url, title: r.title });
            }
          }
          if (block.type === 'server_tool_use' && block.name === 'web_search') searchesUsed += 1;
        }
        const submit = response.content.find(
          (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use' && b.name === DISCOVERY_TOOL_NAME,
        );
        if (submit) return { candidates: submit.input, searchResults, searchesUsed };

        messages.push({ role: 'assistant', content: response.content });
        if (response.stop_reason === 'pause_turn') continue; // server loop paused; resend to resume
        if (nudged) break;
        // The model ended without submitting; ask once (append-only) for the tool call.
        nudged = true;
        messages.push({
          role: 'user',
          content: `Call ${DISCOVERY_TOOL_NAME} now with the companies you found (an empty list is fine).`,
        });
      }
    } catch (e) {
      throw mapAnthropicError(e);
    }
    throw new ProviderError('invalid_response', 'Discovery finished without submitting candidates');
  }

  async function analyzeCompany(input: AnalysisInput): Promise<unknown> {
    const pageIds = input.evidence.filter((e) => e.sourceType === 'official_website' || e.sourceType === 'official_page');
    const pages = input.pages.map((extract) => ({
      extract,
      evidenceId: pageIds.find((e) => e.url === extract.url)?.id ?? 'unknown',
    }));
    try {
      const response = await client.beta.messages.create(
        {
          model,
          max_tokens: 16000,
          system: ANALYSIS_SYSTEM,
          output_config: {
            effort: config.analysisEffort,
            format: { type: 'json_schema', schema: ANALYSIS_SCHEMA },
          },
          messages: [{ role: 'user', content: analysisUserPrompt({ ...input, pages }) }],
          ...fallback,
        },
        { signal: input.signal },
      );
      if (response.stop_reason === 'refusal') throw new ProviderError('refused', 'Model declined the analysis');
      if (response.stop_reason === 'max_tokens') throw new ProviderError('invalid_response', 'Analysis output truncated');
      const text = response.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')?.text;
      if (!text) throw new ProviderError('invalid_response', 'Analysis returned no text');
      try {
        return JSON.parse(text);
      } catch {
        throw new ProviderError('invalid_response', 'Analysis output is not valid JSON');
      }
    } catch (e) {
      throw mapAnthropicError(e);
    }
  }

  return { id: 'anthropic', discoverCompanies, analyzeCompany };
}
