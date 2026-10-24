// Source-owned PostgreSQL 17 definitions, verified against the exact proposal
// bodies by c0-original-reconcile-01, then retained unchanged from 246dcbc3.
// The additive observe_access_v1 definition was separately qualified by the
// actual rollback-only access-observation-local-receipt-02 (20-function closure).
// Never learn these pins from the live target or accept them from process JSON.
export const PRODUCTION_C0_CLOSURE_HASHES = Object.freeze({
    "observe_access_v1(jsonb)": "b16c1093a3818156e68817a7d6ef824372b27a5be458282d81512fa86a8d6432",
    "claim_stage_v1(jsonb)": "7add7f7b7f9fcbcaffa54c5faea7c63efd8eab219b2c1607fd3813143cafb38e",
    "apply_mutation_v1(uuid, text)": "31b46db4607ce5db20e8917014091501695fb3d58d2d092c2fe13d4da382655f",
    "exact_object_v1(jsonb, text[])": "d79061b0d839e818bcb2dec76054cccf7f6698028809ad92bedf54e9fad4bb1c",
    "record_guard_v1()": "d817f918dcb622b173fed1bcb6d07709cdc004e9e8b8880a9fd845c291ea33f6",
    "observation_v1(boolean)": "2d5d01d6d4162118c79df933c6bacad65dee4220dbe9d74d353e73d725461d2b",
    "canonical_v1(jsonb, integer)": "e8eb00cb9299a44efad0a7da0fb7f87aee89173452526bec3a3f92ea7e12508d",
    "hash_v1(jsonb)": "ee0937734ff7281055ede9e149202cd051a57256d275edc441ab19817626ee6f",
    "fence_report_v1(atlas_proof_authority.fence)": "59fad9b06fef33151b5747c8df819275ff171341604e1c914ebc744aa2a4f2c2",
    "lock_canonical_rows_v1(jsonb)": "290c4956054fcc63e740de352a4a7ac7a189510478773ee0e2c348bfea5765fd",
    "lookup_claim_v1(uuid, text)": "4b2055253f1545bcaa7fe501a47250fa0f364a724b36b4db76c5c03ce9f4cbef",
    "operator_access_v1(jsonb)": "a9c5e512b3abfa61afee45c5c76f39c9e5c7d1744708532ab39d8833a79d3f76",
    "reject_unjoined_authority_write()": "31059bd765cc2f2d87f7b6c26357ea5d981125b602b31c522556aa72ca88c1fc",
    "lookup_stage_v1(uuid, text)": "37e0bf56f38a3633e3b3f239a0aaa6915d31b517f10a9e227c64bbe8b5549a31",
    "begin_logout_v1(jsonb)": "43a18890d16fc01ebb59b081c15cc7ddce64343ca824d48ee17521f3ea801ad5",
    "settle_stage_v1(jsonb)": "4d25896f01a72893ce55810381ce8e4f66cf0bd94ace280748af83318d062c82",
    "settle_drain_v1(jsonb)": "059c18afa2583214e90addec8bc80caee925af94588d94f5ce78f960036722f6",
    "authorize_mutation_v1(jsonb)": "88f562e473006c6551e59bddc15268fd67350971c14f1e5ae86627628427457a",
    "begin_mutation_v1(jsonb)": "798ef9dbf8998332cada07b1586588ce0bb737ffddd1975ad0aa38390f4582ca",
    "read_drain_v1(uuid)": "408dbf7aa071404f46b8bdbd8631df469acff2f22b3a093f46d15b1fc7347fa8"
});
