// Pure mail draft state. One active draft per company (nothing is sent in Phase 5).
// Lifecycle: generated → İncelenecek (review) · Berk saves edits → Taslak (draft) ·
// Berk approves → Onaylandı (approved). Editing an approved draft returns it to Taslak.
// Regenerating over Berk's edits keeps the edited version in previousVersions.
import type { MailGenerateResponse } from '../../domain/mail/api';
import { isFollowUpDraft, type MailDraft, type MailLanguage } from '../../domain/mail/draft';
import type { ServiceKey } from '../../domain/services';

export interface MailState {
  drafts: MailDraft[];
}

export const INITIAL_MAIL_STATE: MailState = { drafts: [] };

export interface DraftEdits {
  selectedSubject: string;
  body: string;
}

export type MailAction =
  | {
      type: 'generated';
      draftId: string;
      companyId: string;
      options: { service: ServiceKey; language: MailLanguage; contactId: string | null; researchJobId: string | null };
      response: MailGenerateResponse;
      at: string;
      /** Berk's current text, kept as a previous version before it is replaced. */
      preserve: DraftEdits | null;
    }
  | {
      /** Phase 13: part of the draft regenerated (subject / one section) or an alternative swapped in. */
      type: 'replaced';
      id: string;
      content: Pick<MailDraft, 'subjectOptions' | 'selectedSubject' | 'body' | 'editedSinceGeneration'> & Partial<Pick<MailDraft, 'generationNotes' | 'evidenceRefs' | 'generatedAt'>>;
      at: string;
      /** Berk's current text, kept as a previous version before it is replaced. */
      preserve: DraftEdits | null;
    }
  | { type: 'save'; id: string; edits: DraftEdits; at: string }
  | { type: 'approve'; id: string; edits: DraftEdits; at: string };

function applyEdits(d: MailDraft, edits: DraftEdits, at: string): MailDraft {
  const changed = edits.selectedSubject !== d.selectedSubject || edits.body !== d.body;
  if (!changed) return d;
  return {
    ...d,
    selectedSubject: edits.selectedSubject,
    body: edits.body,
    status: 'draft',
    approvedAt: null,
    editedSinceGeneration: true,
    updatedAt: at,
  };
}

export function mailReducer(state: MailState, action: MailAction): MailState {
  switch (action.type) {
    case 'generated': {
      const { response: r, options, at } = action;
      const existing = state.drafts.find((d) => d.companyId === action.companyId && !isFollowUpDraft(d));
      const generated = {
        service: options.service,
        language: options.language,
        contactId: options.contactId,
        researchJobId: options.researchJobId,
        subjectOptions: r.subjectOptions,
        selectedSubject: r.subjectOptions[0] ?? '',
        body: r.body,
        status: 'review' as const,
        generatedAt: r.generatedAt,
        approvedAt: null,
        evidenceRefs: r.evidenceRefs,
        sectorContext: r.sectorContext,
        generationNotes: r.generationNotes,
        editedSinceGeneration: false,
        updatedAt: at,
      };
      if (!existing) {
        const draft: MailDraft = { id: action.draftId, companyId: action.companyId, createdAt: at, previousVersions: [], ...generated };
        return { drafts: [draft, ...state.drafts] };
      }
      const previousVersions = action.preserve
        ? [{ subject: action.preserve.selectedSubject, body: action.preserve.body, savedAt: at, reason: 'before_regeneration' as const }, ...existing.previousVersions].slice(0, 10)
        : existing.previousVersions;
      return { drafts: state.drafts.map((d) => (d.id === existing.id ? { ...d, ...generated, previousVersions } : d)) };
    }
    case 'replaced':
      return {
        drafts: state.drafts.map((d) => {
          if (d.id !== action.id) return d;
          const previousVersions = action.preserve
            ? [{ subject: action.preserve.selectedSubject, body: action.preserve.body, savedAt: action.at, reason: 'before_regeneration' as const }, ...d.previousVersions].slice(0, 10)
            : d.previousVersions;
          return { ...d, ...action.content, status: 'review', approvedAt: null, updatedAt: action.at, previousVersions };
        }),
      };
    case 'save':
      return { drafts: state.drafts.map((d) => (d.id === action.id ? applyEdits(d, action.edits, action.at) : d)) };
    case 'approve':
      return {
        drafts: state.drafts.map((d) => {
          if (d.id !== action.id) return d;
          const saved = applyEdits(d, action.edits, action.at);
          return { ...saved, status: 'approved', approvedAt: action.at, updatedAt: action.at };
        }),
      };
  }
}
