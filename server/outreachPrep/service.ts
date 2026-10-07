// Outreach preparation service (Phase 13). The server is the authority for readiness: every
// generation recomputes it from stored data and refuses anything that is not Hazır. Code decides
// the recipient, service, angle, evidence, CTA and tone; the provider only writes wording, and its
// output is validated (claims.ts) before anything is saved. One automatic repair attempt with the
// exact validation failures; a second failure saves nothing. Generation never approves, never
// sends and never creates or changes a follow up plan.
import { primaryOpportunity, type Company } from '../../src/domain/company';
import { dayKey } from '../../src/domain/businessDay';
import { defaultMailLanguage, type MailDraft, type MailLanguage, type MailEvidenceRef, type MailGenerationNotes, type MailSectorContext, type Personalization } from '../../src/domain/mail/draft';
import { buildPrepContext, MAIL_PREP_PROMPT_VERSION, type PrepContext } from '../../src/domain/mail/prepContext';
import { validatePrepOutput } from '../../src/domain/mail/claims';
import { angleDefinition, CTA_KEYS, GENERAL_INTRO, MAX_MANUAL_FACTS, OUTREACH_TONES, type ClaimSource } from '../../src/domain/outreachAngles';
import {
  emptyPreparation,
  MAX_BATCH_PREPARE,
  OUTREACH_PREP_ERROR_MESSAGES,
  sectionIntact,
  type BatchItemResult,
  type DraftVariant,
  type GenerateMode,
  type OutreachPrepErrorCode,
  type OutreachPreparation,
  type PreparationDetail,
  type PreparationOverviewItem,
  type PreparationPatch,
  type SectionKey,
} from '../../src/domain/outreachPrep';
import { computeReadiness, type LinkedResearch, type Readiness, type ReadinessReason } from '../../src/domain/outreachReadiness';
import { classifySector } from '../../src/domain/sectorTaxonomy';
import { sectorGuidanceFor } from '../../src/domain/sectorIntelligence';
import { SERVICE_KEYS, type ServiceKey } from '../../src/domain/services';
import { isInspectedEvidence } from '../../src/domain/research';
import { createId } from '../../src/lib/id';
import { mailReducer } from '../../src/state/mail/mailReducer';
import type { Store } from '../db/store';
import { MailSafetyError } from '../mail/generate';
import type { MailProviderAdapter } from '../mail/provider';
import { ProviderError } from '../research/provider';

export class OutreachPrepError extends Error {
  constructor(
    public readonly code: OutreachPrepErrorCode,
    public readonly extra: { reasons?: ReadinessReason[] } = {},
  ) {
    super(OUTREACH_PREP_ERROR_MESSAGES[code]);
    this.name = 'OutreachPrepError';
  }
}

/** Everything readiness needs, loaded from the store for one company. */
export function loadReadiness(store: Store, company: Company, companies: readonly Company[] = store.companies.list(), preparation: OutreachPreparation | null = store.outreachPrep.get(company.id)): Readiness {
  const result = store.research.findTransferredResult(company.id);
  const research: LinkedResearch | null = result
    ? { result, review: store.discovery.getReview(result.id), phase12: !!store.discovery.getDetails(result.researchRequestId) }
    : null;
  return computeReadiness({
    company,
    companies,
    customer: store.customers.getByCompany(company.id),
    sends: store.outreach.listSends().filter((s) => s.companyId === company.id),
    followUps: store.followUps.listByCompany(company.id),
    research,
    preparation,
    draft: store.mail.getByCompany(company.id),
  });
}

/** Choices passed by the compatibility endpoint; applied in memory, saved only with a successful generation. */
export interface GenerationOverrides {
  service?: ServiceKey;
  language?: MailLanguage;
  contactId?: string | null;
}

export const OUTREACH_PREP_HTTP: Record<OutreachPrepErrorCode, number> = { not_found: 404, not_ready: 409, edits_present: 409, section_edited: 409, no_draft: 409, daily_limit: 429, invalid_request: 400, batch_too_large: 400, not_configured: 503 };

const SETTINGS_KEY = 'outreach_prep.real_generations';
const MAX_CONCURRENT = 3;

