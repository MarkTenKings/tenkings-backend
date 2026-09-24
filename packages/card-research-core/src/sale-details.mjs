// Extracted from Inventory 20643deae9b9b341fc7dfcd7fb703c53d0b73d0b. See SOURCE_MANIFEST.json.
export const STAFF_INVENTORY_RESEARCH_SALE_DETAILS_ENGINE_VERSION = 'staff-inventory-research-v5';
const record = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null ? value : null;
};
const text = (value, maximum) => typeof value === 'string'
    && value.length > 0 && value.length <= maximum && value === value.trim()
    && !/[\u0000-\u001f\u007f]|https?:\/\/|data:|\b(?:sk|sess|proj)-[A-Za-z0-9_-]{8,}|<\/?[a-z][^>]*>/i.test(value);
const hash = (value) => typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/.test(value);
const itemId = (value) => typeof value === 'string' && value === value.trim() && /^\d{10,15}$/.test(value);
function timestamp(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
        return false;
    const epoch = Date.parse(value);
    return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
}
function cents(value) {
    if (typeof value !== 'string' || value !== value.trim() || !/^\d{1,8}(?:\.\d{1,2})?$/.test(value))
        return null;
    const [whole, fraction = ''] = value.split('.');
    const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
    return amount > 0n && amount <= 2147483647n ? Number(amount) : null;
}
function calendarDate(value) {
    if (typeof value !== 'string' || !/^(?:19|20)\d{2}-\d{2}-\d{2}$/.test(value))
        return false;
    const epoch = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isFinite(epoch) && new Date(epoch).toISOString().slice(0, 10) === value;
}
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Only the complete ebay.com date spelling observed on ordinary-sale details.
 * Relative dates and yearless dates stay unknown; no current year is invented.
 * Compare the source's calendar date, not the next day's UTC date after conversion. */
