// Deterministic offline mail writer (tests, local UI work): no API key, no cost. First contact
// drafts come from composeFixturePrepared (Phase 13, prompt v2 rules); follow ups from
// composeFixtureFollowUp (Phase 7).
import { ProviderError } from '../research/provider';
import { composeFixtureFollowUp } from './fixtureFollowUp';
import { composeFixturePrepared } from './fixturePrep';
import type { MailProviderAdapter } from './provider';

export function createFixtureMailProvider(): MailProviderAdapter {
  return {
    id: 'fixture',
    model: null,
    async generateFollowUp(ctx) {
      if (ctx.base.company.name.startsWith('Provider Down')) throw new ProviderError('unavailable', 'fixture: provider down');
      return composeFixtureFollowUp(ctx);
    },
    async generatePrepared(ctx) {
      return composeFixturePrepared(ctx);
    },
  };
}
