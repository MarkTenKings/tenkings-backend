#include "CAtlasPCSC.h"
#include "CAtlasNFCDiagnostic.h"
#include <PCSC/winscard.h>
#include <assert.h>
#include <stdio.h>
#include <string.h>

enum {
    OK, CONTEXT_FAIL, CONNECT_FAIL, STATUS_FAIL, ATR_BAD, PROTOCOL_BAD,
    MANUFACTURER_BAD, BCC1_BAD, BCC2_BAD, STATIC_LOCK, CC_SIZE, CC_ACCESS,
    HEADER_SW, HEADER_SHORT, PREFLIGHT_FAIL, OCCUPIED, SWAP_FIRST, SWAP_PARTIAL,
    IDENTITY_READ_FAIL, WRITE_DENIED, WRITE_LOST_ACK, WRITE_SHORT_ACK,
    PAGE_MISMATCH, FINAL_MISMATCH, COMMIT_LOST_ACK, JOURNAL_PREFLIGHT,
    JOURNAL_FIRST_INTENT, JOURNAL_PARTIAL, JOURNAL_PAGE, JOURNAL_FINAL,
    DISCONNECT_FAIL, RELEASE_FAIL, PRIMARY_AND_CLEANUP, SWAP_FINAL, JOURNAL_COMMIT, SCENARIOS
};
static int scenario, established, connected, disconnected, released, reads, writes;
static int header_reads, pending_intent, just_wrote, final_journal;
static uint8_t memory[192], original_header[16], plan[64];
static uint32_t plan_length, page_count, written_pages;

