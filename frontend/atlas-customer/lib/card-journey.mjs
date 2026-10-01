// A presentation of recorded facts, never a clock-driven workflow simulator.
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
export const safeReportPath = value => typeof value === 'string' && /^\/reports\/ar_[A-Za-z0-9_-]{24}(?:\?v=[1-9][0-9]*)?$/.test(value) ? value : null;
export function cardJourney(card) {
  const events = Array.isArray(card.events) ? card.events : [];
  const event = kind => events.find(row => row.kind === kind && validTime(row.occurredAt ?? row.recordedAt));
  const at = kind => { const row = event(kind); return row?.occurredAt ?? row?.recordedAt ?? null; };
  const shop = card.channel === 'KIOSK' || card.intakeMethod === 'DEALER_DROP_OFF';
  const approved = card.grading === 'HUMAN_APPROVED' || ['APPROVED','ENCAPSULATED','SHIPPED'].includes(card.stage);
  const grading = approved || card.grading === 'IN_GRADING' || ['GRADING','FINAL_REVIEW'].includes(card.stage);
  const delivered = at(shop ? 'CUSTOMER_COLLECTED' : 'CUSTOMER_DELIVERED');
  const returning = at(shop ? 'RETURN_DISPATCHED' : 'MAIL_DISPATCHED') ?? at('SHIPPED');
  const received = at('ATLAS_RECEIVED') ?? at('RECEIVED');
  const collected = at('COLLECTED');
  const handedOver = at('DEALER_RECEIVED');
  const ready = at('RETURNED_TO_KIOSK');
  const steps = [
    {key:'submission',label:'Submitted',recordedAt:card.paidAt ?? at('SUBMITTED'),confirmed:Boolean(card.paidAt || card.orderId || card.stage || at('SUBMITTED'))},
    ...(shop ? [{key:'handoff',label:'At shop',recordedAt:handedOver,confirmed:Boolean(handedOver)}, {key:'collection',label:'Collected',recordedAt:collected,confirmed:Boolean(collected)}] : []),
    {key:'received',label:'At ATLAS',recordedAt:received,confirmed:Boolean(received)},
    {key:'grading',label:'Grading',recordedAt:at('GRADING'),confirmed:grading},
    {key:'approved',label:'Approved',recordedAt:card.approvedAt ?? at('APPROVED'),confirmed:approved},
    {key:'return',label:shop?'Returning':'Shipped',recordedAt:returning,confirmed:Boolean(returning)},
    {key:'home',label:shop?'Picked up':'Delivered',recordedAt:delivered,confirmed:Boolean(delivered)},
  ];
  let current = delivered ? 'home' : returning || ready ? 'return' : approved ? 'approved' : grading ? 'grading' : received ? 'received' : collected ? 'collection' : handedOver ? 'handoff' : 'submission';
  let label = delivered ? 'Back in your hands' : ready ? 'Ready for pickup' : returning ? 'On the way back' : approved ? 'Your grade is ready' : grading ? 'Being graded' : received ? 'Safe at ATLAS' : collected ? 'Collected by ATLAS' : handedOver ? 'Received by your card shop' : 'Ready for your handoff';
  let detail = delivered ? 'Your return has been recorded.' : ready ? `Your cards are ready at ${card.originalLocation || 'your card shop'}.` : returning ? 'Follow the recorded return updates below.' : approved ? 'Open your approved report and explore every finding.' : grading ? 'Your card is in the ATLAS grading workflow.' : received ? 'We have recorded physical receipt of your card.' : collected ? 'Your card is on its way from the shop to ATLAS.' : handedOver ? 'Staff confirmed your card handoff. ATLAS collection comes next.' : shop ? 'Complete your handoff at the card shop.' : 'Pack your cards and follow your saved shipping instructions.';
  const lastDelay = [...events].reverse().find(row => ['DELAY_REPORTED','DELAY_RESOLVED'].includes(row.kind));
  const attention = card.actionNeeded?.message || (lastDelay?.kind === 'DELAY_REPORTED' ? lastDelay.note || 'A route delay has been recorded.' : null);
  const reportUrl = safeReportPath(card.reportUrl);
  return {steps,current,label,detail,attention,complete:Boolean(delivered),reportUrl,shop};
}
export function orderJourney(cards) {
  const journeys = cards.map(cardJourney), complete = journeys.length > 0 && journeys.every(card => card.complete);
  const attention = journeys.filter(card => card.attention).length;
  const counts = new Map();
  for (const card of journeys) counts.set(card.label, (counts.get(card.label) ?? 0) + 1);
  return {complete,attention,summary:[...counts].map(([label,count]) => ({label,count})),approved:journeys.filter(card => card.reportUrl).length};
}
