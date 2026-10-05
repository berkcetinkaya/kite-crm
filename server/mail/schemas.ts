// Structured output schema for mail drafts. Bounds (three subjects, word limits) are enforced by
// validateMailOutput, not by schema keywords the API may not support.
const str = { type: 'string' } as const;
const strArray = { type: 'array', items: str } as const;

export const MAIL_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    subjectOptions: strArray,
    body: str,
    companyObservation: { type: ['string', 'null'] },
    serviceReasoning: str,
    sectorBenefitsUsed: strArray,
    evidenceRefsUsed: strArray,
    sectorProfileUsed: { type: ['string', 'null'] },
  },
  required: ['subjectOptions', 'body', 'companyObservation', 'serviceReasoning', 'sectorBenefitsUsed', 'evidenceRefsUsed', 'sectorProfileUsed'],
  additionalProperties: false,
} as const;
