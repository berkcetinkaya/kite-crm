// Shared prompt blocks for follow up drafts (Phase 7), split so each part can be reviewed alone:
//   languageRules()     Turkish or English specifics                         (system)
//   companyBlock()      the company itself                                   (user turn, data)
//   evidenceBlock()     company evidence: what KITE observed                 (user turn, data)
//   guidanceBlock()     sector guidance: general knowledge, never facts      (user turn, data)
//   serviceBlock()      the KITE service and how to explain it               (user turn, data)
//   personalizationBlock() how specific the draft may be (decided by code)   (user turn)
// First contact drafts use prompt v2 (prepPrompts.ts). The model is never asked for its reasoning.
import type { MailContext } from '../../src/domain/mail/context';
import type { MailLanguage } from '../../src/domain/mail/draft';

export function languageRules(language: MailLanguage): string {
  return language === 'tr'
    ? 'Language: write the subjects and the email in natural Turkish, using "siz". Keep company and brand names exactly as given.'
    : 'Language: write the subjects and the email in natural, plain English. Keep company and brand names exactly as given. Sector names in the data may be Turkish; describe the business type in English instead of copying a Turkish label.';
}

function companyBlock(ctx: MailContext): string {
  const c = ctx.company;
  return [
    '<company>',
    `name: ${c.name}`,
    `website: ${c.website ?? 'unknown'}`,
    `location: ${c.location}`,
    `sector (Turkish label): ${ctx.sector.label}`,
    ctx.sector.familyLabel ? `sector family (Turkish label): ${ctx.sector.familyLabel}` : 'sector family: unknown',
    `greet: ${c.greetingName ?? `the ${c.name} team`}`,
    '</company>',
  ].join('\n');
}

function evidenceBlock(ctx: MailContext): string {
  const e = ctx.companyEvidence;
  if (e.items.length === 0 && e.observations.length === 0) return '<company_evidence>\nnone\n</company_evidence>';
  const lines = ['<company_evidence>'];
  for (const item of e.items) {
    lines.push(`${item.id} [${item.inspected ? 'page KITE inspected' : item.sourceType === 'official_page_unfetched' ? 'company page seen only in search results, not inspected' : 'third party search source'}] ${item.title} (${item.url})`);
    if (item.claim) lines.push(`   ${item.claim}`);
  }
  if (e.signals.length) {
    lines.push('signals (Turkish notes from research):');
    for (const s of e.signals) lines.push(`- ${s.label}: ${s.state === 'positive' ? 'supports the opportunity' : 'argues against it'}. ${s.reason} [${s.evidenceIds.join(', ')}]`);
  }
  if (e.observations.length) {
    lines.push('observations you may use (already worded for their evidence strength):');
    for (const o of e.observations) lines.push(`- ${o.sentence} [${o.evidenceIds.join(', ')}; ${o.strength === 'inspected' ? 'seen on their website' : 'search sources only'}]`);
  }
  lines.push('</company_evidence>');
  return lines.join('\n');
}

function guidanceBlock(ctx: MailContext): string {
  const g = ctx.sectorGuidance;
  if (!g) return '<sector_guidance>\nnone for this service; base the message on the company evidence and the service description\n</sector_guidance>';
  const lines = [
    '<sector_guidance>',
    `profile: ${g.profileId} (${g.source === 'generic' ? 'generic business profile, the sector is not specifically known: keep use cases general' : g.source === 'family_inferred' ? 'family level profile for a custom sector: do not assume niche workflows' : 'sector profile'})`,
    `general summary: ${ctx.language === 'tr' ? g.summaryTr : g.summaryEn}`,
    'common use cases (general, NOT facts about this company):',
    ...g.useCases.map((u) => `- ${u.id}: ${ctx.language === 'tr' ? u.tr : u.en}`),
    '</sector_guidance>',
  ];
  return lines.join('\n');
}

function serviceBlock(ctx: MailContext): string {
  const s = ctx.serviceGuidance;
  return ['<service>', `service: ${s.name.en}`, `what KITE does: ${s.pitch[ctx.language]}`, `call to action idea: ${s.cta[ctx.language]}`, '</service>'].join('\n');
}

function personalizationBlock(ctx: MailContext): string {
  return `<personalization>${ctx.personalization}</personalization>`;
}

export function mailUserPrompt(ctx: MailContext): string {
  return [companyBlock(ctx), evidenceBlock(ctx), guidanceBlock(ctx), serviceBlock(ctx), personalizationBlock(ctx), 'Write the draft.'].join('\n\n');
}
