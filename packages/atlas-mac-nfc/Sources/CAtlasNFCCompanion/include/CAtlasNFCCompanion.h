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
int32_t atlas_companion_facts(AtlasCompanionSession *session, AtlasCompanionFacts *out);
int32_t atlas_companion_same_tag(AtlasCompanionSession *session);
int32_t atlas_companion_read16(AtlasCompanionSession *session, uint32_t page, uint8_t out[16]);
// Supplies no arbitrary bytes: page and requested bytes must match the saved
// approved NDEF, and only the next header-last page can be attempted once.
int32_t atlas_companion_write4(AtlasCompanionSession *session, uint32_t page, const uint8_t expected[4]);
int atlas_companion_readback_verified(AtlasCompanionSession *session);
int32_t atlas_companion_presence(uint32_t timeout_ms, uint32_t *state, uint32_t *selected);
int32_t atlas_companion_wait_removed(AtlasCompanionSession *session, uint32_t timeout_ms, uint32_t *removed);
int32_t atlas_companion_close(AtlasCompanionSession *session);
int atlas_companion_start_watchdog(void);
int atlas_companion_deadline(uint32_t milliseconds);
int atlas_companion_full_sync(int descriptor);
enum { ATLAS_COMPANION_EMPTY = 0, ATLAS_COMPANION_PRESENT = 1 };
#define ATLAS_COMPANION_REJECTED ((int32_t)0xA7300001)
#define ATLAS_COMPANION_CHANGED ((int32_t)0xA7300002)
#define ATLAS_COMPANION_ORDER ((int32_t)0xA7300003)
#define ATLAS_COMPANION_NOT_EMPTY ((int32_t)0xA7300004)
#define ATLAS_COMPANION_READBACK ((int32_t)0xA7300005)
#endif
