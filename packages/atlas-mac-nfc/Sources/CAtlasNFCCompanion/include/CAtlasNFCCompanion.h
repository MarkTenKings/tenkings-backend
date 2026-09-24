#ifndef ATLAS_NFC_COMPANION_H
#define ATLAS_NFC_COMPANION_H
#include <stdint.h>
#include <stddef.h>
typedef struct AtlasCompanionSession AtlasCompanionSession;
typedef struct { uint8_t manufacturer; uint8_t cc[4]; uint8_t lock_candidate[2]; } AtlasCompanionFacts;
// Internal native API; never an arbitrary APDU/URL interface. The Swift gate
// verifies signed hosted authority + a compiled qualified profile BEFORE open.
int32_t atlas_companion_open(const char *reader, uint8_t first_page, uint8_t last_page,
                            const uint8_t *expected_ndef, uint32_t length, AtlasCompanionSession **out);
// Selects only a compiled, evidence-bound profile. The shipping registry is empty.
// A caller cannot supply lock addresses, masks, reader commands or silicon claims.
int atlas_companion_profile_qualified(const char *profile_hash, const char *qualification_hash,
                                     uint32_t first_page, uint32_t last_page);
int32_t atlas_companion_open_qualified(const char *reader, const char *profile_hash, const char *qualification_hash,
                                     uint32_t first_page, uint32_t last_page,
                                     const uint8_t *expected_ndef, uint32_t length, AtlasCompanionSession **out);
int32_t atlas_companion_facts(AtlasCompanionSession *session, AtlasCompanionFacts *out);
int32_t atlas_companion_same_tag(AtlasCompanionSession *session);
int32_t atlas_companion_read16(AtlasCompanionSession *session, uint32_t page, uint8_t out[16]);
// Supplies no arbitrary bytes: page and requested bytes must match the saved
// approved NDEF, and only the next header-last page can be attempted once.
int32_t atlas_companion_write4(AtlasCompanionSession *session, uint32_t page, const uint8_t expected[4]);
int atlas_companion_readback_verified(AtlasCompanionSession *session);
// One fixed compiled sequence; only after exact NDEF readback. A partial/unknown
// result poisons this session. The durable outer LOCK_INTENT forbids restart replay.
int32_t atlas_companion_lock_qualified(AtlasCompanionSession *session, int64_t authorization_expires_at_ms);
int32_t atlas_companion_verify_lock(AtlasCompanionSession *session);
int atlas_companion_lock_verified(AtlasCompanionSession *session);
enum { ATLAS_FAILURE_NONE, ATLAS_FAILURE_TRANSPORT, ATLAS_FAILURE_REPLY_LENGTH,
       ATLAS_FAILURE_APDU_STATUS, ATLAS_FAILURE_CONTINUITY, ATLAS_FAILURE_READBACK, ATLAS_FAILURE_EXPIRED };
enum { ATLAS_OPERATION_READ = 1, ATLAS_OPERATION_DATA_WRITE = 2, ATLAS_OPERATION_LOCK_WRITE = 3 };
typedef struct {
    // transmitted means SCardTransmit was entered, not that RF delivery or a
    // silicon rejection was proven. PC/SC 6300 remains reader-level evidence.
    uint32_t kind, operation, page, transmitted;
    int32_t pcsc_status;
    uint16_t status_word;
} AtlasCompanionFailure;
// Safe failure attribution only: no UID, header, NDEF, key or arbitrary reply.
int32_t atlas_companion_failure(AtlasCompanionSession *session, AtlasCompanionFailure *out);
int32_t atlas_companion_presence(uint32_t timeout_ms, uint32_t *state, uint32_t *selected);
int32_t atlas_companion_wait_removed(AtlasCompanionSession *session, uint32_t timeout_ms, uint32_t *removed);
int32_t atlas_companion_close(AtlasCompanionSession *session);
int atlas_companion_start_watchdog(void);
int atlas_companion_deadline(uint32_t milliseconds);
int atlas_companion_full_sync(int descriptor);
enum { ATLAS_COMPANION_EMPTY = 0, ATLAS_COMPANION_PRESENT = 1 };
// Signed spelling preserves 0xA7300001..09 ABI and imports into Swift Int32
// without an overflowing positive integer literal in the Clang importer.
#define ATLAS_COMPANION_REJECTED ((int32_t)-1490026495)
#define ATLAS_COMPANION_CHANGED ((int32_t)-1490026494)
#define ATLAS_COMPANION_ORDER ((int32_t)-1490026493)
#define ATLAS_COMPANION_NOT_EMPTY ((int32_t)-1490026492)
#define ATLAS_COMPANION_READBACK ((int32_t)-1490026491)
#define ATLAS_COMPANION_REPLY_LENGTH ((int32_t)-1490026490)
#define ATLAS_COMPANION_APDU_STATUS ((int32_t)-1490026489)
#define ATLAS_COMPANION_PROFILE_UNQUALIFIED ((int32_t)-1490026488)
#define ATLAS_COMPANION_EXPIRED ((int32_t)-1490026487)
#endif
