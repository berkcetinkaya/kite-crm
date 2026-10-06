// Mail generation goes through this adapter. Anthropic is the real implementation; the fixture
// provider produces deterministic drafts offline (tests, local UI work) without any API call.
import type { MailContext } from '../../src/domain/mail/context';
import type { FollowUpContext } from '../../src/domain/mail/followUpContext';

export interface MailProviderAdapter {
  readonly id: 'anthropic' | 'fixture';
  readonly model: string | null;
  /** Returns raw (untrusted) output; validated by validateMailOutput. */
  generate(ctx: MailContext, signal?: AbortSignal): Promise<unknown>;
  /**
   * Follow up draft (Phase 7). Raw (untrusted) output, validated by validateFollowUpOutput. Called
   * ONLY from Berk's explicit "Takip Taslağını Hazırla" request, never by due detection or timers.
   */
  generateFollowUp?(ctx: FollowUpContext, signal?: AbortSignal): Promise<unknown>;
}

/** Bumped when prompt structure changes, recorded on every draft. */
export const MAIL_PROMPT_VERSION = 'mail-v1';
