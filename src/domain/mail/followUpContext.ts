// Follow up generation context (Phase 7). Built on the server from STORED data only: the first
// contact context (company, sector, Phase 4 evidence, sector guidance, personalization decided by
// code), the immutable snapshots of what was actually sent in this conversation, and the step.
//
// The same evidence rules as the first email apply: company facts only from companyEvidence,
// sector guidance only as general statements. Nothing from the rest of the mailbox is included;
// replies are never part of the context because a reply stops the sequence before generation.
import type { MailContext } from './context';

export type FollowUpPurpose = 'gentle_reminder' | 'new_angle' | 'close_loop';

/** Step purpose by step number: 1 gentle reminder, 2 one useful new angle, 3 close the loop. */
export function followUpPurpose(stepNumber: number): FollowUpPurpose {
  return stepNumber <= 1 ? 'gentle_reminder' : stepNumber === 2 ? 'new_angle' : 'close_loop';
}

/** One message KITE already sent in this conversation (immutable outbound snapshot + provenance). */
export interface FollowUpPreviousMessage {
  /** "original" for the first contact, "followup_1", "followup_2" for earlier follow ups. */
  ref: string;
  stepNumber: number;
  body: string;
  sentAt: string;
  angle: string | null;
  companyObservation: string | null;
  evidenceRefsUsed: string[];
  sectorBenefitsUsed: string[];
}

export interface FollowUpContext {
  base: MailContext;
  stepNumber: number;
  maxSteps: number;
  purpose: FollowUpPurpose;
  /** The conversation's subject; follow ups never get a new subject. */
  subject: string;
  previousMessages: FollowUpPreviousMessage[];
  outreachHistory: { firstSentAt: string; lastSentAt: string; followUpsSent: number; daysSinceLastMessage: number };
  /** Sector use cases not used by any earlier message (preferred for a new angle). */
  unusedBenefitIds: string[];
  usedBenefitIds: string[];
  usedEvidenceIds: string[];
  usedAngles: string[];
}

export function buildFollowUpContext(input: {
  base: MailContext;
  stepNumber: number;
  maxSteps: number;
  subject: string;
  previousMessages: FollowUpPreviousMessage[];
  now: string;
}): FollowUpContext {
  const prev = [...input.previousMessages].sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  const usedBenefitIds = [...new Set(prev.flatMap((m) => m.sectorBenefitsUsed))];
  const usedEvidenceIds = [...new Set(prev.flatMap((m) => m.evidenceRefsUsed))];
  const usedAngles = prev.map((m) => m.angle).filter((a): a is string => !!a);
  const all = input.base.sectorGuidance?.useCases.map((u) => u.id) ?? [];
  const first = prev[0]?.sentAt ?? input.now;
  const last = prev.at(-1)?.sentAt ?? input.now;
  return {
    base: input.base,
    stepNumber: input.stepNumber,
    maxSteps: input.maxSteps,
    purpose: followUpPurpose(input.stepNumber),
    subject: input.subject,
    previousMessages: prev,
    outreachHistory: {
      firstSentAt: first,
      lastSentAt: last,
      followUpsSent: prev.filter((m) => m.stepNumber > 0).length,
      daysSinceLastMessage: Math.max(0, Math.floor((new Date(input.now).getTime() - new Date(last).getTime()) / 86_400_000)),
    },
    unusedBenefitIds: all.filter((id) => !usedBenefitIds.includes(id)),
    usedBenefitIds,
    usedEvidenceIds,
    usedAngles,
  };
}