function absoluteEnding(value) {
    if (typeof value !== 'string' || value !== value.trim())
        return null;
    const match = /^([A-Z][a-z]{2}) (0[1-9]|[12]\d|3[01]), ((?:19|20)\d{2}) ([01]\d|2[0-3]):([0-5]\d):([0-5]\d) (PDT|PST)$/.exec(value);
    if (!match)
        return null;
    const month = months.indexOf(match[1]), day = Number(match[2]), year = Number(match[3]);
    if (month < 0)
        return null;
    const date = `${year}-${String(month + 1).padStart(2, '0')}-${match[2]}`;
    if (!calendarDate(date))
        return null;
    const hour = Number(match[4]), minute = Number(match[5]);
    const localEpoch = Date.UTC(year, month, day, hour, minute, Number(match[6]));
    return { date, month, day, hour, minute, weekday: weekdays[new Date(localEpoch).getUTCDay()],
        epoch: localEpoch + (match[7] === 'PDT' ? 7 : 8) * 60 * 60 * 1000 };
}
function matchingSoldBanner(value, ending) {
    if (typeof value !== 'string' || value !== value.trim())
        return false;
    const match = /^(?:Item sold|This listing sold) on (Sun|Mon|Tue|Wed|Thu|Fri|Sat), ([A-Z][a-z]{2}) ([1-9]|[12]\d|3[01]) at (1[0-2]|[1-9]):([0-5]\d) (AM|PM)$/.exec(value);
    if (!match)
        return false;
    const hour = Number(match[4]) % 12 + (match[6] === 'PM' ? 12 : 0);
    return match[1] === ending.weekday && months.indexOf(match[2]) === ending.month
        && Number(match[3]) === ending.day && hour === ending.hour && Number(match[5]) === ending.minute;
}
function invalidFields(value) {
    return Object.prototype.hasOwnProperty.call(value, 'invalid_fields') && (!Array.isArray(value.invalid_fields) || value.invalid_fields.length !== 0);
}
export function resolveStaffInventoryResearchSaleDetails(input) {
    const deny = (reason) => ({ status: 'unconfirmed', sold_price_cents: null, evidence: null, reason });
    const request = record(input), searchReceipt = record(request?.search), detailReceipt = record(request?.detail);
    const search = record(searchReceipt?.item), detail = record(detailReceipt?.item);
    // Active evidence defeats every apparent detail confirmation, even an ended flag.
    if (search?.listingType === 'active' || detail?.listingType === 'active')
        return deny('ACTIVE_LISTING');
    if (!request || !searchReceipt || !detailReceipt || !search || !detail || invalidFields(search) || invalidFields(detail))
        return deny('MALFORMED_OBSERVATION');
    if (!hash(searchReceipt.response_sha256) || !hash(detailReceipt.response_sha256)
        || !timestamp(searchReceipt.retrieved_at) || !timestamp(detailReceipt.retrieved_at))
        return deny('INVALID_SOURCE_RECEIPT');
    const id = request.requested_item_id;
    if (!itemId(id) || request.candidate_id !== `ebay:${id}` || search.itemId !== id || detail.itemId !== id)
        return deny('ITEM_ID_MISMATCH');
    if (search.listingType !== 'sold' || detail.listingType != null && detail.listingType !== 'sold')
        return deny('SOLD_STATUS_UNCONFIRMED');
    if (search.bestOfferAccepted === true || detail.bestOfferAccepted === true)
        return deny('ACCEPTED_OFFER');
    if (search.bestOfferAccepted === false)
        return deny('SEARCH_OFFER_FLAG_NOT_MISSING');
    const searchOfferMissing = !Object.prototype.hasOwnProperty.call(search, 'bestOfferAccepted');
    if (!searchOfferMissing && search.bestOfferAccepted !== null)
        return deny('MALFORMED_OFFER_FLAG');
    if (detail.bestOfferAccepted !== false)
        return deny('OFFER_STATUS_UNCONFIRMED');
    for (const observation of [search, detail]) {
        if (observation.boaHydrated != null && observation.boaHydrated !== false
            || observation.boaAcceptedPrice != null || observation.boaAcceptedCurrency != null)
            return deny('HYDRATION_CONFLICT');
        if (['soldPriceMax', 'currentPriceMax', 'priceMax'].some(field => observation[field] != null))
            return deny('PRICE_OPTIONS_PRESENT');
    }
    if (!text(search.title, 500) || !text(detail.title, 500))
        return deny('INVALID_TITLE');
    const title = (value) => value.normalize('NFC').replace(/ +/g, ' ');
    if (title(search.title) !== title(detail.title))
        return deny('TITLE_MISMATCH');
    if (search.soldCurrency !== 'USD' || detail.currency !== 'USD')
        return deny('CURRENCY_UNCONFIRMED');
    const searchCents = cents(search.soldPrice), detailCents = cents(detail.price);
    if (searchCents === null || detailCents === null)
        return deny('INVALID_AMOUNT');
    if (searchCents !== detailCents)
        return deny('AMOUNT_MISMATCH');
    const ending = absoluteEnding(detail.endedDate);
    if (detail.ended !== true || !ending || !calendarDate(search.endedAt))
        return deny('ENDING_UNCONFIRMED');
    if (ending.date !== search.endedAt || ending.epoch > Date.parse(searchReceipt.retrieved_at)
        || ending.epoch > Date.parse(detailReceipt.retrieved_at))
        return deny('DATE_MISMATCH');
    if (!matchingSoldBanner(detail.soldBanner, ending))
        return deny('SOLD_BANNER_UNCONFIRMED');
    return {
        status: 'confirmed', sold_price_cents: searchCents,
        evidence: {
            schema_version: 1, basis: 'same_item_ordinary_sale_detail', candidate_id: `ebay:${id}`, item_id: id,
            search: { response_sha256: searchReceipt.response_sha256, retrieved_at: searchReceipt.retrieved_at,
                title: search.title, listing_type: 'sold', sold_price: search.soldPrice, sold_currency: 'USD',
                sold_date: search.endedAt, offer_field: searchOfferMissing ? 'absent' : 'null' },
            detail: { response_sha256: detailReceipt.response_sha256, retrieved_at: detailReceipt.retrieved_at,
                title: detail.title, price: detail.price, currency: 'USD', best_offer_accepted: false, ended: true,
                ended_date_raw: detail.endedDate, sold_date: ending.date, sold_banner: detail.soldBanner },
        },
    };
}
