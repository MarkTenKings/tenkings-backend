#ifndef ATLAS_COMPANION_LOCK_PROFILE_H
#define ATLAS_COMPANION_LOCK_PROFILE_H
#include <stdint.h>

/* Native-only, compiled authority. Never deserialize this structure from JSON,
 * TLVs, a browser, an environment variable or an IPC request. A stock profile
 * needs reviewed silicon/transport semantics AND an actual qualification receipt.
 * A coverage entry describes documented semantics; it cannot prove them. */
#define ATLAS_LOCK_MAX_STEPS 16
#define ATLAS_LOCK_MAX_BITS 128
enum { ATLAS_LOCK_CC = 1, ATLAS_LOCK_DATA = 2, ATLAS_LOCK_FREEZE = 3 };
typedef struct {
    uint8_t page, kind, set_mask[4];
} AtlasLockStep;
typedef struct {
    uint8_t page, byte, bit;
    uint16_t first_byte, last_byte;
} AtlasLockCoverage;
typedef struct {
    const char *profile_hash, *qualification_hash;
    uint8_t manufacturer, cc[4], first_user_page, last_user_page, last_readable_page;
    uint32_t step_count, coverage_count;
    AtlasLockStep steps[ATLAS_LOCK_MAX_STEPS];
    AtlasLockCoverage coverage[ATLAS_LOCK_MAX_BITS];
} AtlasLockProfile;

const AtlasLockProfile *atlas_companion_compiled_profile(const char *profile_hash, const char *qualification_hash);
int atlas_companion_lock_profile_valid(const AtlasLockProfile *profile);
#endif
