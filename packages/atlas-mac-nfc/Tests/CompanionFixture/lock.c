#include "CAtlasNFCCompanion.h"
#include "lock_profile.h"
#include <PCSC/winscard.h>
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <time.h>

/* INVENTED FIXTURE CHIP, NOT F8215/NXP/PHYSICAL QUALIFICATION. This binary links
 * only the fake PC/SC functions below. No hardware framework or real registry. */
static const char hash[] = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
static const char qualification[] = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
static AtlasLockProfile profile;
static uint8_t memory[192], original[192], ndef[80];
static unsigned connects, disconnects, releases, reads, data_writes, lock_writes, scenarios;
static unsigned failing_step;
enum { NORMAL, LOST_BEFORE, LOST_AFTER, MALFORMED, READER_REJECTED, NO_CHANGE, COLLATERAL, UID_CHANGED, HEADER_READ_LOST, SLOW_REPLY };
static int fault;
static int64_t expires_at_ms;
static int64_t now_ms(void) { struct timespec t; assert(!clock_gettime(CLOCK_REALTIME, &t)); return (int64_t)t.tv_sec * 1000 + t.tv_nsec / 1000000; }
static uint8_t atr[] = {0x3b,0x8f,0x80,1,0x80,0x4f,0x0c,0xa0,0,0,3,6,3,0,3,0,0,0,0,0x68};

