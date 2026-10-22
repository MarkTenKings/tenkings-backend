// A public display projection, never an authority assertion. Keep the complete
// retained packet private: adapters may add internal metadata at any depth.
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 2000;
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const optionalText = value => value === null || text(value);
function publicMedia(media) {
  if (!media || !text(media.objectId) || !digest(media.sha256) || !text(media.url) || !Number.isSafeInteger(media.width) || media.width <= 0 || !Number.isSafeInteger(media.height) || media.height <= 0) return null;
  return { objectId: media.objectId, sha256: media.sha256, url: media.url, width: media.width, height: media.height };
}

export function publicApprovedCard(card) {
  if (!card || !['cardId','certificateId','approvalId','reportUrl'].every(key => text(card[key])) || !Number.isSafeInteger(card.reportVersion) || card.reportVersion <= 0 || !digest(card.reportHash)) return null;
  const identity = card.identity;
  if (!identity || !text(identity.name) || !['SPORTS','POKEMON'].includes(identity.category) || !optionalText(identity.year) || !optionalText(identity.set) || !Number.isFinite(identity.grade) || identity.grade < 0 || identity.grade > 10 || !(identity.numberedDenominator === null || Number.isSafeInteger(identity.numberedDenominator) && identity.numberedDenominator > 0) || ![true,false,null].includes(identity.autograph) || ![true,false,null].includes(identity.relic)) return null;
  const front = publicMedia(card.media?.front), back = publicMedia(card.media?.back);
  if (!front || !back) return null;
  return {
    cardId: card.cardId, certificateId: card.certificateId, approvalId: card.approvalId,
    reportVersion: card.reportVersion, reportHash: card.reportHash, reportUrl: card.reportUrl,
    identity: { name: identity.name, category: identity.category, year: identity.year, set: identity.set, grade: identity.grade, numberedDenominator: identity.numberedDenominator, autograph: identity.autograph, relic: identity.relic },
    media: { front, back },
  };
}
