// Follow up generation pipeline (Phase 7): context → provider → follow up validation → provenance.
// First contact drafts are generated only by the Phase 13 authority (server/outreachPrep/service.ts).
import type { MailContext } from '../../src/domain/mail/context';
import type { MailGenerateResponse } from '../../src/domain/mail/api';
import type { MailEvidenceRef, MailSectorContext } from '../../src/domain/mail/draft';
import type { MailProviderAdapter } from './provider';
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

function sectorContext(ctx: MailContext, used: { sectorBenefitsUsed: string[]; sectorProfileUsed?: string | null } | null): MailSectorContext {
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
