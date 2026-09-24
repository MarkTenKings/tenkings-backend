// Sanitized retained Snivy model responses from the timing diagnostic. Only
// the nine candidates with images in either round are retained; fifteen rows
// without compared images are omitted. Public card facts and retained comparison
// text are unchanged. Listing IDs and original-photo hashes are fixture values.
// No source images, private storage paths, credentials or actual sale amounts.
export const retainedSnivyAnalysis1 = {
    "identity": {
        "status": "unresolved",
        "variant_name": null,
        "suggestion": null,
        "reason": "No published catalog evidence was supplied.",
        "reference_ids": [],
        "photo_features": []
    },
    "target_condition": {
        "status": "raw",
        "grader": null,
        "numeric_grade": null,
        "photo_evidence": "Both originals show a loose card without a grading holder or label. The back shows edge whitening, particularly along the bottom."
    },
    "photo_identity": {
        "schema_version": 1,
        "status": "unresolved",
        "observations": [
            {
                "field": "name",
                "value": "Snivy",
                "side": "front",
                "photo_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "observation": "The heading reads “BASIC Snivy,” with HP 50."
            },
            {
                "field": "card_number",
                "value": "RC1/RC25",
                "side": "front",
                "photo_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "observation": "The bottom-right number reads “RC1/RC25.”"
            },
            {
                "field": "year",
                "value": "2013",
                "side": "front",
                "photo_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "observation": "The lower-left copyright line reads “©2013 Pokémon”; this is a copyright date rather than an explicit release statement."
            },
            {
                "field": "manufacturer",
                "value": "Pokémon",
                "side": "back",
                "photo_sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                "observation": "Yellow Pokémon wordmarks appear above and below the central Poké Ball."
            },
            {
                "field": "set_name",
                "value": "RC numbering and bottom-right set emblem",
                "side": "front",
                "photo_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "observation": "An emblem appears beside RC1/RC25, but the full saved product/set name is not printed."
            },
            {
                "field": "treatment",
                "value": "Yellow border, green text panel and vine artwork",
                "side": "front",
                "photo_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "observation": "Snivy appears among curling vines above Growth and Razor Leaf. The photograph does not resolve a distinctive foil pattern or printing mark sufficiently to establish the exact treatment."
            }
        ],
        "reason": "The name, Basic designation and full number are readable. Exact treatment and full release/set identity cannot be independently established from the originals; seller descriptions cannot fill those gaps."
    },
    "selected_candidate_ids": [],
    "comparisons": [
        {
            "candidate_id": "ebay:111111111100",
            "classification": "possible",
            "reason": "English Snivy artwork and RC1/RC25 agree, and the card is raw. Strong reflective texture is visible in the listing but not resolved on the original; exact treatment remains uncertain.",
            "identity_match": true,
            "variant_match": false,
            "visual_match": false,
            "condition_match": true
        },
        {
            "candidate_id": "ebay:111111111101",
            "classification": "possible",
            "reason": "A raw Snivy with similar artwork is visible, but the small image does not establish the full number or treatment. Accepted Best Offer amount is undisclosed.",
            "identity_match": false,
            "variant_match": false,
            "visual_match": false,
            "condition_match": true
        },
        {
            "candidate_id": "ebay:111111111102",
            "classification": "possible",
            "reason": "English Snivy, number and artwork agree on a raw card; exact foil treatment cannot be verified against the original. Best Offer status is unavailable.",
            "identity_match": true,
            "variant_match": false,
            "visual_match": false,
            "condition_match": true
        },
        {
            "candidate_id": "ebay:111111111103",
            "classification": "possible",
            "reason": "Raw English Snivy and matching artwork/number are visible. Star-shaped reflective details are conspicuous in the listing but unresolved on the original. Best Offer status is unavailable.",
            "identity_match": true,
            "variant_match": false,
            "visual_match": false,
            "condition_match": true
        },
        {
            "candidate_id": "ebay:111111111104",
            "classification": "possible",
            "reason": "Raw English Snivy, artwork and number agree; the supplied views do not establish identical foil treatment or comparable damage. Best Offer status is unavailable.",
            "identity_match": true,
            "variant_match": false,
            "visual_match": false,
            "condition_match": true
        },
        {
            "candidate_id": "ebay:111111111105",
            "classification": "possible",
            "reason": "Visible raw Snivy agrees in artwork and number, but exact treatment remains uncertain. The title's gift claim is not visually established; Best Offer status is unavailable.",
            "identity_match": true,
            "variant_match": false,
            "visual_match": false,
            "condition_match": true
        },
        {
            "candidate_id": "ebay:111111111107",
            "classification": "possible",
            "reason": "No supplied image verifies identity, treatment or condition; Best Offer status is unavailable.",
            "identity_match": false,
            "variant_match": false,
            "visual_match": false,
            "condition_match": false
        },
        {
            "candidate_id": "ebay:111111111108",
            "classification": "possible",
            "reason": "No supplied image verifies identity, treatment or condition; Best Offer status is unavailable.",
            "identity_match": false,
            "variant_match": false,
            "visual_match": false,
            "condition_match": false
        },
        {
            "candidate_id": "ebay:111111111106",
            "classification": "possible",
            "reason": "No supplied image verifies identity, treatment or condition; Best Offer status is unavailable.",
            "identity_match": false,
            "variant_match": false,
            "visual_match": false,
            "condition_match": false
        }
    ],
    "refinement": {
        "query": "2013 Legendary Treasures Radiant Collection Snivy RC1/RC25",
        "reason": "The first search retained 24 listings but only one is source-eligible, and exact treatment remains unresolved. Dropping the manufacturer term may retrieve additional documented sales while preserving the saved identity and visible name/number."
    }
};
export const retainedSnivyAnalysis2 = {
    "identity": {
        "status": "unresolved",
        "variant_name": null,
        "suggestion": null,
        "reason": "No published catalog evidence was supplied. Seller titles and listing images cannot establish catalog identity or treatment.",
        "reference_ids": [],
        "photo_features": []
    },
    "target_condition": {
        "status": "raw",
        "grader": null,
        "numeric_grade": null,
        "photo_evidence": "Both original photographs show a loose card without a grading holder or label. Whitening is visible along portions of the back edges."
    },
    "photo_identity": {
        "schema_version": 1,
        "status": "unresolved",
        "observations": [
            {
                "field": "name",
                "value": "Snivy",
                "side": "front",
                "photo_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "observation": "The heading reads “Snivy”; “BASIC” and “HP 50” are also visible."
            },
            {
                "field": "card_number",
                "value": "RC1/RC25",
                "side": "front",
                "photo_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "observation": "The lower-right number reads “RC1/RC25”."
            },
            {
                "field": "year",
                "value": "2013",
                "side": "front",
                "photo_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "observation": "The lower-left copyright line reads “©2013 Pokémon”; this directly establishes the printed copyright year, not independently the release year."
            },
            {
                "field": "manufacturer",
                "value": "Pokémon",
                "side": "front",
                "photo_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "observation": "“Pokémon” is printed in the copyright line."
            },
            {
                "field": "manufacturer",
                "value": "Pokémon",
                "side": "back",
                "photo_sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                "observation": "Two yellow-and-blue “Pokémon” logos surround the central Poké Ball."
            }
        ],
        "reason": "The originals support the complete name, number, Pokémon branding and saved Basic Pokémon description. The full product name is not printed, and the visible set symbol lacks supplied identification evidence. No sufficiently distinct foil pattern or edition marking can be established from the original front. Exact release/set and treatment therefore remain unresolved."
    },
    "selected_candidate_ids": [],
    "comparisons": [
        {
            "candidate_id": "ebay:111111111100",
            "classification": "possible",
            "reason": "The raw English Snivy front, artwork and RC1/RC25 number agree. Pronounced reflective speckling is visible in the listing, but equivalent treatment cannot be established on the original. This is the only source-eligible candidate.",
            "identity_match": true,
            "variant_match": false,
            "visual_match": false,
            "condition_match": true
        },
        {
            "candidate_id": "ebay:111111111105",
            "classification": "possible",
            "reason": "The raw Snivy front, English attacks, artwork and number agree; exact treatment and reverse wear cannot be compared. The title's gift claim is not visibly established. Best Offer status is unavailable.",
            "identity_match": true,
            "variant_match": false,
            "visual_match": false,
            "condition_match": true
        },
        {
            "candidate_id": "ebay:111111111101",
            "classification": "possible",
            "reason": "The distant image shows matching Snivy artwork in an ungraded holder, but the full number and treatment are insufficiently readable. The accepted Best Offer amount is undisclosed.",
            "identity_match": false,
            "variant_match": false,
            "visual_match": false,
            "condition_match": true
        },
        {
            "candidate_id": "ebay:111111111103",
            "classification": "possible",
            "reason": "The raw English Snivy artwork and number agree. Star-shaped reflective motifs are visible across the listing front but are not established on the original; this is uncertainty, not a proven different printing. Best Offer status is unavailable.",
            "identity_match": true,
            "variant_match": false,
            "visual_match": false,
            "condition_match": true
        },
        {
            "candidate_id": "ebay:111111111102",
            "classification": "possible",
            "reason": "The raw English Snivy front, artwork and number agree, but the image does not resolve exact treatment against the original. Reverse wear is unavailable; Best Offer status is unknown.",
            "identity_match": true,
            "variant_match": false,
            "visual_match": false,
            "condition_match": true
        },
        {
            "candidate_id": "ebay:111111111104",
            "classification": "possible",
            "reason": "Matching English Snivy artwork and number are visible on a raw sleeved card. Reflective appearance does not establish the same exact treatment as the original. Best Offer status is unavailable.",
            "identity_match": true,
            "variant_match": false,
            "visual_match": false,
            "condition_match": true
        },
        {
            "candidate_id": "ebay:111111111106",
            "classification": "possible",
            "reason": "The raw English Snivy front, artwork and number agree. Exact foil treatment and reverse damage cannot be compared. Best Offer status is unavailable.",
            "identity_match": true,
            "variant_match": false,
            "visual_match": false,
            "condition_match": true
        },
        {
            "candidate_id": "ebay:111111111107",
            "classification": "possible",
            "reason": "The raw English Snivy front, artwork and number agree. Surface reflections do not resolve a matching exact treatment, and no reverse is supplied. Best Offer status is unavailable.",
            "identity_match": true,
            "variant_match": false,
            "visual_match": false,
            "condition_match": true
        },
        {
            "candidate_id": "ebay:111111111108",
            "classification": "possible",
            "reason": "The raw English Snivy front, artwork and number agree, but exact treatment and reverse wear remain unverified. Best Offer status is unavailable.",
            "identity_match": true,
            "variant_match": false,
            "visual_match": false,
            "condition_match": true
        }
    ],
    "refinement": {
        "query": "2013 Legendary Treasures Radiant Collection Snivy RC1/RC25 Basic Pokémon",
        "reason": "The second search retained 24 results but added only one listing, without an image or source eligibility. Adding the saved card type, supported by visible “BASIC” text, may retrieve different listings while preserving every identity anchor."
    }
};