const AtlasLockProfile *atlas_companion_compiled_profile(const char *h, const char *q) {
    return h && q && !strcmp(h, hash) && !strcmp(q, qualification) ? &profile : NULL;
}
int32_t SCardEstablishContext(uint32_t scope, const void *a, const void *b, LPSCARDCONTEXT out) {
    assert(scope == SCARD_SCOPE_USER && !a && !b); *out = 10; return 0;
}
int32_t SCardReleaseContext(SCARDCONTEXT context) { assert(context == 10); releases++; return 0; }
int32_t SCardListReaders(SCARDCONTEXT c, const char *g, char *o, uint32_t *l) { (void)c;(void)g;(void)o;(void)l; assert(0); return -1; }
int32_t SCardConnect(SCARDCONTEXT c, const char *reader, uint32_t share, uint32_t protocols, LPSCARDHANDLE card, uint32_t *protocol) {
    assert(c == 10 && !strcmp(reader, "ACS ACR1552 1S CL Reader(1)") && share == SCARD_SHARE_EXCLUSIVE);
    assert(protocols == (SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1)); connects++; *card = 20; *protocol = SCARD_PROTOCOL_T1; return 0;
}
int32_t SCardStatus(SCARDHANDLE card, char *names, uint32_t *names_length, uint32_t *state, uint32_t *protocol, unsigned char *out, uint32_t *size) {
    assert(card == 20 && *size >= sizeof(atr)); (void)names;(void)names_length; *state = SCARD_PRESENT;
    memcpy(out, atr, sizeof(atr)); *size = sizeof(atr); *protocol = SCARD_PROTOCOL_T1; return 0;
}
int32_t SCardDisconnect(SCARDHANDLE card, uint32_t disposition) { assert(card == 20 && disposition == SCARD_LEAVE_CARD); disconnects++; return 0; }
int32_t SCardGetStatusChange(SCARDCONTEXT c, uint32_t timeout, LPSCARD_READERSTATE_A states, uint32_t count) {
    (void)c;(void)timeout;(void)states;(void)count; assert(0); return -1;
}
int32_t SCardTransmit(SCARDHANDLE card, LPCSCARD_IO_REQUEST pci, const unsigned char *command, uint32_t size,
                      LPSCARD_IO_REQUEST receive, unsigned char *out, uint32_t *out_size) {
    assert(card == 20 && pci->dwProtocol == SCARD_PROTOCOL_T1 && !receive && command[0] == 0xff && command[2] == 0);
    const unsigned page = command[3];
    if (command[1] == 0xb0) {
        assert(size == 5 && command[4] == 16 && *out_size == 18 && page + 3 <= 47); reads++;
        if (!page && fault == HEADER_READ_LOST && lock_writes == failing_step) return SCARD_E_TIMEOUT;
        memcpy(out, memory + page * 4, 16); out[16] = 0x90; out[17] = 0; *out_size = 18; return 0;
    }
    assert(command[1] == 0xd6 && size == 9 && command[4] == 4 && *out_size == 2);
    if (page >= 4 && page <= 31) {
        assert(!lock_writes && !memcmp(command + 5, ndef + (page - 4) * 4, 4));
        assert(page == 4 ? data_writes == 19 : page == data_writes + 5);
        data_writes++; memcpy(memory + page * 4, command + 5, 4);
    } else {
        assert(data_writes == 20 && lock_writes < profile.step_count);
        const AtlasLockStep *step = profile.steps + lock_writes;
        assert(page == step->page);
        for (unsigned b = 0; b < 4; b++) assert(command[5 + b] == (memory[page * 4 + b] | step->set_mask[b]));
        lock_writes++;
        if (lock_writes == failing_step && fault == LOST_BEFORE) return SCARD_E_TIMEOUT;
        if (lock_writes == failing_step && fault == READER_REJECTED) { out[0] = 0x63; out[1] = 0; *out_size = 2; return 0; }
        if (lock_writes != failing_step || fault != NO_CHANGE) memcpy(memory + page * 4, command + 5, 4);
        if (lock_writes == failing_step) {
            if (fault == LOST_AFTER) return SCARD_E_TIMEOUT;
            if (fault == MALFORMED) { out[0] = 0x90; *out_size = 1; return 0; }
            if (fault == COLLATERAL) memory[180] ^= 1; // Outside the URL and all lock pages.
            if (fault == UID_CHANGED) memory[1] ^= 1;
            if (fault == SLOW_REPLY) { const struct timespec delay = {1, 100000000}; assert(!nanosleep(&delay, NULL)); }
        }
    }
    out[0] = 0x90; out[1] = 0; *out_size = 2; return 0;
}
static void reset(void) {
    profile = (AtlasLockProfile){.profile_hash = hash, .qualification_hash = qualification, .manufacturer = 0x7f,
        .cc = {0xe1, 0x10, 0x0e, 0}, .first_user_page = 4, .last_user_page = 31, .last_readable_page = 47,
        .step_count = 5, .coverage_count = 6,
        .steps = {{3, ATLAS_LOCK_CC, {0,0,0,0x0f}}, {40, ATLAS_LOCK_DATA, {3,0,0,0}},
                  {2, ATLAS_LOCK_DATA, {0,0,0xf0,0}}, {40, ATLAS_LOCK_FREEZE, {0,1,0,0}}, {2, ATLAS_LOCK_FREEZE, {0,0,1,0}}},
        .coverage = {{2,2,4,12,15}, {2,2,5,16,31}, {2,2,6,32,47}, {2,2,7,48,63}, {40,0,0,64,95}, {40,0,1,96,127}}};
    memset(memory, 0, sizeof(memory)); memory[0] = 0x7f; memory[1] = 0x22; memory[8] = 0x34; memory[9] = 0x56;
    memcpy(memory + 12, profile.cc, 4); memory[16] = 3; memory[18] = 0xfe;
    memory[160] = 0x80; memory[161] = 0xa0; memory[162] = 0xa5; memory[163] = 0x5a; memory[180] = 0x42;
    memcpy(original, memory, sizeof(memory)); connects = disconnects = releases = reads = data_writes = lock_writes = 0;
    fault = NORMAL; failing_step = 0; expires_at_ms = now_ms() + 60000;
}
static AtlasCompanionSession *open_session(void) {
    AtlasCompanionSession *session = NULL;
    assert(atlas_companion_profile_qualified(hash, qualification, 4, 31));
    assert(!atlas_companion_open_qualified("ACS ACR1552 1S CL Reader(1)", hash, qualification, 4, 31, ndef, sizeof(ndef), &session));
    assert(session && connects == 1 && !data_writes && !lock_writes); return session;
}
static void encode(AtlasCompanionSession *s) {
    for (unsigned step = 1; step <= 20; step++) {
        const unsigned index = step == 20 ? 0 : step;
        assert(!atlas_companion_write4(s, 4 + index, ndef + index * 4));
    }
    assert(atlas_companion_readback_verified(s) && !atlas_companion_lock_verified(s));
}
static void finish(AtlasCompanionSession *s) {
    assert(!atlas_companion_close(s)); assert(connects == 1 && disconnects == 1 && releases == 1); scenarios++;
}
static void invalid_profile(void) {
    AtlasCompanionSession *s = NULL;
    assert(!atlas_companion_lock_profile_valid(&profile));
    assert(atlas_companion_open_qualified("ACS ACR1552 1S CL Reader(1)", hash, qualification, 4, 31, ndef, sizeof(ndef), &s) == ATLAS_COMPANION_PROFILE_UNQUALIFIED);
    assert(!s && !connects && !reads && !data_writes && !lock_writes); scenarios++;
}
int main(void) {
    memset(ndef, 0, sizeof(ndef)); ndef[0]=3; ndef[1]=74; ndef[2]=0xd1; ndef[3]=1; ndef[4]=70; ndef[5]=0x55; ndef[6]=4;
    memset(ndef+7,'x',69); ndef[76]=0xfe;
    reset(); assert(atlas_companion_lock_profile_valid(&profile));
    AtlasCompanionSession *s = open_session();
    assert(atlas_companion_lock_qualified(s, expires_at_ms) == ATLAS_COMPANION_ORDER && !lock_writes);
    assert(atlas_companion_verify_lock(s) == ATLAS_COMPANION_ORDER && !atlas_companion_lock_verified(s));
    encode(s); assert(!atlas_companion_lock_qualified(s, expires_at_ms) && lock_writes == 5 && !atlas_companion_lock_verified(s));
    assert(!atlas_companion_same_tag(s)); // Expected CC/static-lock transitions are accepted.
    assert(!atlas_companion_verify_lock(s) && atlas_companion_lock_verified(s));
    assert(atlas_companion_lock_qualified(s, expires_at_ms) == ATLAS_COMPANION_ORDER && lock_writes == 5);
    assert(atlas_companion_write4(s, 4, ndef) && data_writes == 20);
    for (unsigned b = 0; b < sizeof(memory); b++) {
        uint8_t expected = b >= 16 && b < 96 ? ndef[b - 16] : original[b];
        for (unsigned i = 0; i < profile.step_count; i++) if (b / 4 == profile.steps[i].page) expected |= profile.steps[i].set_mask[b % 4];
        assert(memory[b] == expected);
    }
    AtlasCompanionFailure why; assert(!atlas_companion_failure(s, &why) && why.kind == ATLAS_FAILURE_NONE); finish(s);

    // Every mutating boundary: response loss both before/after application,
    // malformed success, reader failure, ACK without mutation, collateral changes,
    // UID swap and readback transport loss. None is a retry or lock proof.
    for (int kind = LOST_BEFORE; kind <= HEADER_READ_LOST; kind++) for (unsigned step = 1; step <= 5; step++) {
        reset(); s = open_session(); encode(s); fault = kind; failing_step = step;
        const int32_t status = atlas_companion_lock_qualified(s, expires_at_ms); assert(status && lock_writes == step);
        assert(!atlas_companion_lock_verified(s) && !atlas_companion_readback_verified(s));
        const unsigned before = reads;
        assert(atlas_companion_lock_qualified(s, expires_at_ms) && atlas_companion_verify_lock(s) && atlas_companion_write4(s, 4, ndef));
        assert(reads == before && lock_writes == step && data_writes == 20);
        assert(!atlas_companion_failure(s, &why));
        if (kind == LOST_BEFORE || kind == LOST_AFTER || kind == HEADER_READ_LOST) {
            assert(why.kind == ATLAS_FAILURE_TRANSPORT && (uint32_t)why.pcsc_status == SCARD_E_TIMEOUT && why.transmitted);
        } else if (kind == MALFORMED) assert(why.kind == ATLAS_FAILURE_REPLY_LENGTH && why.operation == ATLAS_OPERATION_LOCK_WRITE);
        else if (kind == READER_REJECTED) assert(why.kind == ATLAS_FAILURE_APDU_STATUS && why.status_word == 0x6300);
        else if (kind == UID_CHANGED || (kind == NO_CHANGE && (step == 1 || step == 3 || step == 5))) assert(why.kind == ATLAS_FAILURE_CONTINUITY);
        else assert(why.kind == ATLAS_FAILURE_READBACK);
        finish(s);
    }
    // Reverify actual bytes; a past ACK or cached boolean is insufficient.
    reset(); s = open_session(); encode(s); assert(!atlas_companion_lock_qualified(s, expires_at_ms)); memory[160] ^= 1;
    assert(atlas_companion_verify_lock(s) && !atlas_companion_lock_verified(s)); finish(s);
    reset(); s = open_session(); encode(s); memory[120] = 1; // Beyond padded URL/guard.
    assert(atlas_companion_lock_qualified(s, expires_at_ms) && !lock_writes); finish(s);
    reset(); s = open_session(); encode(s); memory[1] ^= 1;
    assert(atlas_companion_lock_qualified(s, expires_at_ms) == ATLAS_COMPANION_CHANGED && !lock_writes); finish(s);
    reset(); s = open_session(); encode(s);
    const unsigned before_expiry_reads = reads;
    assert(atlas_companion_lock_qualified(s, 1) == ATLAS_COMPANION_EXPIRED && !lock_writes && reads == before_expiry_reads);
    assert(!atlas_companion_failure(s, &why) && why.kind == ATLAS_FAILURE_EXPIRED && !why.transmitted); finish(s);
    reset(); s = open_session(); encode(s); fault = SLOW_REPLY; failing_step = 1;
    assert(atlas_companion_lock_qualified(s, now_ms() + 1000) == ATLAS_COMPANION_EXPIRED && lock_writes == 1);
    assert(!atlas_companion_lock_verified(s) && !atlas_companion_failure(s, &why) && why.kind == ATLAS_FAILURE_EXPIRED && !why.transmitted);
    const unsigned expired_reads = reads;
    assert(atlas_companion_lock_qualified(s, now_ms() + 60000) == ATLAS_COMPANION_ORDER && reads == expired_reads && lock_writes == 1); finish(s);

    // Malformed compiled maps fail before connecting. No uncovered tail, no
    // data/UID write, no duplicate/undefined bit, no early freeze, no CC-only lock.
    reset(); profile.coverage[5].last_byte = 126; invalid_profile();
    reset(); profile.coverage_count = 5; invalid_profile();
    reset(); profile.steps[1].page = 20; invalid_profile();
    reset(); profile.steps[2].set_mask[0] = 1; invalid_profile();
    reset(); profile.steps[1].set_mask[0] |= 4; invalid_profile();
    reset(); profile.steps[4].set_mask[2] |= 0x10; invalid_profile();
    reset(); profile.steps[1].kind = ATLAS_LOCK_FREEZE; invalid_profile();
    reset(); profile.steps[0].set_mask[0] = 1; invalid_profile();
    reset(); profile.step_count = 1; invalid_profile();
    reset(); profile.coverage[5] = profile.coverage[4]; invalid_profile();
    reset(); profile.coverage[5].first_byte = 11; invalid_profile();
    reset(); profile.coverage[5].last_byte = 128; invalid_profile();
    reset(); profile.last_readable_page = 46; invalid_profile();
    reset(); profile.cc[2]++; invalid_profile();
    reset(); profile.profile_hash = qualification; // Registry key must match returned profile exactly.
    assert(!atlas_companion_profile_qualified(hash, qualification, 4, 31)); scenarios++;
    reset(); assert(!atlas_companion_profile_qualified(NULL, qualification, 4, 31)
        && !atlas_companion_profile_qualified(hash, NULL, 4, 31)
        && !atlas_companion_profile_qualified(hash, qualification, 4, 47)); scenarios++;

    // Wrong chip/CC, nonblank distant data and pre-existing locks never write.
    for (unsigned field = 0; field < 6; field++) {
        reset();
        if (field == 0) memory[0] ^= 1;
        if (field == 1) memory[14] ^= 1;
        if (field == 2) memory[10] = 1;
        if (field == 3) memory[160] |= 1;
        if (field == 4) memory[120] = 1;
        if (field == 5) memory[16] = 1; // A factory control TLV cannot be overwritten.
        s = NULL;
        assert(atlas_companion_open_qualified("ACS ACR1552 1S CL Reader(1)", hash, qualification, 4, 31, ndef, sizeof(ndef), &s));
        assert(!s && connects == 1 && disconnects == 1 && releases == 1 && !data_writes && !lock_writes); scenarios++;
    }
    // Old unqualified C data sessions have no path into the locking engine.
    reset(); assert(!atlas_companion_open("ACS ACR1552 1S CL Reader(1)", 4, 31, ndef, sizeof(ndef), &s)); encode(s);
    assert(atlas_companion_lock_qualified(s, expires_at_ms) == ATLAS_COMPANION_PROFILE_UNQUALIFIED
        && atlas_companion_verify_lock(s) == ATLAS_COMPANION_PROFILE_UNQUALIFIED && !lock_writes); finish(s);
    printf("{\"test\":\"native_companion_lock_fixture\",\"ok\":true,\"scenarios\":%u,\"hardwareCalls\":0,\"syntheticProfileOnly\":true}\n", scenarios);
}
