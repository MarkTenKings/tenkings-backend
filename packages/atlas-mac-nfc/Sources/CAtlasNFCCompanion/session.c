#include "CAtlasNFCCompanion.h"
#include "CAtlasPCSC.h"
#include <PCSC/winscard.h>
#include <stdlib.h>
#include <string.h>

static const char *readers[] = {"ACS ACR1552 1S CL Reader(1)", "ACS ACR1552 1S CL Reader(2)"};
struct AtlasCompanionSession {
    SCARDCONTEXT context; SCARDHANDLE card; uint32_t protocol;
    uint8_t header[16], plan[256], before[272];
    uint32_t first, last, length, extent, next_step;
    int failed, verified; char reader[64];
};
static int reader_valid(const char *reader) {
    return reader && (!strcmp(reader, readers[0]) || !strcmp(reader, readers[1]));
}
static int32_t raw_read(AtlasCompanionSession *s, uint32_t page, uint8_t out[16]) {
    const uint8_t command[] = {0xff, 0xb0, 0, (uint8_t)page, 16};
    SCARD_IO_REQUEST pci = {s->protocol, sizeof(SCARD_IO_REQUEST)};
    uint8_t response[18] = {0}; uint32_t size = sizeof(response);
    int32_t status = SCardTransmit(s->card, &pci, command, sizeof(command), NULL, response, &size);
    if (!status && (size != 18 || response[16] != 0x90 || response[17] != 0)) status = ATLAS_COMPANION_REJECTED;
    if (!status) memcpy(out, response, 16); else atlas_clear(out, 16);
    atlas_clear(response, sizeof(response)); return status;
}
int32_t atlas_companion_close(AtlasCompanionSession *s) {
    if (!s) return 0; int32_t status = 0;
    if (s->card) status = SCardDisconnect(s->card, SCARD_LEAVE_CARD);
    if (s->context) { int32_t released = SCardReleaseContext(s->context); if (!status) status = released; }
    atlas_clear(s, sizeof(*s)); free(s); return status;
}
int32_t atlas_companion_same_tag(AtlasCompanionSession *s) {
    if (!s || !s->card || s->failed) return ATLAS_COMPANION_REJECTED;
    uint8_t header[16] = {0}; int32_t status = raw_read(s, 0, header);
    if (!status && memcmp(s->header, header, sizeof(header))) status = ATLAS_COMPANION_CHANGED;
    atlas_clear(header, sizeof(header)); if (status) s->failed = 1; return status;
}
int32_t atlas_companion_open(const char *reader, uint8_t first, uint8_t last,
                            const uint8_t *plan, uint32_t length, AtlasCompanionSession **out) {
    if (!out) return ATLAS_COMPANION_REJECTED; *out = NULL;
    const uint32_t extent = ((length + 16 + 15) / 16) * 16;
    if (!reader_valid(reader) || !plan || first < 4 || length < 12 || length > 256 || length % 4
        || extent > 272 || (uint32_t)first + extent / 4 - 1 > last
        || plan[0] != 3 || plan[1] > 254 || (uint32_t)plan[1] + 3 > length
        || plan[2] != 0xd1 || plan[3] != 1 || plan[5] != 0x55 || plan[6] != 4
        || plan[plan[1] + 2] != 0xfe) return ATLAS_COMPANION_REJECTED;
    AtlasCompanionSession *s = calloc(1, sizeof(*s)); if (!s) return ATLAS_COMPANION_REJECTED;
    s->first = first; s->last = last; s->length = length; s->extent = extent; s->next_step = 1;
    memcpy(s->plan, plan, length); memcpy(s->reader, reader, strlen(reader) + 1);
    int32_t status = SCardEstablishContext(SCARD_SCOPE_USER, NULL, NULL, &s->context);
    if (!status) status = SCardConnect(s->context, reader, SCARD_SHARE_EXCLUSIVE, SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1, &s->card, &s->protocol);
    if (!status) {
        uint8_t atr[64] = {0}; char names[4096] = {0};
        uint32_t atr_length = sizeof(atr), names_length = sizeof(names), card_state = 0, actual = 0;
        status = SCardStatus(s->card, names, &names_length, &card_state, &actual, atr, &atr_length);
        if (!status && (actual != s->protocol || (actual != SCARD_PROTOCOL_T0 && actual != SCARD_PROTOCOL_T1)
                       || !atlas_is_ultralight_atr(atr, atr_length))) status = ATLAS_COMPANION_REJECTED;
        atlas_clear(atr, sizeof(atr)); atlas_clear(names, sizeof(names));
    }
    if (!status) status = raw_read(s, 0, s->header);
    for (uint32_t offset = 0; !status && offset < extent; offset += 16) {
        status = atlas_companion_same_tag(s);
        if (!status) status = raw_read(s, first + offset / 4, s->before + offset);
    }
    if (!status && (s->before[0] != 3 || s->before[1] != 0 || s->before[2] != 0xfe)) status = ATLAS_COMPANION_NOT_EMPTY;
    for (uint32_t i = 3; !status && i < extent; i++) if (s->before[i]) status = ATLAS_COMPANION_NOT_EMPTY;
    if (status) { (void)atlas_companion_close(s); return status; }
    *out = s; return 0;
}
int32_t atlas_companion_facts(AtlasCompanionSession *s, AtlasCompanionFacts *out) {
    if (!s || !out || s->failed) return ATLAS_COMPANION_REJECTED;
    int32_t status = atlas_companion_same_tag(s); if (status) return status;
    out->manufacturer = s->header[0]; memcpy(out->cc, s->header + 12, 4); memcpy(out->lock_candidate, s->header + 10, 2); return 0;
}
int32_t atlas_companion_read16(AtlasCompanionSession *s, uint32_t page, uint8_t out[16]) {
    if (!s || !out || page < s->first || page > s->last || page + 3 > s->last) return ATLAS_COMPANION_REJECTED;
    int32_t status = atlas_companion_same_tag(s); if (!status) status = raw_read(s, page, out);
    if (status) { s->failed = 1; atlas_clear(out, 16); } return status;
}
int32_t atlas_companion_write4(AtlasCompanionSession *s, uint32_t page, const uint8_t expected[4]) {
    if (!s || !expected || s->failed || s->verified || s->next_step > s->length / 4) return ATLAS_COMPANION_REJECTED;
    const uint32_t index = s->next_step == s->length / 4 ? 0 : s->next_step;
    if (page != s->first + index || page + 3 > s->last || memcmp(expected, s->plan + index * 4, 4)) return ATLAS_COMPANION_ORDER;
    int32_t status = atlas_companion_same_tag(s); if (status) return status;
    s->next_step++; // Consume the operation BEFORE SCardTransmit; a lost reply cannot repeat it.
    const uint8_t command[] = {0xff, 0xd6, 0, (uint8_t)page, 4, expected[0], expected[1], expected[2], expected[3]};
    SCARD_IO_REQUEST pci = {s->protocol, sizeof(SCARD_IO_REQUEST)};
    uint8_t response[2] = {0}, found[16] = {0}; uint32_t size = sizeof(response);
    status = SCardTransmit(s->card, &pci, command, sizeof(command), NULL, response, &size);
    if (!status && (size != 2 || response[0] != 0x90 || response[1] != 0)) status = ATLAS_COMPANION_REJECTED;
    if (!status) status = atlas_companion_same_tag(s);
    if (!status) status = raw_read(s, page, found);
    if (!status && memcmp(found, expected, 4)) status = ATLAS_COMPANION_READBACK;
    if (!status && index == 0) {
        for (uint32_t offset = 0; !status && offset < s->extent; offset += 16) {
            status = atlas_companion_same_tag(s); if (!status) status = raw_read(s, s->first + offset / 4, found);
            for (uint32_t j = 0; !status && j < 16; j++) {
                const uint32_t at = offset + j;
                if (found[j] != (at < s->length ? s->plan[at] : s->before[at])) status = ATLAS_COMPANION_READBACK;
            }
        }
        if (!status) s->verified = 1;
    }
    atlas_clear(response, sizeof(response)); atlas_clear(found, sizeof(found)); if (status) s->failed = 1; return status;
}
int atlas_companion_readback_verified(AtlasCompanionSession *s) { return s && s->verified && !s->failed; }
int32_t atlas_companion_presence(uint32_t timeout_ms, uint32_t *state, uint32_t *selected) {
    if (!state || !selected || timeout_ms > 5000) return ATLAS_COMPANION_REJECTED;
    *state = UINT32_MAX; *selected = UINT32_MAX;
    SCARDCONTEXT context = 0; int32_t status = SCardEstablishContext(SCARD_SCOPE_USER, NULL, NULL, &context);
    if (status) return status;
    SCARD_READERSTATE values[2] = {0}; for (int i = 0; i < 2; i++) values[i].szReader = readers[i];
    status = SCardGetStatusChange(context, timeout_ms, values, 2); uint32_t count = 0, chosen = UINT32_MAX;
    for (uint32_t i = 0; !status && i < 2; i++) {
        const uint32_t event = values[i].dwEventState;
        if (event & (SCARD_STATE_UNKNOWN | SCARD_STATE_UNAVAILABLE | SCARD_STATE_IGNORE | SCARD_STATE_EXCLUSIVE | SCARD_STATE_INUSE)
            || !!(event & SCARD_STATE_PRESENT) == !!(event & SCARD_STATE_EMPTY)) status = ATLAS_COMPANION_REJECTED;
        else if (event & SCARD_STATE_PRESENT) {
            count++; chosen = i;
            if (event & (SCARD_STATE_MUTE | SCARD_STATE_UNPOWERED) || !atlas_is_ultralight_atr(values[i].rgbAtr, values[i].cbAtr)) status = ATLAS_COMPANION_REJECTED;
        }
    }
    if (!status && count > 1) status = ATLAS_COMPANION_REJECTED;
    int32_t released = SCardReleaseContext(context); if (!status) status = released;
    if (!status) { *state = count ? ATLAS_COMPANION_PRESENT : ATLAS_COMPANION_EMPTY; *selected = chosen; }
    atlas_clear(values, sizeof(values)); return status;
}
int32_t atlas_companion_wait_removed(AtlasCompanionSession *s, uint32_t timeout_ms, uint32_t *removed) {
    if (!s || !removed || timeout_ms > 5000) return ATLAS_COMPANION_REJECTED; *removed = 0;
    SCARD_READERSTATE value = {0}; value.szReader = s->reader; value.dwCurrentState = SCARD_STATE_PRESENT;
    int32_t status = SCardGetStatusChange(s->context, timeout_ms, &value, 1);
    if ((uint32_t)status == SCARD_E_TIMEOUT) { atlas_clear(&value, sizeof(value)); return 0; }
    if (!status && (value.dwEventState & (SCARD_STATE_UNKNOWN | SCARD_STATE_UNAVAILABLE | SCARD_STATE_IGNORE))) status = ATLAS_COMPANION_REJECTED;
    if (!status && (value.dwEventState & SCARD_STATE_EMPTY) && !(value.dwEventState & SCARD_STATE_PRESENT)) *removed = 1;
    atlas_clear(&value, sizeof(value)); return status;
}