int32_t SCardEstablishContext(uint32_t scope, const void *a, const void *b, LPSCARDCONTEXT context) {
    assert(scope == SCARD_SCOPE_USER && !a && !b); established++;
    if (scenario == CONTEXT_FAIL) return SCARD_E_NO_SERVICE;
    *context = 10; return 0;
}
int32_t SCardReleaseContext(SCARDCONTEXT context) {
    assert(context == 10); released++;
    return scenario == RELEASE_FAIL || scenario == PRIMARY_AND_CLEANUP ? SCARD_E_NO_SERVICE : 0;
}
int32_t SCardListReaders(SCARDCONTEXT c, const char *g, char *o, uint32_t *l) {
    (void)c; (void)g; (void)o; (void)l; assert(0); return -1;
}
int32_t SCardGetStatusChange(SCARDCONTEXT c, uint32_t t, LPSCARD_READERSTATE_A s, uint32_t n) {
    (void)c; (void)t; (void)s; (void)n; assert(0); return -1;
}
int32_t SCardConnect(SCARDCONTEXT context, const char *reader, uint32_t share,
                     uint32_t protocols, LPSCARDHANDLE card, uint32_t *protocol) {
    assert(context == 10 && !strcmp(reader, "ACS ACR1552 1S CL Reader(1)"));
    assert(share == SCARD_SHARE_EXCLUSIVE && protocols == (SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1));
    connected++;
    if (scenario == CONNECT_FAIL) return SCARD_E_NO_SMARTCARD;
    *card = 20; *protocol = SCARD_PROTOCOL_T1; return 0;
}
int32_t SCardStatus(SCARDHANDLE card, char *names, uint32_t *names_length, uint32_t *state,
                    uint32_t *protocol, unsigned char *atr, uint32_t *atr_length) {
    assert(card == 20 && *atr_length >= 20); (void)names; (void)names_length;
    if (scenario == STATUS_FAIL) return SCARD_E_NO_SMARTCARD;
    const uint8_t value[] = {0x3B,0x8F,0x80,0x01,0x80,0x4F,0x0C,0xA0,0,0,3,6,3,0,3,0,0,0,0,0x68};
    memcpy(atr, value, sizeof(value)); *atr_length = sizeof(value); *state = 0;
    *protocol = scenario == PROTOCOL_BAD ? SCARD_PROTOCOL_T0 : SCARD_PROTOCOL_T1;
    if (scenario == ATR_BAD) atr[14] ^= 1;
    return 0;
}
int32_t SCardDisconnect(SCARDHANDLE card, uint32_t disposition) {
    assert(card == 20 && disposition == SCARD_LEAVE_CARD); disconnected++;
    return scenario == DISCONNECT_FAIL || scenario == PRIMARY_AND_CLEANUP ? SCARD_E_NO_SMARTCARD : 0;
}
int32_t SCardTransmit(SCARDHANDLE card, LPCSCARD_IO_REQUEST pci, const unsigned char *command,
                      uint32_t length, LPSCARD_IO_REQUEST receive_pci, unsigned char *response, uint32_t *response_length) {
    assert(card == 20 && pci->dwProtocol == SCARD_PROTOCOL_T1 && pci->cbPciLength == sizeof(SCARD_IO_REQUEST));
    assert(!receive_pci && command[0] == 0xFF && command[2] == 0);
    const uint32_t page = command[3];
    if (command[1] == 0xB0) {
        reads++;
        assert(length == 5 && command[4] == 16 && *response_length == 18 && page + 3 <= 47);
        memcpy(response, memory + page * 4, 16); response[16] = 0x90; response[17] = 0; *response_length = 18;
        if (!page) {
            header_reads++;
            if ((scenario == SWAP_FIRST && header_reads == 2) || (scenario == SWAP_PARTIAL && header_reads == 3)
                || (scenario == SWAP_FINAL && header_reads == (int)page_count + 2)) response[1] ^= 1;
            if (scenario == IDENTITY_READ_FAIL && header_reads == 2) return SCARD_E_NO_SMARTCARD;
            if (scenario == HEADER_SW && header_reads == 1) response[16] = 0x69;
            if (scenario == HEADER_SHORT && header_reads == 1) *response_length = 2;
        } else {
            if (scenario == PREFLIGHT_FAIL && !writes && page == 12) return SCARD_E_NO_SMARTCARD;
            if (just_wrote) {
                if (scenario == PAGE_MISMATCH) response[0] ^= 1;
                just_wrote = 0;
            } else if (scenario == FINAL_MISMATCH && writes == (int)page_count && page == 4) response[0] ^= 1;
        }
        return 0;
    }
    // No arbitrary command, control, security-page write, alternate payload or retry.
    assert(command[1] == 0xD6 && length == 9 && command[4] == 4 && *response_length == 2);
    assert(page >= 4 && page < 4 + page_count && page <= 19);
    assert(pending_intent == (int)page && !(written_pages & (1u << (page - 4))));
    assert(!memcmp(command + 5, plan + (page - 4) * 4, 4));
    assert(page == 4 ? writes == (int)page_count - 1 : page == (uint32_t)writes + 5);
    pending_intent = 0; written_pages |= 1u << (page - 4); writes++;
    response[0] = 0x90; response[1] = 0; *response_length = 2;
    if (scenario == WRITE_DENIED) { response[0] = 0x69; response[1] = 0x82; return 0; }
    if (scenario == PRIMARY_AND_CLEANUP) return SCARD_E_TIMEOUT;
    memcpy(memory + page * 4, command + 5, 4); just_wrote = 1;
    if (scenario == WRITE_LOST_ACK || (scenario == COMMIT_LOST_ACK && page == 4)) return SCARD_E_TIMEOUT;
    if (scenario == WRITE_SHORT_ACK) *response_length = 1;
    return 0;
}
static int32_t journal(void *context, const char *event, uint32_t page) {
    assert(context == (void *)1);
    if (!strcmp(event, "preflight_passed")) {
        assert(!writes && !page);
        if (scenario == JOURNAL_PREFLIGHT) return -1;
    } else if (!strcmp(event, "write_intent") || !strcmp(event, "commit_intent")) {
        assert(!pending_intent && page >= 4 && page < 4 + page_count);
        assert((page == 4) == (!strcmp(event, "commit_intent")));
        if ((scenario == JOURNAL_FIRST_INTENT && !writes) || (scenario == JOURNAL_PARTIAL && writes == 1)
            || (scenario == JOURNAL_COMMIT && page == 4)) return -1;
        pending_intent = (int)page;
    } else if (!strcmp(event, "page_verified")) {
        assert(writes && !just_wrote && !pending_intent);
        if (scenario == JOURNAL_PAGE) return -1;
    } else {
        assert(!strcmp(event, "write_readback_verified") && !page);
        assert(writes == (int)page_count && disconnected == 1 && released == 1); final_journal++;
        if (scenario == JOURNAL_FINAL) return -1;
    }
    return 0;
}
static void reset(void) {
    established = connected = disconnected = released = reads = writes = 0;
    header_reads = pending_intent = just_wrote = final_journal = 0; written_pages = 0;
    memset(memory, 0, sizeof(memory));
    const uint8_t header[] = {0x1D,0x11,0x22,0xA6,0x33,0x44,0x55,0x66,0x44,0x48,0,0,0xE1,0x10,0x3E,0};
    memcpy(memory, header, sizeof(header)); memory[16] = 3; memory[18] = 0xFE;
    if (scenario == MANUFACTURER_BAD) memory[0] ^= 1;
    if (scenario == BCC1_BAD) memory[3] ^= 1;
    if (scenario == BCC2_BAD) memory[8] ^= 1;
    if (scenario == STATIC_LOCK) memory[10] = 1;
    if (scenario == CC_SIZE) memory[14] = 0x3F;
    if (scenario == CC_ACCESS) memory[15] = 0x0F;
    if (scenario == OCCUPIED) memory[79] = 1;
    memcpy(original_header, memory, sizeof(original_header));
}
int main(void) {
    plan_length = atlas_diagnostic_plan(plan, sizeof(plan)); page_count = plan_length / 4;
    assert(plan_length >= 8 && plan_length <= 64 && !(plan_length % 4));
    const uint32_t stages[] = {0,2,3,4,5,5,6,6,6,6,6,6,6,6,7,8,10,10,10,11,11,11,12,13,11,9,9,9,9,9,14,15,11,10,9};
    assert(sizeof(stages)/sizeof(stages[0]) == SCENARIOS);
    for (scenario = 0; scenario < SCENARIOS; scenario++) {
        reset(); AtlasDiagnosticResult result;
        int32_t status = atlas_write_diagnostic("ACS ACR1552 1S CL Reader(1)", journal, (void *)1, &result);
        assert((status == 0) == (scenario == OK));
        assert(result.stage == stages[scenario]);
        assert(established == 1 && released == (scenario == CONTEXT_FAIL ? 0 : 1));
        assert(connected == (scenario == CONTEXT_FAIL ? 0 : 1));
        assert(disconnected == ((scenario == CONTEXT_FAIL || scenario == CONNECT_FAIL) ? 0 : 1));
        assert(result.read_attempts == (uint32_t)reads && result.write_attempts == (uint32_t)writes);
        assert(!memcmp(memory, original_header, sizeof(original_header)));
        assert(writes <= (int)page_count);
        const int full = scenario == OK || scenario == FINAL_MISMATCH || scenario == COMMIT_LOST_ACK
            || scenario == JOURNAL_FINAL || scenario == DISCONNECT_FAIL || scenario == RELEASE_FAIL || scenario == SWAP_FINAL;
        const int partial = scenario == SWAP_PARTIAL || scenario == WRITE_DENIED || scenario == WRITE_LOST_ACK
            || scenario == WRITE_SHORT_ACK || scenario == PAGE_MISMATCH || scenario == JOURNAL_PARTIAL
            || scenario == JOURNAL_PAGE || scenario == PRIMARY_AND_CLEANUP;
        assert(writes == (full ? (int)page_count : scenario == JOURNAL_COMMIT ? (int)page_count - 1 : partial ? 1 : 0));
        assert(result.commit_attempted == full);
        const int verified = scenario == OK || scenario == JOURNAL_FINAL || scenario == DISCONNECT_FAIL || scenario == RELEASE_FAIL;
        assert(result.readback_verified == verified);
        assert(final_journal == (scenario == OK || scenario == JOURNAL_FINAL));
        if (scenario == PRIMARY_AND_CLEANUP || scenario == WRITE_LOST_ACK || scenario == COMMIT_LOST_ACK) assert(status == (int32_t)SCARD_E_TIMEOUT);
        if (!full) assert(memory[16] == 3 && memory[17] == 0 && memory[18] == 0xFE);
        if (scenario == OK) {
            assert(!memcmp(memory + 16, plan, plan_length));
            assert(reads == (int)(10 + 2 * page_count));
        }
    }
    reset(); AtlasDiagnosticResult result;
    assert(atlas_write_diagnostic("unapproved reader", journal, (void *)1, &result) == ATLAS_DIAG_REJECTED && !established);
    assert(atlas_write_diagnostic("ACS ACR1552 1S CL Reader(1)", NULL, NULL, &result) == ATLAS_DIAG_REJECTED && !established);
    assert(atlas_write_diagnostic("ACS ACR1552 1S CL Reader(1)", journal, (void *)1, NULL) == ATLAS_DIAG_REJECTED && !established);
    assert(!atlas_diagnostic_plan(plan, plan_length - 1));
    assert(!atlas_diagnostic_plan(NULL, sizeof(plan)));
    printf("{\"test\":\"native_diagnostic_write_faults\",\"ok\":true,\"scenarios\":%d}\n", SCENARIOS + 5);
    return 0;
}
