import unittest

from sam_memory_v2 import (
    CAPACITY_PER_TYPE_POLARITY,
    FINGERPRINT_VERSION,
    MEMORY_PROPOSAL_MAX_PER_TYPE_SIDE,
    MEMORY_PROPOSAL_SIMILARITY_THRESHOLD,
    POLICY_MARGIN,
    POLICY_TAU,
    all_exemplars_v2,
    decide_candidate_v2,
    lesson_reference_v2,
    normalize_source_view,
    prepare_bank_v2,
    smart_mark_proposal_seeds_v2,
)


UNIT = [1.0] + [0.0] * 31


def exemplar(
    polarity,
    *,
    fingerprint=UNIT,
    defect_type="VISIBLE_WHITENING",
    source_view="ORIGINAL",
    session_id="lesson-session",
    provenance=None,
):
    return {
        "defectType": defect_type,
        "polarity": polarity,
        "sessionId": session_id,
        "completedAt": "2026-08-02T12:00:00.000Z",
        "completionOrder": 1,
        "proposalOrder": 0,
        "lessonOrder": 0,
        "fingerprint": fingerprint,
        "provenance": provenance
        or ("DETECTOR_REMOVED" if polarity == "NEGATIVE" else "SMART_MARK_POSITIVE"),
        "sourceViewId": source_view,
    }


def bank(*exemplars, tau=0.9, margin=0.05, fingerprint_version=FINGERPRINT_VERSION):
    return {
        "version": 2,
        "fingerprintVersion": fingerprint_version,
        "capacityPerTypePolarity": CAPACITY_PER_TYPE_POLARITY,
        "calibration": {"status": "CALIBRATED", "tau": tau, "margin": margin},
        "exemplars": list(exemplars),
    }


def decide(raw_bank, **overrides):
    prepared = prepare_bank_v2(raw_bank)
    assert prepared is not None
    return decide_candidate_v2(
        prepared,
        fingerprint=overrides.get("fingerprint", UNIT),
        defect_type=overrides.get("defect_type", "VISIBLE_WHITENING"),
        source_view_id=overrides.get("source_view_id", "FRONT:ORIGINAL"),
        raw_confidence=overrides.get("raw_confidence", 0.96),
        session_id="current-session",
        trace_id="trace-123",
    )


