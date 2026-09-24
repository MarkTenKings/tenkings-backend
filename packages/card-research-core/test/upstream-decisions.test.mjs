import assert from 'node:assert/strict';
import test from 'node:test';
import { parseEbaySoldCompsV2Candidate } from '@tenkings/ebay-sold-comps-v2';
import { assessStaffInventoryResearchComparison, compareStaffInventoryResearchCondition, inspectStaffInventoryResearchSale, inspectStaffInventoryResearchTitle, readStaffInventoryResearchGradeEvidence, staffInventoryResearchYearForms, } from '../src/decisions.mjs';
const description = (changes = {}) => ({
    name: 'Jayson Tatum', category: 'Sports cards', manufacturer: 'Panini', card_number: '77', year: '2023-24',
    set_name: 'Contenders Basketball', variant: null, card_type: 'Basketball', ...changes,
});
const candidate = (title = '2023-24 Panini Contenders #77 Jayson Tatum Boston Celtics', changes = {}) => ({
    id: 'ebay:111111111111', source: 'SoldCompsAPI', listing_url: 'https://www.ebay.com/itm/111111111111', title,
    retrieved_at: '2026-09-16T00:00:00.000Z', source_response_sha256: 'a'.repeat(64), sold_price: '20.00', sold_price_cents: 2000,
    sold_currency: 'USD', best_offer_accepted: false, sold_date: '2026-09-01', sold_date_raw: '2026-09-01',
    condition: 'Ungraded', grader: null, numeric_grade: null, raw: true,
    image_url: 'https://i.ebayimg.com/images/g/example/s-l400.jpg',
    image: { source_url: 'https://i.ebayimg.com/images/g/example/s-l400.jpg', sha256: 'b'.repeat(64), retrieved_at: '2026-09-16T00:00:00.000Z', content_type: 'image/jpeg', byte_size: 1000, storage_key: null },
    source_eligible: true, exclusion_reason: null, ...changes,
});
const comparison = (changes = {}) => ({
    candidate_id: 'ebay:111111111111', classification: 'matched', identity_match: true, variant_match: true, visual_match: true,
    condition_match: true, reason: 'The supplied images support the same card and condition.', ...changes,
});
const raw = { status: 'raw', grader: null, numeric_grade: null, photo_evidence: 'The uploaded card is ungraded.' };
const graded = (grader, numeric_grade) => ({ status: 'graded', grader, numeric_grade, photo_evidence: `The uploaded label reads ${grader} ${numeric_grade}.` });
const bo = description({ name: 'Bo Bichette', year: '2020', manufacturer: 'Topps', set_name: 'Topps Baseball', card_number: '85A-BB', card_type: 'Baseball' });
const boTitle = '2020 Topps Bo Bichette 1985 35th Anniversary Auto RC #85A-BB Blue Jays PSA 9';
const reference = (saved) => ({
    id: 'catalog:fixture', kind: 'catalog', trust: 'published_catalog', catalog_id: 'catalog-fixture', variant_name: 'Base', variant_kind: 'BASE',
    identity: { name: saved.name, category: saved.category, manufacturer: saved.manufacturer, year: saved.year, set_name: saved.set_name, card_number: saved.card_number },
    source_url: null, source_sha256: 'c'.repeat(64), captured_at: '2026-09-16T00:00:00.000Z', distinguishing_features: ['Fixture diagnostic'], image: null,
});
test('2020 release and 1985 35th anniversary design remain distinct at research and final title gates', () => {
    const listing = candidate(boTitle, { condition: 'Graded' });
    const title = inspectStaffInventoryResearchTitle(bo, listing, reference(bo));
    assert.equal(title.research_anchored, true);
    assert.equal(title.estimate_anchored, true);
    assert.deepEqual(title.year, { status: 'matched', matched: ['2020'], design: ['1985'], conflicting: [], ambiguous: [] });
    assert.ok(title.reason_codes.includes('design_year_supported'));
    const decision = assessStaffInventoryResearchComparison(listing, bo, graded('PSA', 9), comparison());
    assert.equal(decision.assessment.classification, 'matched');
    assert.equal(decision.evidence.grade.numeric_grade, 9);
    assert.equal(listing.raw, true, 'The helper does not rewrite the candidate or shared parser fields.');
});
test('true wrong release years and multiple conflicting releases cannot use an anniversary exemption', () => {
    for (const title of [boTitle.replace('2020', '2021'), boTitle.replace('2020 Topps', '2020 Topps 2021 Topps'), boTitle.replace('2020 Topps', '2019 Topps')]) {
        const decision = assessStaffInventoryResearchComparison(candidate(title), bo, graded('PSA', 9), comparison());
        assert.equal(decision.assessment.classification, 'rejected', title);
        assert.ok(decision.reason_codes.includes('release_year_conflict'), title);
        assert.equal(decision.evidence.title.estimate_anchored, false);
    }
});
test('untyped additional years and inconsistent anniversaries remain uncertain rather than invented release conflicts', () => {
    for (const title of [boTitle.replace('35th Anniversary', 'special'), boTitle.replace('35th', '40th'), boTitle.replace('2020 Topps ', 'Topps ')]) {
        const decision = assessStaffInventoryResearchComparison(candidate(title), bo, graded('PSA', 9), comparison());
        assert.equal(decision.assessment.classification, 'possible', title);
        assert.ok(decision.reason_codes.includes('release_year_ambiguous'), title);
        assert.equal(decision.reason_codes.includes('release_year_conflict'), false, title);
        assert.equal(decision.evidence.title.estimate_anchored, false);
    }
});
test('explicit design wording needs a matching printed release year, not just the saved year', () => {
    const valid = candidate(boTitle.replace('35th Anniversary', 'design'));
    assert.equal(inspectStaffInventoryResearchTitle(bo, valid).estimate_anchored, true);
    const missing = candidate(boTitle.replace('2020 Topps ', 'Topps ').replace('35th Anniversary', 'design'));
    assert.equal(inspectStaffInventoryResearchTitle(bo, missing).year.status, 'ambiguous');
    assert.equal(inspectStaffInventoryResearchTitle(bo, missing).estimate_anchored, false);
    const futureDesign = candidate(boTitle.replace('1985 35th Anniversary', '2021 design'));
    assert.equal(inspectStaffInventoryResearchTitle(bo, futureDesign).year.status, 'ambiguous');
});
test('all adjacent season aliases accepted for retrieval also pass final title validation', () => {
    for (const year of ['2023-24', '2023/24', '2023-2024', '2023/2024', '2023', '2024', '2023–24']) {
        const listing = candidate(`${year} Panini Contenders #77 Jayson Tatum`);
        assert.equal(inspectStaffInventoryResearchTitle(description(), listing, reference(description())).estimate_anchored, true, year);
        assert.equal(assessStaffInventoryResearchComparison(listing, description(), raw, comparison()).assessment.classification, 'matched', year);
    }
    assert.ok(staffInventoryResearchYearForms('1999-00').includes('2000'));
    assert.deepEqual(staffInventoryResearchYearForms('2023-25'), ['2023-25']);
});
test('season aliases do not weaken an actual wrong season or a saved individual-year identity', () => {
    for (const [saved, year] of [[description(), '2024-25'], [description(), '2022'], [description({ year: '2023' }), '2024']]) {
        const decision = assessStaffInventoryResearchComparison(candidate(`${year} Panini Contenders #77 Jayson Tatum`), saved, raw, comparison());
        assert.equal(decision.assessment.classification, 'rejected');
        assert.ok(decision.reason_codes.includes('release_year_conflict'));
    }
});
test('only descriptive category and sport suffixes may be absent while exact product and name remain', () => {
    const valid = inspectStaffInventoryResearchTitle(description({ set_name: 'Contenders Basketball Cards' }), candidate());
    assert.equal(valid.estimate_anchored, true);
    assert.ok(valid.reason_codes.includes('descriptive_suffix_omitted'));
    for (const [saved, title] of [
        [description({ set_name: 'Contenders Optic Basketball' }), '2023-24 Panini Contenders Jayson Tatum #77'],
        [description({ set_name: 'Bowman University Chrome Basketball' }), '2023-24 Panini Bowman Chrome Jayson Tatum #77'],
        [description(), '2023-24 Panini Phoenix Jayson Tatum #77'],
        [description(), '2023-24 Panini Contenders Jaylen Brown #77'],
    ]) {
        const result = inspectStaffInventoryResearchTitle(saved, candidate(title));
        assert.equal(result.research_anchored, false, title);
        assert.equal(result.estimate_anchored, false, title);
    }
});
test('explicit sport and product qualifiers cannot hide behind a category-word omission', () => {
    for (const [saved, title, reason] of [
        [description(), '2023-24 Panini Contenders Football Jayson Tatum #77', 'sport_conflict'],
        [description(), '2023-24 Panini Contenders Optic Jayson Tatum #77', 'product_title_conflict'],
        [description(), '2023-24 Panini Contenders Jayson Tatum Optic #77', 'product_title_conflict'],
        [bo, boTitle.replace('2020 Topps', '2020 Topps Chrome'), 'product_title_conflict'],
        [bo, '2020 Topps Bo Bichette Chrome #85A-BB PSA 9', 'product_title_conflict'],
    ]) {
        const decision = assessStaffInventoryResearchComparison(candidate(title), saved, saved === bo ? graded('PSA', 9) : raw, comparison());
        assert.equal(decision.assessment.classification, 'rejected');
        assert.ok(decision.reason_codes.includes(reason));
    }
});
test('research preserves all exact name and product tokens when seller titles interleave them', () => {
    const saved = description({ name: 'Patrick Mahomes II', year: '2024', card_number: '33', set_name: 'Donruss Bomb Squad', card_type: 'Football' });
    const listing = candidate('2024 Panini Donruss Patrick Mahomes II Bomb Squad #33 Chiefs PSA 10');
    const decision = assessStaffInventoryResearchComparison(listing, saved, graded('PSA', 10), comparison());
    assert.equal(decision.assessment.classification, 'matched');
    assert.equal(decision.evidence.title.research_anchored, true);
    assert.equal(decision.evidence.title.estimate_anchored, false, 'The final estimate gate retains the stronger exact product span.');
    const absent = { ...listing, title: listing.title.replace('Bomb Squad ', '') };
    assert.equal(assessStaffInventoryResearchComparison(absent, saved, graded('PSA', 10), comparison()).assessment.classification, 'possible');
});
test('extra product words are not universally treated as contradictions when the expected product is missing or distinct', () => {
    const saved = description({ manufacturer: 'Topps', name: 'Elly De La Cruz', year: '2025', set_name: 'Topps NSCC Silver Pack', card_number: 'MLB-18', card_type: 'Baseball' });
    const result = inspectStaffInventoryResearchTitle(saved, candidate('2025 Topps Chrome NSCC Silver Pack Elly De La Cruz #MLB-18'));
    assert.equal(result.research_anchored, true);
    assert.equal(result.reason_codes.includes('product_title_conflict'), false);
    const unknown = inspectStaffInventoryResearchTitle({ ...saved, set_name: null }, candidate('2025 Topps Finest Elly De La Cruz #MLB-18'));
    assert.equal(unknown.research_anchored, false);
    assert.equal(unknown.reason_codes.includes('product_title_conflict'), false);
    assert.ok(unknown.reason_codes.includes('product_anchor_missing'));
});
test('card number contradictions preserve prefixes, denominators and leading zeroes', () => {
    for (const [number, shown] of [['77', '#383'], ['007', '#7'], ['RC1/RC25', '#RC1'], ['74/102', '74/100'], ['85A-BB', '#85A-BC']]) {
        const saved = description({ card_number: number });
        const decision = assessStaffInventoryResearchComparison(candidate(`2023-24 Panini Contenders Jayson Tatum ${shown}`), saved, raw, comparison());
        assert.equal(decision.assessment.classification, 'rejected', `${number} / ${shown}`);
        assert.ok(decision.reason_codes.includes('card_number_conflict'));
    }
    assert.equal(inspectStaffInventoryResearchTitle(description({ card_number: 'RC1/RC25' }), candidate('2023-24 Panini Contenders Jayson Tatum #RC1 / RC25')).estimate_anchored, true);
});
test('sports numeric card numbers remain distinct from whitespace-separated serial limits', () => {
    const saved = description({ name: 'Draymond Green', year: '2024-25', set_name: 'Select Basketball', card_number: '302' });
    const prefix = 'Panini 2024-25 Select Basketball Draymond Green Prizm Mezzanine';
    for (const number of ['#302 /99', '#302 / 99', '(#302 /99)', '# 302 /99']) {
        const listing = candidate(`${prefix} ${number}`);
        const title = inspectStaffInventoryResearchTitle(saved, listing);
        assert.equal(title.number_anchored, true, number);
        assert.equal(title.estimate_anchored, true, number);
        assert.equal(title.reason_codes.includes('card_number_conflict'), false, number);
        assert.equal(assessStaffInventoryResearchComparison(listing, saved, raw, comparison()).assessment.classification, 'matched', number);
        assert.equal(assessStaffInventoryResearchComparison(listing, saved, raw, comparison({ classification: 'possible', variant_match: false })).assessment.classification, 'possible', number);
    }
    assert.equal(inspectStaffInventoryResearchTitle(description({ card_number: '007' }), candidate('2023-24 Panini Contenders Jayson Tatum #007 /99')).estimate_anchored, true);
});
test('sports serial separation preserves wrong numbers, leading zeros and unseparated slash ambiguity', () => {
    const saved = description({ card_number: '302' });
    for (const number of ['#303 /99', '#0302 /99', '#302/99', '#302/ 99', '#302 /99 /10', '#302 /RC25']) {
        const decision = assessStaffInventoryResearchComparison(candidate(`2023-24 Panini Contenders Jayson Tatum ${number}`), saved, raw, comparison());
        assert.equal(decision.assessment.classification, 'rejected', number);
        assert.ok(decision.reason_codes.includes('card_number_conflict'), number);
    }
    const leadingZero = inspectStaffInventoryResearchTitle(description({ card_number: '007' }), candidate('2023-24 Panini Contenders Jayson Tatum #7 /99'));
    assert.equal(leadingZero.number_anchored, false);
    assert.ok(leadingZero.reason_codes.includes('card_number_conflict'));
});
test('serial separation does not discard saved fractional or alphanumeric card numbers or Pokemon denominators', () => {
    for (const category of ['Sports cards', 'Pokemon']) {
        for (const [number, shown] of [['74/102', '#74 / 102'], ['RC1/RC25', '#RC1 / RC25'], ['302/99', '#302 /99']]) {
            const saved = description({ category, card_number: number });
            assert.equal(inspectStaffInventoryResearchTitle(saved, candidate(`2023-24 Panini Contenders Jayson Tatum ${shown}`)).number_anchored, true, `${category}: ${number}`);
            const wrong = inspectStaffInventoryResearchTitle(saved, candidate(`2023-24 Panini Contenders Jayson Tatum ${shown.replace(/\d+$/, '100')}`));
            assert.ok(wrong.reason_codes.includes('card_number_conflict'), `${category}: ${number}`);
        }
    }
    for (const saved of [description({ category: 'Pokemon', card_number: '302' }), description({ card_number: 'RC1' })]) {
        const title = inspectStaffInventoryResearchTitle(saved, candidate(`2023-24 Panini Contenders Jayson Tatum #${saved.card_number} /99`));
        assert.ok(title.reason_codes.includes('card_number_conflict'));
    }
});
test('a serial denominator, certification or grade still cannot supply the saved number after serial separation', () => {
    for (const [number, shown] of [['302', '/302'], ['302', '/ 302'], ['302', '#303 /302'], ['302', '#303 / 302'], ['302', 'PSA Cert #302 /99'], ['302', 'serial 302'], ['302', '$302'], ['8', 'PSA 8 /99']]) {
        const title = inspectStaffInventoryResearchTitle(description({ card_number: number }), candidate(`2023-24 Panini Contenders Jayson Tatum ${shown}`));
        assert.equal(title.number_anchored, false, shown);
        assert.equal(title.estimate_anchored, false, shown);
    }
});
test('serial denominators, slab grades, certification numbers and prices cannot stand in for a missing card number', () => {
    for (const [number, shown] of [['35', '/35'], ['8', 'PSA 8'], ['8', 'Professional Sports Authenticator 8'], ['12345678', 'PSA 8 Cert #12345678'], ['8', '$8']]) {
        const result = inspectStaffInventoryResearchTitle(description({ card_number: number }), candidate(`2023-24 Panini Contenders Jayson Tatum ${shown}`));
        assert.equal(result.number_anchored, false, shown);
        assert.equal(result.estimate_anchored, false, shown);
    }
    const wrong = assessStaffInventoryResearchComparison(candidate('2023-24 Panini Contenders Jayson Tatum #23 /35'), description({ card_number: '35' }), raw, comparison());
    assert.equal(wrong.assessment.classification, 'rejected');
    const cert = inspectStaffInventoryResearchTitle(description(), candidate('2023-24 Panini Contenders Jayson Tatum #77 PSA 8 Cert #12345678'));
    assert.equal(cert.estimate_anchored, true);
    assert.equal(cert.reason_codes.includes('card_number_conflict'), false);
});
test('PSA NM-MT 8 is recognized privately without changing the shared grader parser', () => {
    const title = '1989 Donruss Ken Griffey Jr #33 PSA NM-MT 8';
    assert.deepEqual(readStaffInventoryResearchGradeEvidence(title, 'Graded'), { status: 'graded', grader: 'PSA', numeric_grade: 8, reason_codes: ['listing_grade_explicit'] });
    const shared = parseEbaySoldCompsV2Candidate({ itemId: '111111111111', url: 'https://www.ebay.com/itm/111111111111', title, condition: 'Graded' }, {
        category: 'SPORTS', playerName: 'Ken Griffey Jr', year: '1989', manufacturer: 'Donruss', productSet: 'Donruss', cardNumber: '33',
    });
    assert.ok(shared);
    assert.equal(shared.raw, true);
    assert.equal(shared.grader, null);
    const decision = assessStaffInventoryResearchComparison(candidate(title, { condition: 'Graded' }), description({ name: 'Ken Griffey Jr', manufacturer: 'Donruss', set_name: 'Donruss Baseball', card_number: '33', year: '1989', card_type: 'Baseball' }), graded('PSA', 8), comparison());
    assert.equal(decision.assessment.classification, 'matched');
});
test('private grade parsing handles known descriptors and preserves exact grading companies and fractions', () => {
    for (const [text, grader, numeric] of [['PSA NM–MT 8', 'PSA', 8], ['PSA GEM-MINT 10', 'PSA', 10], ['BGS GEM MINT 9.5', 'BGS', 9.5], ['SGC 9', 'SGC', 9], ['CGC 8.5', 'CGC', 8.5]]) {
        const result = readStaffInventoryResearchGradeEvidence(text, null);
        assert.equal(result.status, 'graded', text);
        assert.equal(result.grader, grader);
        assert.equal(result.numeric_grade, numeric);
    }
});
test('ambiguous slab labels are unresolved and unselectable even when the legacy candidate says raw', () => {
    for (const label of ['PSA', 'PSA Authentic', 'PSA 8/9', 'PSA 8-9', 'PSA 8 or 9', 'PSA 8 & 9', 'PSA 8, 9', 'PSA 8?', 'PSA 8+', 'PSA 8 (OC)', 'PSA 8 SGC 8', 'PSA 8 PSA 9', 'GMA 8', 'PSA Cert #8', 'PSA 80', 'PSA 8.3', 'PSA 10.5', 'PSA 8th']) {
        const listing = candidate(`2023-24 Panini Contenders Jayson Tatum #77 ${label}`);
        const grade = readStaffInventoryResearchGradeEvidence(listing.title, listing.condition);
        assert.equal(grade.status, 'unresolved', label);
        assert.equal(compareStaffInventoryResearchCondition(graded('PSA', 8), grade), 'unresolved');
        const decision = assessStaffInventoryResearchComparison(listing, description(), graded('PSA', 8), comparison());
        assert.equal(decision.assessment.classification, 'possible', label);
        assert.equal(decision.assessment.condition_match, false);
        assert.equal(decision.reason_codes.includes('condition_mismatch'), false);
    }
    assert.equal(readStaffInventoryResearchGradeEvidence('PSA 8', 'PSA 9').status, 'unresolved');
});
test('true wrong exact grade, grader and raw-versus-graded controls stay rejected', () => {
    for (const [label, condition] of [['PSA 9', graded('PSA', 8)], ['BGS 8', graded('PSA', 8)], ['Raw', graded('PSA', 8)], ['PSA 8', raw]]) {
        const decision = assessStaffInventoryResearchComparison(candidate(`2023-24 Panini Contenders Jayson Tatum #77 ${label}`), description(), condition, comparison());
        assert.equal(decision.assessment.classification, 'rejected', label);
        assert.ok(decision.reason_codes.includes('condition_mismatch'));
    }
});
test('choose-your-card and price-range listings do not establish a specific comparable sale', () => {
    for (const suffix of ['Choose Your Card', 'Choose-Your-Card', 'You Pick', 'Pick your player', 'Select a card', 'Complete your set', '$1.00-$25.00', 'USD 1 to 25', 'lot of 2', 'reprint']) {
        const listing = candidate(`2023-24 Panini Contenders Jayson Tatum #77 ${suffix}`);
        assert.equal(inspectStaffInventoryResearchSale(listing).supported, false, suffix);
        assert.equal(assessStaffInventoryResearchComparison(listing, description(), raw, comparison()).assessment.classification, 'rejected', suffix);
    }
    assert.deepEqual(inspectStaffInventoryResearchSale(candidate(undefined, { sold_price: '1.00 – 25.00' })).reason_codes, ['unsupported_price_range']);
    assert.equal(inspectStaffInventoryResearchSale(candidate('2023-24 Panini Select Jayson Tatum #77 10/25')).supported, true);
    assert.equal(inspectStaffInventoryResearchSale(candidate('2023-24 Panini Prizm Draft Picks Jayson Tatum #77')).supported, true);
});
test('explicit wrong color-and-finish combinations stay rejected without treating Blue Jays as a parallel', () => {
    const saved = description({ variant: 'Blue Ice' });
    const wrong = assessStaffInventoryResearchComparison(candidate('2023-24 Panini Contenders Jayson Tatum #77 Red Ice'), saved, raw, comparison());
    assert.equal(wrong.assessment.classification, 'rejected');
    assert.ok(wrong.reason_codes.includes('variant_title_conflict'));
    assert.equal(assessStaffInventoryResearchComparison(candidate(boTitle), { ...bo, variant: 'Base' }, graded('PSA', 9), comparison()).reason_codes.includes('variant_title_conflict'), false);
});
test('missing images and downloaded-but-unassessed images are separate from completed visual evidence', () => {
    const missing = assessStaffInventoryResearchComparison(candidate(undefined, { image: null }), description(), raw, comparison());
    assert.equal(missing.assessment.classification, 'possible');
    assert.equal(missing.evidence.image, 'missing');
    assert.ok(missing.reason_codes.includes('listing_image_missing'));
    const pending = assessStaffInventoryResearchComparison(candidate(), description(), raw, comparison(), { comparisonCompleted: false });
    assert.equal(pending.assessment.classification, 'possible');
    assert.equal(pending.evidence.image, 'acquired_unassessed');
    assert.ok(pending.reason_codes.includes('comparison_not_completed'));
    const stale = assessStaffInventoryResearchComparison(candidate(), description(), raw, comparison({ classification: 'possible', visual_match: false, reason: 'The listing image is unavailable for a verified visual comparison.' }));
    assert.equal(stale.evidence.image, 'acquired_unassessed');
    assert.match(stale.assessment.reason, /acquired but/);
    assert.equal(stale.reason_codes.includes('listing_image_missing'), false);
    assert.equal(assessStaffInventoryResearchComparison(candidate(), description(), raw, comparison()).evidence.image, 'compared');
});
test('a research match does not supply missing final title, sold-price or catalog evidence', () => {
    const listing = candidate('Panini Contenders Jayson Tatum', { source_eligible: false, sold_price_cents: null, best_offer_accepted: null, exclusion_reason: 'Best Offer status is unavailable.' });
    const decision = assessStaffInventoryResearchComparison(listing, description(), raw, comparison());
    assert.equal(decision.assessment.classification, 'matched');
    assert.equal(decision.evidence.title.estimate_anchored, false);
    assert.ok(decision.reason_codes.includes('release_year_missing'));
    assert.ok(decision.reason_codes.includes('card_number_missing'));
    assert.equal(listing.source_eligible, false);
    assert.equal(listing.sold_price_cents, null);
});
test('a supplied catalog reference cannot substitute a different saved product or number', () => {
    for (const changes of [{ set_name: 'Phoenix' }, { set_name: 'Contenders Football' }, { set_name: null }, { card_number: '383' }, { year: '2024-25' }, { name: 'Jaylen Brown' }]) {
        const other = reference(description());
        Object.assign(other.identity, changes);
        const title = inspectStaffInventoryResearchTitle(description(), candidate(), other);
        assert.equal(title.estimate_anchored, false);
        assert.ok(title.reason_codes.includes('reference_anchor_conflict'));
    }
});
test('an exactly compatible catalog name may anchor a composite saved description without requiring its prose order', () => {
    const saved = description({ name: '2024 Fixture Cards Fixture Runner #007', manufacturer: 'Fixture Cards', year: '2024', card_number: '007', set_name: 'Fixture Chrome', card_type: 'Baseball' });
    const catalog = reference({ ...saved, name: 'Fixture Runner' });
    const listing = candidate('2024 Fixture Cards Fixture Chrome Fixture Runner #007 Base Raw');
    assert.equal(inspectStaffInventoryResearchTitle(saved, listing).estimate_anchored, false);
    assert.equal(inspectStaffInventoryResearchTitle(saved, listing, catalog).estimate_anchored, true);
    const wrongName = { ...catalog, identity: { ...catalog.identity, name: 'Fixture Other' } };
    assert.equal(inspectStaffInventoryResearchTitle(saved, listing, wrongName).estimate_anchored, false);
    assert.equal(inspectStaffInventoryResearchTitle(saved, candidate(listing.title.replace('Fixture Runner', 'Fixture Other')), catalog).estimate_anchored, false);
});
test('model mismatch and uncertainty never become a match just because deterministic anchors pass', () => {
    for (const flag of ['identity_match', 'variant_match', 'visual_match', 'condition_match']) {
        const original = comparison({ classification: 'rejected', [flag]: false });
        const decision = assessStaffInventoryResearchComparison(candidate(), description(), raw, original);
        assert.equal(decision.assessment.classification, 'rejected');
        assert.equal(decision.assessment[flag], false);
        assert.deepEqual(original, comparison({ classification: 'rejected', [flag]: false }));
    }
    assert.equal(assessStaffInventoryResearchComparison(candidate(), description(), raw, comparison({ classification: 'possible' })).assessment.classification, 'possible');
    assert.equal(assessStaffInventoryResearchComparison(candidate(), description(), raw, comparison({ variant_match: false })).assessment.classification, 'possible');
});
test('pure repeated decisions preserve every source and proposed-model field', () => {
    const listing = Object.freeze(candidate()), saved = Object.freeze(description()), proposed = Object.freeze(comparison());
    const first = assessStaffInventoryResearchComparison(listing, saved, raw, proposed);
    assert.deepEqual(assessStaffInventoryResearchComparison(listing, saved, raw, proposed), first);
    assert.notEqual(first.assessment, proposed);
    assert.equal(first.assessment.classification, 'matched');
});
