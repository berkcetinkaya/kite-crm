// Mail generation goes through this adapter. Anthropic is the real implementation; the fixture
// provider produces deterministic drafts offline (tests, local UI work) without any API call.
import type { FollowUpContext } from '../../src/domain/mail/followUpContext';
import type { PrepContext } from '../../src/domain/mail/prepContext';

export interface MailProviderAdapter {
  readonly id: 'anthropic' | 'fixture';
  readonly model: string | null;
  /**
   * Follow up draft (Phase 7). Raw (untrusted) output, validated by validateFollowUpOutput. Called
   * ONLY from Berk's explicit "Takip Taslağını Hazırla" request, never by due detection or timers.
   */
  generateFollowUp?(ctx: FollowUpContext, signal?: AbortSignal): Promise<unknown>;
  /**
   * Prepared first contact draft (Phase 13, prompt v2). Raw (untrusted) output, validated by
   * validatePrepOutput. Called only from Berk's explicit "Taslak hazırla" (single or batch).
   */
  generatePrepared?(ctx: PrepContext, signal?: AbortSignal): Promise<unknown>;
}
