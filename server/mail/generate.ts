// Mail generation pipeline: request → context (code decides evidence and personalization) →
// provider → validation against the same context → response with provenance.
import { buildMailContext, type MailContext, type MailGenerateRequest } from '../../src/domain/mail/context';
import type { MailGenerateResponse } from '../../src/domain/mail/api';
import type { MailEvidenceRef, MailSectorContext } from '../../src/domain/mail/draft';
import { validateMailOutput, type MailModelOutput } from '../../src/domain/mail/safety';
import { MAIL_PROMPT_VERSION, type MailProviderAdapter } from './provider';
import type { FollowUpContext } from '../../src/domain/mail/followUpContext';
import { validateFollowUpOutput } from '../../src/domain/mail/followUpSafety';
import { FOLLOW_UP_PROMPT_VERSION } from './followUpPrompts';
import { ProviderError } from '../research/provider';

/** The generated output broke a hard rule (unsupported claim, hype, missing subjects …). */
export class MailSafetyError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Unsafe mail output: ${problems.join(' | ')}`);
    this.name = 'MailSafetyError';
  }
}

function sectorContext(ctx: MailContext, used: Pick<MailModelOutput, 'sectorBenefitsUsed'> & { sectorProfileUsed?: string | null } | null): MailSectorContext {
  const g = ctx.sectorGuidance;
  const usedIds = new Set(used?.sectorBenefitsUsed ?? []);
  return {
    kind: 'sector_guidance',
    sectorLabel: ctx.sector.label,
    sectorId: ctx.sector.sectorId,
    familyLabel: ctx.sector.familyLabel,
    familyId: ctx.sector.familyId,
    source: g?.source ?? 'none',
    profileId: used?.sectorProfileUsed ?? g?.profileId ?? null,
    summaryTr: g?.summaryTr ?? null,
    useCasesUsed: (g?.useCases ?? []).filter((u) => usedIds.has(u.id)).map(({ id, tr }) => ({ id, tr })),
    useCasesAvailable: (g?.useCases ?? []).map(({ id, tr }) => ({ id, tr })),
  };
}

export async function generateMailDraft(
  provider: MailProviderAdapter,
  request: MailGenerateRequest,
  options: { signal?: AbortSignal; now?: () => Date } = {},
): Promise<MailGenerateResponse> {
  const ctx = buildMailContext(request);
  const raw = await provider.generate(ctx, options.signal);
  const result = validateMailOutput(raw, ctx);
  if (!result.ok) throw new MailSafetyError(result.problems);
  const out = result.output;
  const usedEvidence = new Set(out.evidenceRefsUsed);
  const evidenceRefs: MailEvidenceRef[] = ctx.companyEvidence.items
    .filter((e) => usedEvidence.has(e.id))
    .map((e) => ({ kind: 'company_evidence', id: e.id, url: e.url, title: e.title, sourceType: e.sourceType, claim: e.claim, inspected: e.inspected }));
  return {
    subjectOptions: out.subjectOptions,
    body: out.body,
    evidenceRefs,
    sectorContext: sectorContext(ctx, out),
    generationNotes: {
      provider: provider.id,
      model: provider.model,
      personalization: ctx.personalization,
      personalizationReasons: ctx.personalizationReasons,
      companyObservation: out.companyObservation,
      serviceReasoning: out.serviceReasoning,
      warnings: result.warnings,
      promptVersion: MAIL_PROMPT_VERSION,
    },
    generatedAt: (options.now?.() ?? new Date()).toISOString(),
  };
}

/** Validated follow up content with the provenance stored on the draft. Body only: no subject. */
export interface FollowUpGenerateResponse {
  body: string;
  evidenceRefs: MailEvidenceRef[];
  sectorContext: MailSectorContext;
  generationNotes: MailGenerateResponse['generationNotes'];
}

/** Follow up pipeline: context → provider → follow up validation → provenance. Never sends. */
export async function generateFollowUpDraft(
  provider: MailProviderAdapter,
  ctx: FollowUpContext,
  options: { signal?: AbortSignal } = {},
): Promise<FollowUpGenerateResponse> {
  if (!provider.generateFollowUp) throw new ProviderError('not_configured', 'provider cannot write follow ups');
  const raw = await provider.generateFollowUp(ctx, options.signal);
  const result = validateFollowUpOutput(raw, ctx);
  if (!result.ok) throw new MailSafetyError(result.problems);
  const out = result.output;
  const used = new Set(out.evidenceRefsUsed);
  const g = ctx.base.sectorGuidance;
  return {
    body: out.body,
    evidenceRefs: ctx.base.companyEvidence.items
      .filter((e) => used.has(e.id))
      .map((e) => ({ kind: 'company_evidence', id: e.id, url: e.url, title: e.title, sourceType: e.sourceType, claim: e.claim, inspected: e.inspected })),
    sectorContext: sectorContext(ctx.base, { sectorBenefitsUsed: out.sectorBenefitsUsed, sectorProfileUsed: out.sectorBenefitsUsed.length && g ? g.profileId : null }),
    generationNotes: {
      provider: provider.id,
      model: provider.model,
      personalization: ctx.base.personalization,
      personalizationReasons: ctx.base.personalizationReasons,
      companyObservation: out.companyObservation,
      serviceReasoning: out.serviceReasoning,
      warnings: result.warnings,
      promptVersion: FOLLOW_UP_PROMPT_VERSION,
      followUp: { stepNumber: out.stepNumber, angle: out.followUpAngle, previousMessagesConsidered: out.previousMessagesConsidered },
    },
  };
}
