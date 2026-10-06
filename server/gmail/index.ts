// Builds the Gmail provider adapter from server configuration. Real Google when client id, secret
// and redirect URI are set; the deterministic fixture when KITE_GMAIL_PROVIDER=fixture.
import type { GmailConfig } from '../config';
import { createGmailAdapter } from './adapter';
import { createFileCredentialStore, type CredentialStore } from './credentialStore';
import { createFixtureGmail, type FixtureControls } from './fixture';
import { createGmailRestApi, createGoogleOAuthClient } from './google';
import type { GmailProviderAdapter } from './types';

export const OAUTH_CALLBACK_PATH = '/api/gmail/oauth/callback';

export function createGmailProvider(
  config: GmailConfig,
  deps: { fetch?: typeof fetch; credentials?: CredentialStore; now?: () => number } = {},
): { provider: GmailProviderAdapter; fixture: FixtureControls | null } {
  const credentials = deps.credentials ?? createFileCredentialStore(config.tokenPath, config.credentialsKey);
  if (config.provider === 'fixture') {
    const fx = createFixtureGmail({ redirectUri: config.redirectUri ?? OAUTH_CALLBACK_PATH, sendDelayMs: config.fixtureSendDelayMs, now: deps.now });
    return { provider: createGmailAdapter({ kind: 'fixture', configured: true, oauth: fx.oauth, api: fx.api, credentials }), fixture: fx.controls };
  }
  const configured = !!(config.clientId && config.clientSecret && config.redirectUri);
  const oauth = createGoogleOAuthClient({ clientId: config.clientId ?? '', clientSecret: config.clientSecret ?? '', redirectUri: config.redirectUri ?? '' }, deps.fetch);
  const api = createGmailRestApi(deps.fetch, { sendTimeoutMs: config.sendTimeoutMs });
  return { provider: createGmailAdapter({ kind: 'gmail', configured, oauth, api, credentials }), fixture: null };
}
