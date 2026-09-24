#include "lock_profile.h"
#include <string.h>

static int hash_valid(const char *value) {
    if (!value || strlen(value) != 64) return 0;
    for (unsigned i = 0; i < 64; i++) if (!((value[i] >= '0' && value[i] <= '9') || (value[i] >= 'a' && value[i] <= 'f'))) return 0;
    return 1;
}
int atlas_companion_lock_profile_valid(const AtlasLockProfile *p) {
    if (!p || !hash_valid(p->profile_hash) || !hash_valid(p->qualification_hash)
        || p->first_user_page != 4 || p->last_user_page < 15 || p->last_user_page >= p->last_readable_page
        || p->last_readable_page % 4 != 3 || p->cc[0] != 0xe1 || p->cc[1] != 0x10 || p->cc[3] != 0
        || (uint32_t)p->cc[2] * 8 != ((uint32_t)p->last_user_page - 3) * 4
        || p->step_count < 2 || p->step_count > ATLAS_LOCK_MAX_STEPS || !p->coverage_count || p->coverage_count > ATLAS_LOCK_MAX_BITS) return 0;
    /* Physical lock semantics must cover the CC and EVERY advertised data byte,
     * not only the current URL. CC access bits alone never count as protection. */
    uint8_t covered[1024] = {0}, data_masks[1024] = {0}, all_masks[1024] = {0};
    int freezing = 0;
    for (uint32_t i = 0; i < p->step_count; i++) {
        const AtlasLockStep *s = p->steps + i;
        if (s->page > p->last_readable_page || !(s->set_mask[0] | s->set_mask[1] | s->set_mask[2] | s->set_mask[3])) return 0;
        if (!i) {
            const uint8_t cc_mask[] = {0, 0, 0, 0x0f};
            if (s->kind != ATLAS_LOCK_CC || s->page != 3 || memcmp(s->set_mask, cc_mask, 4)) return 0;
        } else {
            if (s->kind != ATLAS_LOCK_DATA && s->kind != ATLAS_LOCK_FREEZE) return 0;
            if (s->page != 2 && s->page <= p->last_user_page) return 0;
            if (s->page == 2 && (s->set_mask[0] || s->set_mask[1])) return 0;
            if (s->kind == ATLAS_LOCK_FREEZE) freezing = 1;
            else if (freezing) return 0; // A block-lock cannot precede a data-lock write.
        }
        for (unsigned b = 0; b < 4; b++) {
            const unsigned at = s->page * 4 + b;
            if (all_masks[at] & s->set_mask[b]) return 0;
            all_masks[at] |= s->set_mask[b];
            if (s->kind == ATLAS_LOCK_DATA) data_masks[at] |= s->set_mask[b];
        }
    }
    uint8_t described[1024] = {0};
    for (uint32_t i = 0; i < p->coverage_count; i++) {
        const AtlasLockCoverage *c = p->coverage + i;
        if (c->page > p->last_readable_page || c->byte > 3 || c->bit > 7 || c->first_byte < 12
            || c->last_byte < c->first_byte || c->last_byte >= ((uint32_t)p->last_user_page + 1) * 4) return 0;
        const unsigned at = c->page * 4 + c->byte; const uint8_t bit = (uint8_t)(1u << c->bit);
        if (!(data_masks[at] & bit) || (described[at] & bit)) return 0;
        described[at] |= bit;
        for (unsigned b = c->first_byte; b <= c->last_byte; b++) covered[b] = 1;
    }
    if (memcmp(data_masks, described, sizeof(data_masks))) return 0;
    for (unsigned b = 12; b < ((uint32_t)p->last_user_page + 1) * 4; b++) if (!covered[b]) return 0;
    return 1;
}
