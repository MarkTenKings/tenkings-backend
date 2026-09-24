#include "lock_profile.h"
#include <stddef.h>

const AtlasLockProfile *atlas_companion_compiled_profile(const char *profile_hash, const char *qualification_hash) {
    (void)profile_hash; (void)qualification_hash;
    /* No qualified F8215 profile exists yet. Neither the manufacturer byte,
     * advertised 496-byte CC, product listing nor a default Type 2 layout is
     * authority to add one. Keep this registry empty until exact evidence exists.
     * Tests link a separate synthetic registry; it is not in any shipping target. */
    return NULL;
}