export function createOutreachPrepService(
  store: Store,
  deps: { mailProvider?: MailProviderAdapter | null; now?: () => Date; maxRealGenerationsPerDay: number },
) {
  const now = () => (deps.now?.() ?? new Date()).toISOString();
  const inFlight = new Set<string>();

  const companyOrThrow = (id: string) => {
    const c = store.companies.get(id);
    if (!c) throw new OutreachPrepError('not_found');
    return c;
  };

  function realGenerations(): { today: number; limit: number } {
    const v = store.settings.get<{ day: string; count: number }>(SETTINGS_KEY);
    return { today: v && v.day === dayKey(now()) ? v.count : 0, limit: deps.maxRealGenerationsPerDay };
  }

  /** Counts one real provider call (fixture calls are free and never counted). Throws at the cap. */
  function takeRealGeneration(provider: MailProviderAdapter) {
    if (provider.id === 'fixture') return;
    store.transaction(() => {
      const { today, limit } = realGenerations();
      if (today >= limit) throw new OutreachPrepError('daily_limit');
      store.settings.set(SETTINGS_KEY, { day: dayKey(now()), count: today + 1 }, now());
    });
  }

  function detail(companyId: string): PreparationDetail {
    const company = companyOrThrow(companyId);
    const result = store.research.findTransferredResult(company.id);
    return {
      companyId,
      readiness: loadReadiness(store, company),
      preparation: store.outreachPrep.get(companyId),
      draft: store.mail.getByCompany(companyId),
      evidence: (result?.evidence ?? []).map((e) => ({ id: e.id, url: e.url, title: e.title })),
      realGenerations: realGenerations(),
    };
  }

  function overview(): PreparationOverviewItem[] {
    const companies = store.companies.list();
    return companies.map((c) => {
      const r = loadReadiness(store, c, companies);
      const draft = store.mail.getByCompany(c.id);
      return {
        companyId: c.id,
        companyName: c.name,
        status: c.status,
        readiness: {
          state: r.state,
          reasons: r.reasons,
          progress: r.progress,
          service: r.service,
          general: r.general,
          angleLabel: r.general ? 'Genel tanıtım' : r.angle?.label ?? null,
          contactName: r.contact?.contact.fullName ?? null,
          contactEmail: r.contact?.contact.email ?? null,
        },
        draftId: draft?.id ?? null,
      };
    });
  }

  function updatePreparation(companyId: string, patch: PreparationPatch): PreparationDetail {
    return store.transaction(() => {
      const company = companyOrThrow(companyId);
      const at = now();
      const prep = store.outreachPrep.get(companyId) ?? emptyPreparation(companyId, at);
      const next: OutreachPreparation = { ...prep, updatedAt: at };
      if (patch.contactId !== undefined) {
        if (patch.contactId !== null && !company.contacts.some((c) => c.id === patch.contactId)) throw new OutreachPrepError('invalid_request');
        next.contactId = patch.contactId;
      }
      if (patch.service !== undefined) {
        if (patch.service !== null && !SERVICE_KEYS.includes(patch.service)) throw new OutreachPrepError('invalid_request');
        if (patch.service !== prep.service && patch.angleKey === undefined && prep.angleKey !== GENERAL_INTRO) next.angleKey = null;
        next.service = patch.service;
      }
      if (patch.angleKey !== undefined) {
        const def = patch.angleKey && patch.angleKey !== GENERAL_INTRO ? angleDefinition(patch.angleKey) : null;
        const effective = next.service ?? primaryOpportunity(company)?.service ?? null;
        if (patch.angleKey && patch.angleKey !== GENERAL_INTRO && (!def || (effective && def.service !== effective))) throw new OutreachPrepError('invalid_request');
        next.angleKey = patch.angleKey;
      }
      if (patch.tone !== undefined) {
        if (!OUTREACH_TONES.includes(patch.tone)) throw new OutreachPrepError('invalid_request');
        next.tone = patch.tone;
      }
      if (patch.ctaKey !== undefined) {
        if (patch.ctaKey !== null && !CTA_KEYS.includes(patch.ctaKey)) throw new OutreachPrepError('invalid_request');
        next.ctaKey = patch.ctaKey;
      }
      if (patch.language !== undefined) next.language = patch.language;
      if (patch.manualFacts !== undefined) {
        const facts = patch.manualFacts.map((f) => ({ id: f.id || createId('fact'), text: f.text.trim() })).filter((f) => f.text);
        if (facts.length > MAX_MANUAL_FACTS || facts.some((f) => f.text.length > 300)) throw new OutreachPrepError('invalid_request');
        next.manualFacts = facts;
      }
      if (patch.duplicateAcks !== undefined) {
        // Only probable matches can be confirmed as "Farklı şirket"; hard matches never.
        const probable = new Set(loadReadiness(store, company).duplicates.filter((d) => d.level === 'probable').map((d) => d.key));
        if (patch.duplicateAcks.some((k) => !probable.has(k))) throw new OutreachPrepError('invalid_request');
        next.duplicateAcks = [...new Set(patch.duplicateAcks)];
      }
      store.outreachPrep.save(next);
      return detail(companyId);
    });
  }

  function sectorContextFor(company: Company, service: MailDraft['service']): MailSectorContext {
    const sector = classifySector(company.sector, company.sectorId ?? null);
    const g = sectorGuidanceFor(service, company.sector, company.sectorId ?? null);
    return {
      kind: 'sector_guidance',
      sectorLabel: sector.label,
      sectorId: sector.definition?.id ?? null,
      familyLabel: sector.familyLabel,
      familyId: sector.familyId,
      source: g?.source ?? 'none',
      profileId: g?.profileId ?? null,
      summaryTr: g?.summaryTr ?? null,
      useCasesUsed: [],
      useCasesAvailable: (g?.useCases ?? []).map(({ id, tr }) => ({ id, tr })),
    };
  }

  /** Provider call + validation, with one repair attempt carrying the exact problems. */
  async function runProvider(provider: MailProviderAdapter, ctx: PrepContext, signal?: AbortSignal) {
    if (!provider.generatePrepared) throw new OutreachPrepError('not_configured');
    let problems: string[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      takeRealGeneration(provider);
      const raw = await provider.generatePrepared({ ...ctx, repairProblems: problems }, signal);
      const result = validatePrepOutput(raw, ctx);
      if (result.ok) return { ...result, repaired: attempt > 0 };
      problems = result.problems;
    }
    throw new MailSafetyError(problems);
  }

  function edits(d: MailDraft) {
    return { selectedSubject: d.selectedSubject, body: d.body };
  }

  /** Applies compatibility overrides to the stored preparation (in memory). */
  function withOverrides(companyId: string, overrides: GenerationOverrides | undefined): OutreachPreparation | null {
    const stored = store.outreachPrep.get(companyId);
    if (!overrides) return stored;
    const base = stored ?? emptyPreparation(companyId, now());
    const next: OutreachPreparation = { ...base };
    if (overrides.service !== undefined && overrides.service !== base.service) {
      next.service = overrides.service;
      // A specific angle belongs to its service; an explicit Genel tanıtım choice stays.
      if (base.angleKey !== GENERAL_INTRO) next.angleKey = null;
    }
    if (overrides.language !== undefined) next.language = overrides.language;
    if (overrides.contactId !== undefined) next.contactId = overrides.contactId;
    return next;
  }

  /**
   * The ONE first-contact generation authority (Phase 13). Used by /api/outreach-prep and by the
   * compatibility endpoint /api/mail/drafts/generate (with overrides).
   */
  async function generate(companyId: string, options: { mode: GenerateMode; variants?: boolean; replaceEdits?: boolean; overrides?: GenerationOverrides }, signal?: AbortSignal): Promise<PreparationDetail> {
    const provider = deps.mailProvider ?? null;
    if (!provider?.generatePrepared) throw new OutreachPrepError('not_configured');
    const company = companyOrThrow(companyId);
    const prep = withOverrides(companyId, options.overrides);
    const readiness = loadReadiness(store, company, undefined, prep);
    if (readiness.state !== 'ready') throw new OutreachPrepError('not_ready', { reasons: readiness.reasons });
    const draft = store.mail.getByCompany(companyId);
    const mode = options.mode;
    const replaceEdits = options.replaceEdits === true;

    // Manual-edit protection.
    let current: PrepContext['current'] = null;
    if (mode !== 'full') {
      if (!draft || !prep || prep.draftId !== draft.id || !prep.sections.length) throw new OutreachPrepError('no_draft');
      if (mode === 'opening' || mode === 'cta') {
        const section = prep.sections.find((s) => s.key === mode);
        if (!section || !sectionIntact(section, draft.body)) throw new OutreachPrepError('section_edited');
      }
      current = { sections: prep.sections, subjectOptions: prep.subjectOptions, claims: prep.claims };
    } else if (draft?.editedSinceGeneration && !replaceEdits) {
      throw new OutreachPrepError('edits_present');
    }

    if (inFlight.has(companyId) || inFlight.size >= MAX_CONCURRENT) throw new ProviderError('busy', 'outreach prep busy');
    inFlight.add(companyId);
    try {
      const service = readiness.service!;
      const language = prep?.language ?? draft?.language ?? defaultMailLanguage(company.country);
      const ctx = buildPrepContext({
        company,
        contact: readiness.contact,
        service,
        language,
        tone: readiness.tone,
        angle: readiness.angle,
        general: readiness.general,
        angles: readiness.angles,
        cta: readiness.cta,
        manualFacts: prep?.manualFacts ?? [],
        mode,
        current,
        withVariants: options.variants === true,
      });
      const out = await runProvider(provider, ctx, signal);

      return store.transaction(() => {
        // Re-check after the provider call: a send, a stage change or a deletion may have happened.
        const fresh = store.companies.get(companyId);
        if (!fresh) throw new OutreachPrepError('not_found');
        const again = loadReadiness(store, fresh, undefined, withOverrides(companyId, options.overrides));
        if (again.state !== 'ready') throw new OutreachPrepError('not_ready', { reasons: again.reasons });
        const at = now();
        const existing = store.mail.getByCompany(companyId);
        const usedIds = new Set(out.draft.claims.flatMap((c) => c.sourceIds));
        const used = ctx.sources.filter((s) => usedIds.has(s.id));
        const notes = generationNotes(provider, ctx, used, out.serviceReasoning, [...out.warnings, ...(out.repaired ? ['İlk taslak kurallara uymadığı için bir kez düzeltilerek yeniden yazıldı.'] : [])], out.draft.claims);
        const evidenceRefs = evidenceRefsFor(fresh.id, used);

        let saved: MailDraft;
        if (mode === 'full') {
          const [d] = mailReducer(
            { drafts: existing ? [existing] : [] },
            {
              type: 'generated',
              draftId: existing?.id ?? createId('mail'),
              companyId,
              options: { service, language, contactId: readiness.contact?.contact.id ?? null, researchJobId: store.research.findTransferredResult(companyId)?.researchRequestId ?? null },
              response: { subjectOptions: out.draft.subjectOptions, body: out.draft.body, evidenceRefs, sectorContext: sectorContextFor(fresh, service), generationNotes: notes, generatedAt: at },
              at,
              preserve: existing && existing.editedSinceGeneration ? edits(existing) : null,
            },
          ).drafts;
          saved = { ...d, selectedSubject: out.draft.recommendedSubject };
        } else {
          const base = existing!;
          let body = base.body;
          let selectedSubject = base.selectedSubject;
          let subjectOptions = base.subjectOptions;
          if (mode === 'subject') {
            const custom = !prep!.subjectOptions.includes(base.selectedSubject);
            subjectOptions = out.draft.subjectOptions;
            selectedSubject = custom && !replaceEdits ? base.selectedSubject : out.draft.recommendedSubject;
          } else {
            const oldSection = prep!.sections.find((s) => s.key === mode)!;
            const newSection = out.draft.sections.find((s) => s.key === (mode as SectionKey))!;
            body = base.body.replace(oldSection.text, () => newSection.text);
          }
          const generatedBody = out.draft.body;
          const [d] = mailReducer(
            { drafts: [base] },
            {
              type: 'replaced',
              id: base.id,
              content: {
                subjectOptions,
                selectedSubject,
                body,
                editedSinceGeneration: body !== generatedBody || !subjectOptions.includes(selectedSubject),
                generationNotes: { ...notes, warnings: [...notes.warnings, `Kısmi yeniden yazım: ${mode === 'subject' ? 'konu' : mode === 'opening' ? 'giriş' : 'kapanış'}.`] },
                evidenceRefs,
                generatedAt: at,
              },
              at,
              preserve: null,
            },
          ).drafts;
          saved = d;
        }
        store.mail.save(saved);

        const variants: DraftVariant[] = out.variants.map((v) => ({ id: `${saved.id}_${v.id}`, label: v.label, angleKey: v.angleKey ?? GENERAL_INTRO, tone: v.tone, subjectOptions: v.subjectOptions, body: v.body, sections: v.sections, claims: v.claims }));
        const base = withOverrides(companyId, options.overrides) ?? emptyPreparation(companyId, at);
        const contact = readiness.contact;
        store.outreachPrep.save({
          ...base,
          draftId: saved.id,
          contactSnapshot: contact ? { contactId: contact.contact.id, fullName: contact.contact.fullName, role: contact.contact.role, email: contact.contact.email!.trim(), general: contact.general } : null,
          service,
          angleKey: readiness.general ? GENERAL_INTRO : readiness.angle?.key ?? null,
          tone: readiness.tone,
          ctaKey: readiness.cta,
          language,
          claimSources: ctx.sources,
          claims: out.draft.claims,
          sections: out.draft.sections,
          subjectOptions: out.draft.subjectOptions,
          variants: mode === 'full' ? variants : base.variants,
          readinessSnapshot: { state: readiness.state, reasons: readiness.reasons.map((r) => r.code), at },
          promptVersion: MAIL_PREP_PROMPT_VERSION,
          provider: provider.id,
          generatedAt: at,
          updatedAt: at,
        });
        return detail(companyId);
      });
    } finally {
      inFlight.delete(companyId);
    }
  }

  function generationNotes(provider: MailProviderAdapter, ctx: PrepContext, used: ClaimSource[], reasoning: string, warnings: string[], claims: { sentence: string; sourceIds: string[] }[]): MailGenerationNotes {
    const personalization: Personalization = ctx.general ? 'general' : used.some((s) => s.kind === 'observed') ? 'specific' : 'cautious';
    const evidenceIds = new Set(used.filter((s) => s.kind === 'observed' || s.kind === 'search' || s.kind === 'inferred').map((s) => s.id));
    const observation = claims.find((c) => c.sourceIds.some((id) => evidenceIds.has(id)))?.sentence ?? null;
    return {
      provider: provider.id,
      model: provider.model,
      personalization,
      personalizationReasons: ctx.general
        ? ['Açıkça "Genel tanıtım" seçildi; taslak şirkete özel gözlem içermez.']
        : [`Açı: ${ctx.angle!.label}. Kanıt: ${used.filter((s) => evidenceIds.has(s.id)).map((s) => (s.kind === 'observed' ? 'Gözlenen' : s.kind === 'search' ? 'Arama kaynağı' : 'Çıkarım')).join(', ')}.`],
      companyObservation: observation,
      serviceReasoning: reasoning,
      warnings,
      promptVersion: MAIL_PREP_PROMPT_VERSION,
    };
  }

  function evidenceRefsFor(companyId: string, used: ClaimSource[]): MailEvidenceRef[] {
    const result = store.research.findTransferredResult(companyId);
    const ids = new Set(used.flatMap((s) => s.evidenceIds));
    const inspected = !!result?.analysis?.websiteInspected;
    return (result?.evidence ?? [])
      .filter((e) => ids.has(e.id))
      .map((e) => ({ kind: 'company_evidence', id: e.id, url: e.url, title: e.title, sourceType: e.sourceType, claim: e.claim, inspected: inspected && isInspectedEvidence(e) }));
  }

  /** Swaps an alternative into the draft. The current text is always kept as a previous version. */
  function useVariant(companyId: string, variantId: string, replaceEdits: boolean): PreparationDetail {
    return store.transaction(() => {
      const company = companyOrThrow(companyId);
      const readiness = loadReadiness(store, company);
      if (readiness.state === 'blocked') throw new OutreachPrepError('not_ready', { reasons: readiness.reasons });
      const prep = store.outreachPrep.get(companyId);
      const draft = store.mail.getByCompany(companyId);
      const variant = prep?.variants.find((v) => v.id === variantId);
      if (!prep || !draft || !variant || prep.draftId !== draft.id) throw new OutreachPrepError('no_draft');
      if (draft.editedSinceGeneration && !replaceEdits) throw new OutreachPrepError('edits_present');
      const at = now();
      const [d] = mailReducer(
        { drafts: [draft] },
        {
          type: 'replaced',
          id: draft.id,
          content: { subjectOptions: variant.subjectOptions, selectedSubject: variant.subjectOptions[0] ?? draft.selectedSubject, body: variant.body, editedSinceGeneration: false, generatedAt: at },
          at,
          preserve: edits(draft),
        },
      ).drafts;
      store.mail.save(d);
      store.outreachPrep.save({
        ...prep,
        angleKey: variant.angleKey,
        tone: variant.tone,
        sections: variant.sections,
        claims: variant.claims,
        subjectOptions: variant.subjectOptions,
        variants: prep.variants.filter((v) => v.id !== variantId),
        updatedAt: at,
      });
      return detail(companyId);
    });
  }

  /** At most 5 companies, one after another, each isolated. Never approves, sends or plans follow ups. */
  async function batch(companyIds: string[], signal?: AbortSignal): Promise<BatchItemResult[]> {
    const ids = [...new Set(companyIds)];
    if (ids.length > MAX_BATCH_PREPARE) throw new OutreachPrepError('batch_too_large');
    const results: BatchItemResult[] = [];
    for (const id of ids) {
      const company = store.companies.get(id);
      if (!company) {
        results.push({ companyId: id, companyName: '—', status: 'skipped', message: OUTREACH_PREP_ERROR_MESSAGES.not_found });
        continue;
      }
      const r = loadReadiness(store, company);
      const skip = (message: string) => results.push({ companyId: id, companyName: company.name, status: 'skipped', message });
      if (r.state !== 'ready') {
        skip(r.reasons[0]?.message ?? OUTREACH_PREP_ERROR_MESSAGES.not_ready);
        continue;
      }
      const draft = store.mail.getByCompany(id);
      if (draft) {
        skip(draft.editedSinceGeneration ? 'Taslakta düzenlemelerin var; toplu hazırlık üzerine yazmaz.' : 'Bu şirketin zaten bir taslağı var.');
        continue;
      }
      if (signal?.aborted) {
        skip('Toplu hazırlık durduruldu.');
        continue;
      }
      try {
        await generate(id, { mode: 'full' }, signal);
        results.push({ companyId: id, companyName: company.name, status: 'generated', message: null });
      } catch (e) {
        const message =
          e instanceof MailSafetyError
            ? `Taslak kurallara uymadı: ${e.problems.slice(0, 2).join(' · ')}`
            : e instanceof OutreachPrepError
              ? e.message
              : e instanceof ProviderError
                ? `Taslak servisi hatası (${e.code}).`
                : 'Beklenmeyen bir hata oluştu.';
        results.push({ companyId: id, companyName: company.name, status: 'failed', message });
        if (e instanceof OutreachPrepError && e.code === 'daily_limit') {
          for (const rest of ids.slice(ids.indexOf(id) + 1)) results.push({ companyId: rest, companyName: store.companies.get(rest)?.name ?? '—', status: 'skipped', message: OUTREACH_PREP_ERROR_MESSAGES.daily_limit });
          break;
        }
      }
    }
    return results;
  }

  return { overview, detail, updatePreparation, generate, useVariant, batch, realGenerations };
}

export type OutreachPrepService = ReturnType<typeof createOutreachPrepService>;
