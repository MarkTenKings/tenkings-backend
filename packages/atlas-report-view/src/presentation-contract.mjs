import { z } from 'zod';

// Optional, independently versioned public presentation. This is deliberately
// outside the immutable grading packet: a photo, sale or offer cannot regrade it.
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().trim().min(1).max(180);
const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const date = z.iso.datetime();
const bindingSchema = z.strictObject({ publicToken: z.string().regex(/^ar_[A-Za-z0-9_-]{24}$/),
  approvalVersion: z.number().int().positive().max(2147483647), publicHash: hash });
const currency = z.string().regex(/^[A-Z]{3}$/);
const ebayDomains = new Set(['ebay.com','ebay.ca','ebay.co.uk','ebay.com.au','ebay.de','ebay.fr','ebay.it','ebay.es','ebay.ie','ebay.nl','ebay.at','ebay.be','ebay.ch','ebay.pl']);
const listingUrl = z.string().max(2048).refine(value => {
  try {
    if (/[\s\\\u0000-\u001f\u007f]/u.test(value)) return false;
    const url = new URL(value), host = url.hostname.replace(/^www\./, '');
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && ebayDomains.has(host) && /^\/itm\/(?:[^/]+\/)?\d+(?:\/|$)/.test(url.pathname);
  } catch { return false; }
}, 'An actual HTTPS eBay item listing is required');
const dealerUrl = z.string().max(300).refine(value => {
  try {
    if (!value.startsWith('/dealers?') || /[\s\\\u0000-\u001f\u007f]/u.test(value)) return false;
    const url = new URL(value, 'https://atlas.invalid');
    return url.pathname === '/dealers' && url.hash === '' && url.searchParams.get('service') === 'buy'
      && /^[A-Za-z0-9_-]{1,100}$/.test(url.searchParams.get('dealer') ?? '')
      && [...url.searchParams.keys()].sort().join(',') === 'dealer,service';
  } catch { return false; }
});
const sale = z.strictObject({ id: text, title: z.string().trim().min(1).max(500), listingUrl,
  grader: z.string().trim().min(1).max(40), grade: z.string().trim().min(1).max(40), soldAt: date.nullable(),
  priceMinor: money.nullable(), currency, priceBasis: z.enum(['sold', 'accepted_offer_unknown'])
}).superRefine((value, ctx) => {
  if ((value.priceBasis === 'sold') !== (value.priceMinor !== null)) ctx.addIssue({ code: 'custom', message: 'Only a disclosed sold amount can be a price' });
});
export const reportPresentationSchema = z.strictObject({ version: z.literal('atlas-report-presentation-v1'),
  binding: bindingSchema, revision: z.number().int().positive().max(2147483647), updatedAt: date,
  identityDetails: z.strictObject({ category: text.optional(), manufacturer: text.optional(), variant: text.optional(), cardType: text.optional() }).optional(),
  slabPhoto: z.strictObject({ url: z.string().max(300), sha256: hash,
    byteCount: z.number().int().positive().max(50 * 1024 * 1024), contentType: z.enum(['image/webp','image/jpeg','image/png']),
    width: z.number().int().positive().max(20000), height: z.number().int().positive().max(20000),
    alt: z.string().trim().min(1).max(300), capturedAt: date.optional() }).optional(),
  market: z.strictObject({ observedAt: date, sales: z.array(sale).max(60),
    estimate: z.strictObject({ lowMinor: money, highMinor: money, currency, asOf: date,
      method: z.string().trim().min(1).max(500), sampleCount: z.number().int().positive().max(100000) })
      .refine(value => value.lowMinor <= value.highMinor, 'Valuation range must be ordered').optional() }).optional(),
  dealerOffers: z.array(z.strictObject({ id: text, dealerName: text, dealerUrl,
    amountMinor: money, currency, expiresAt: date, terms: z.string().trim().min(1).max(1000),
    kind: z.enum(['firm','indicative']) })).max(40).optional(),
  dealerDirectory: z.strictObject({ url: z.literal('/dealers?service=buy') }).optional(),
});

export function parseReportPresentation(value, expectedBinding) {
  const parsed = reportPresentationSchema.parse(value);
  if (expectedBinding && ['publicToken','approvalVersion','publicHash'].some(key => parsed.binding[key] !== expectedBinding[key])) {
    throw new Error('REPORT_PRESENTATION_BINDING_INVALID');
  }
  if (parsed.slabPhoto && parsed.slabPhoto.url !== `/api/reports/${parsed.binding.publicToken}/presentation/image?v=${parsed.binding.approvalVersion}&revision=${parsed.revision}`) {
    throw new Error('REPORT_PRESENTATION_IMAGE_INVALID');
  }
  if (new Set(parsed.market?.sales.map(value => value.id)).size !== (parsed.market?.sales.length ?? 0)
    || new Set(parsed.dealerOffers?.map(value => value.id)).size !== (parsed.dealerOffers?.length ?? 0)) {
    throw new Error('REPORT_PRESENTATION_DUPLICATE');
  }
  return parsed;
}