class SamMemoryV2Tests(unittest.TestCase):
    def test_strong_negative_vetoes_even_high_raw_confidence(self):
        result = decide(bank(exemplar("NEGATIVE")), raw_confidence=0.96)

        self.assertTrue(result["veto"])
        self.assertEqual(result["diagnostic"]["action"], "vetoed")
        self.assertEqual(result["diagnostic"]["rawConfidence"], 0.96)
        self.assertEqual(
            result["diagnostic"]["negativeMatchSessionId"], "lesson-session"
        )
        self.assertEqual(result["adjustment"], -0.06)

    def test_comparable_positive_damage_evidence_protects_text_overlap(self):
        result = decide(
            bank(
                exemplar("NEGATIVE", session_id="removed-text"),
                exemplar("POSITIVE", session_id="real-damage"),
            )
        )

        self.assertFalse(result["veto"])
        self.assertEqual(result["diagnostic"]["action"], "protected")
        self.assertEqual(result["diagnostic"]["positiveMatchSessionId"], "real-damage")
        self.assertEqual(result["diagnostic"]["negativeMatchSessionId"], "removed-text")

    def test_fixed_policy_vetoes_the_observed_cubone_similarity_gap(self):
        positive = [0.807931, (1 - 0.807931**2) ** 0.5] + [0.0] * 30
        result = decide(
            bank(
                exemplar("NEGATIVE", session_id="removed-cubone-text"),
                exemplar(
                    "POSITIVE",
                    fingerprint=positive,
                    session_id="cubone-smart-mark",
                ),
                tau=POLICY_TAU,
                margin=POLICY_MARGIN,
            )
        )

        self.assertTrue(result["veto"])
        self.assertEqual(result["diagnostic"]["action"], "vetoed")
        self.assertAlmostEqual(result["diagnostic"]["negativeMax"], 1.0, places=6)
        self.assertAlmostEqual(result["diagnostic"]["positiveMax"], 0.807931, places=6)

    def test_untouched_accept_nudges_but_cannot_protect_a_human_removal(self):
        result = decide(
            bank(
                exemplar("NEGATIVE", session_id="human-removal"),
                exemplar(
                    "POSITIVE",
                    session_id="untouched-accept",
                    provenance="UNTOUCHED_ACCEPTED_POSITIVE",
                ),
                tau=POLICY_TAU,
                margin=POLICY_MARGIN,
            )
        )

        self.assertTrue(result["veto"])
        self.assertIsNone(result["diagnostic"]["positiveMax"])
        self.assertEqual(result["diagnostic"]["gentlePositiveMax"], 1.0)
        self.assertEqual(result["adjustment"], 0.0)

    def test_weak_evidence_keeps_the_gentle_adjustment_bounded(self):
        half_cosine = [0.5, (0.75) ** 0.5] + [0.0] * 30
        result = decide(
            bank(exemplar("POSITIVE", fingerprint=half_cosine), tau=0.95),
        )

        self.assertFalse(result["veto"])
        self.assertEqual(result["diagnostic"]["action"], "retained")
        self.assertAlmostEqual(result["adjustment"], 0.03, places=6)
        self.assertLessEqual(abs(result["adjustment"]), 0.06)

    def test_type_view_and_fingerprint_version_boundaries_are_strict(self):
        type_mismatch = decide(
            bank(exemplar("NEGATIVE", defect_type="FRAYING")),
        )
        view_mismatch = decide(
            bank(exemplar("NEGATIVE", source_view="NORMALIZED")),
        )
        incompatible = decide(
            bank(exemplar("NEGATIVE"), fingerprint_version="different-space"),
        )

        self.assertIsNone(type_mismatch["diagnostic"]["negativeMax"])
        self.assertIsNone(view_mismatch["diagnostic"]["negativeMax"])
        self.assertEqual(incompatible["diagnostic"]["bankStatus"], "incompatible")
        self.assertFalse(incompatible["veto"])
        self.assertEqual(normalize_source_view("BACK:ORIGINAL"), "ORIGINAL")
        self.assertIsNone(normalize_source_view("OTHER:ORIGINAL"))

    def test_malformed_and_uncalibrated_v2_fail_inertly(self):
        malformed = bank(exemplar("NEGATIVE", fingerprint=[1.0]))
        uncalibrated = {
            **bank(),
            "calibration": {"status": "UNCALIBRATED", "tau": None, "margin": None},
        }

        malformed_result = decide(malformed)
        uncalibrated_result = decide(uncalibrated)

        self.assertEqual(malformed_result["diagnostic"]["bankStatus"], "malformed")
        self.assertEqual(
            uncalibrated_result["diagnostic"]["bankStatus"], "uncalibrated"
        )
        self.assertFalse(malformed_result["veto"])
        self.assertFalse(uncalibrated_result["veto"])
        self.assertEqual(malformed_result["adjustment"], 0.0)
        self.assertEqual(uncalibrated_result["adjustment"], 0.0)

    def test_out_of_policy_calibration_is_inert(self):
        result = decide(
            bank(
                exemplar("NEGATIVE"),
                tau=0.652262,
                margin=0.652262,
            )
        )

        self.assertEqual(result["diagnostic"]["bankStatus"], "malformed")
        self.assertFalse(result["veto"])
        self.assertEqual(result["adjustment"], 0.0)

    def test_bank_capacity_and_exemplar_shape_are_sanity_checked(self):
        over_capacity = [
            exemplar("NEGATIVE", session_id=f"session-{index}")
            for index in range(CAPACITY_PER_TYPE_POLARITY + 1)
        ]
        prepared = prepare_bank_v2(bank(*over_capacity))

        self.assertIsNotNone(prepared)
        self.assertEqual(prepared.status, "malformed")

    def test_non_v2_input_is_left_for_the_unchanged_v1_path(self):
        self.assertIsNone(prepare_bank_v2({"version": 1, "types": {}}))
        self.assertIsNone(prepare_bank_v2(None))

    def test_only_explicit_smart_marks_are_proposal_seeds(self):
        prepared = prepare_bank_v2(
            bank(
                exemplar("POSITIVE", session_id="human-smart-mark"),
                exemplar(
                    "POSITIVE",
                    session_id="human-memory-trace-correction",
                    provenance="HUMAN_TRACE_CORRECTION_POSITIVE",
                ),
                exemplar(
                    "POSITIVE",
                    session_id="human-relabel",
                    provenance="DETECTOR_RELABELED_POSITIVE",
                ),
                exemplar(
                    "POSITIVE",
                    session_id="untouched-auto-accept",
                    provenance="UNTOUCHED_ACCEPTED_POSITIVE",
                ),
                exemplar("NEGATIVE", session_id="human-removal"),
            )
        )

        seeds = smart_mark_proposal_seeds_v2(prepared, "FRONT:ORIGINAL")

        self.assertEqual(len(seeds), 1)
        self.assertEqual(seeds[0][0], "VISIBLE_WHITENING")
        self.assertEqual(seeds[0][1].session_id, "human-smart-mark")
        self.assertEqual(MEMORY_PROPOSAL_SIMILARITY_THRESHOLD, 0.90)
        self.assertEqual(MEMORY_PROPOSAL_MAX_PER_TYPE_SIDE, 3)

    def test_candidate_decision_accounts_for_every_eligible_lesson_without_changing_policy(self):
        prepared = prepare_bank_v2(
            bank(
                exemplar("POSITIVE", session_id="positive-winner"),
                exemplar("POSITIVE", session_id="positive-tie-loser"),
                exemplar("NEGATIVE", session_id="negative-winner"),
            )
        )
        self.assertIsNotNone(prepared)

        result = decide_candidate_v2(
            prepared,
            fingerprint=UNIT,
            defect_type="VISIBLE_WHITENING",
            source_view_id="FRONT:ORIGINAL",
            raw_confidence=0.96,
            session_id="current-session",
            trace_id="trace-lesson-ledger",
        )

        observations = result["lessonObservations"]
        self.assertEqual(len(observations), 5)
        by_key = {}
        for entry in observations:
            by_key.setdefault(entry["lessonKey"], []).append(entry)
        positive_entries = prepared.exemplars[
            ("VISIBLE_WHITENING", "POSITIVE", "ORIGINAL")
        ]
        negative_entry = prepared.exemplars[
            ("VISIBLE_WHITENING", "NEGATIVE", "ORIGINAL")
        ][0]
        self.assertEqual(
            {
                entry["reasonCode"]
                for entry in by_key[
                    lesson_reference_v2(positive_entries[0])["lessonKey"]
                ]
            },
            {
                "CLASSIFIER_GENTLE_POSITIVE_MAX",
                "CLASSIFIER_EXPLICIT_POSITIVE_MARGIN_CHECK",
                "CLASSIFIER_EXPLICIT_POSITIVE_PROTECTION",
            },
        )
        self.assertEqual(
            by_key[lesson_reference_v2(positive_entries[1])["lessonKey"]][0]["reasonCode"],
            "NOT_SELECTED_AS_MAX_EXEMPLAR",
        )
        self.assertEqual(
            by_key[lesson_reference_v2(negative_entry)["lessonKey"]][0]["status"],
            "USED",
        )
        self.assertEqual(result["diagnostic"]["action"], "protected")
        self.assertEqual(result["adjustment"], 0.0)

    def test_failed_positive_protection_is_logged_as_margin_use_not_protection(self):
        prepared = prepare_bank_v2(
            bank(
                exemplar(
                    "POSITIVE",
                    fingerprint=[0.8, 0.6] + [0.0] * 30,
                    session_id="positive-too-weak",
                ),
                exemplar("NEGATIVE", session_id="negative-veto"),
            )
        )

        result = decide_candidate_v2(
            prepared,
            fingerprint=UNIT,
            defect_type="VISIBLE_WHITENING",
            source_view_id="FRONT:ORIGINAL",
            raw_confidence=0.96,
        )
        positive_key = lesson_reference_v2(
            prepared.exemplars[
                ("VISIBLE_WHITENING", "POSITIVE", "ORIGINAL")
            ][0]
        )["lessonKey"]
        positive_reasons = {
            observation["reasonCode"]
            for observation in result["lessonObservations"]
            if observation["lessonKey"] == positive_key
        }

        self.assertEqual(result["diagnostic"]["action"], "vetoed")
        self.assertIn(
            "CLASSIFIER_EXPLICIT_POSITIVE_MARGIN_CHECK",
            positive_reasons,
        )
        self.assertNotIn(
            "CLASSIFIER_EXPLICIT_POSITIVE_PROTECTION",
            positive_reasons,
        )

    def test_lesson_key_matches_the_cross_stack_contract(self):
        source = exemplar(
            "POSITIVE",
            session_id="source-session-1",
            provenance="SMART_MARK_POSITIVE",
        )
        source.update(
            {
                "completedAt": "2026-08-20T12:00:00.000Z",
                "completionOrder": 7,
                "proposalOrder": 2,
            }
        )
        prepared = prepare_bank_v2(bank(source))
        lesson = all_exemplars_v2(prepared)[0]

        self.assertEqual(
            lesson_reference_v2(lesson)["lessonKey"],
            "7b97f37dd9968fbee11bb4bb53008e3b3d6679723e546d7dfce5e89904c7dc74",
        )


if __name__ == "__main__":
    unittest.main()
