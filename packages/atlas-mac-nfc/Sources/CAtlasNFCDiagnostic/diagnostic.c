#include "CAtlasNFCDiagnostic.h"
#include "CAtlasPCSC.h"
#include <PCSC/winscard.h>
#include <string.h>

// Fragment marks an isolated hardware test; it does not allocate a public report.
static const char uri[] = "https://atlasgrading.com/#nfc-mac-validation-20260909";
const char *atlas_diagnostic_uri(void) { return uri; }

uint32_t atlas_diagnostic_plan(uint8_t *buffer, uint32_t capacity) {
    const size_t suffix_length = sizeof(uri) - 1 - 8; // NFC URI prefix 04 = https://
    const uint32_t ndef_length = (uint32_t)suffix_length + 5;
    const uint32_t padded_length = (ndef_length + 3 + 3) & ~3u;
    if (!buffer || capacity < padded_length || padded_length > 64 || ndef_length > 254) return 0;
    memset(buffer, 0, padded_length);
    buffer[0] = 0x03; buffer[1] = (uint8_t)ndef_length;
    buffer[2] = 0xD1; buffer[3] = 0x01; buffer[4] = (uint8_t)(suffix_length + 1);
    buffer[5] = 0x55; buffer[6] = 0x04;
    memcpy(buffer + 7, uri + 8, suffix_length);
    buffer[7 + suffix_length] = 0xFE;
    return padded_length;
}

static int32_t read16(SCARDHANDLE card, uint32_t protocol, uint8_t page,
                      uint8_t output[16], AtlasDiagnosticResult *result) {
    const uint8_t command[] = {0xFF, 0xB0, 0, page, 0x10};
    SCARD_IO_REQUEST pci = {protocol, sizeof(SCARD_IO_REQUEST)};
    uint8_t response[18] = {0}; uint32_t length = sizeof(response);
    result->read_attempts++;
    int32_t status = SCardTransmit(card, &pci, command, sizeof(command), NULL, response, &length);
    if (!status && (length != 18 || response[16] != 0x90 || response[17] != 0)) status = ATLAS_DIAG_REJECTED;
    if (!status) memcpy(output, response, 16);
    atlas_clear(response, sizeof(response));
    return status;
}

static int header_matches_profile(const uint8_t header[16]) {
    const uint8_t cc[] = {0xE1, 0x10, 0x3E, 0x00};
    // An observed profile of the owner's sample, not a silicon authenticity test.
    return header[0] == 0x1D && header[3] == (0x88 ^ header[0] ^ header[1] ^ header[2])
        && header[8] == (header[4] ^ header[5] ^ header[6] ^ header[7])
        && header[10] == 0 && header[11] == 0 && !memcmp(header + 12, cc, sizeof(cc));
}

int32_t atlas_write_diagnostic(const char *reader, AtlasDiagnosticJournal journal,
                              void *journal_context, AtlasDiagnosticResult *result) {
    if (!result) return ATLAS_DIAG_REJECTED;
    memset(result, 0, sizeof(*result)); result->stage = ATLAS_DIAG_INPUT;
    if (!reader || !journal || (strcmp(reader, "ACS ACR1552 1S CL Reader(1)")
                               && strcmp(reader, "ACS ACR1552 1S CL Reader(2)"))) return ATLAS_DIAG_REJECTED;
    uint8_t plan[64] = {0}, before[64] = {0}, after[64] = {0};
    uint8_t header[16] = {0}, check_header[16] = {0}, check_page[16] = {0};
    const uint32_t plan_length = atlas_diagnostic_plan(plan, sizeof(plan));
    if (!plan_length || plan_length > sizeof(before)) return ATLAS_DIAG_REJECTED;
    SCARDCONTEXT context = 0; SCARDHANDLE card = 0; uint32_t protocol = 0;
    int have_context = 0, have_card = 0;
    result->stage = ATLAS_DIAG_CONTEXT;
    int32_t status = SCardEstablishContext(SCARD_SCOPE_USER, NULL, NULL, &context);
    if (status) goto finish;
    have_context = 1; result->stage = ATLAS_DIAG_CONNECT;
    status = SCardConnect(context, reader, SCARD_SHARE_EXCLUSIVE,
                          SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1, &card, &protocol);
    if (status) goto finish;
    have_card = 1; result->stage = ATLAS_DIAG_STATUS;
    {
        uint8_t atr[64] = {0}; char name[4096] = {0};
        uint32_t atr_length = sizeof(atr), name_length = sizeof(name), state = 0, actual_protocol = 0;
        status = SCardStatus(card, name, &name_length, &state, &actual_protocol, atr, &atr_length);
        if (!status && ((protocol != SCARD_PROTOCOL_T0 && protocol != SCARD_PROTOCOL_T1)
                       || actual_protocol != protocol || !atlas_is_ultralight_atr(atr, atr_length))) {
            result->stage = ATLAS_DIAG_ATR; status = ATLAS_DIAG_REJECTED;
        }
        atlas_clear(atr, sizeof(atr)); atlas_clear(name, sizeof(name));
    }
    if (status) goto finish;
    result->stage = ATLAS_DIAG_HEADER;
    status = read16(card, protocol, 0, header, result);
    if (!status && !header_matches_profile(header)) status = ATLAS_DIAG_REJECTED;
    if (status) goto finish;
    result->stage = ATLAS_DIAG_PREFLIGHT_READ;
    for (uint32_t offset = 0; offset < sizeof(before); offset += 16) {
        status = read16(card, protocol, (uint8_t)(4 + offset / 4), before + offset, result);
        if (status) goto finish;
    }
    // Exact empty NDEF + terminator, then all zero across the affected region and
    // its padding. Unexpected data stops before any write; it is never overwritten.
    result->stage = ATLAS_DIAG_NOT_EMPTY;
    if (before[0] != 0x03 || before[1] != 0 || before[2] != 0xFE) { status = ATLAS_DIAG_REJECTED; goto finish; }
    for (uint32_t i = 3; i < sizeof(before); i++) {
        if (before[i]) { status = ATLAS_DIAG_REJECTED; goto finish; }
    }
    result->stage = ATLAS_DIAG_JOURNAL;
    if (journal(journal_context, "preflight_passed", 0)) { status = ATLAS_DIAG_JOURNAL_FAILED; goto finish; }

    const uint32_t pages = plan_length / 4;
    // Keep the empty NDEF/terminator visible while writing the later pages; page4
    // publishes the complete message only after those pages have verified readback.
    for (uint32_t step = 1; step <= pages; step++) {
        const uint32_t index = step == pages ? 0 : step;
        const uint32_t page = 4 + index;
        if (page < 4 || page > 19) { result->stage = ATLAS_DIAG_INPUT; status = ATLAS_DIAG_REJECTED; goto finish; }
        result->stage = ATLAS_DIAG_IDENTITY;
        status = read16(card, protocol, 0, check_header, result);
        if (!status && memcmp(header, check_header, sizeof(header))) status = ATLAS_DIAG_REJECTED;
        if (status) goto finish;
        result->stage = ATLAS_DIAG_JOURNAL;
        if (journal(journal_context, index ? "write_intent" : "commit_intent", page)) {
            status = ATLAS_DIAG_JOURNAL_FAILED; goto finish;
        }
        result->stage = ATLAS_DIAG_WRITE;
        const uint8_t command[] = {0xFF,0xD6,0,(uint8_t)page,4,
            plan[index*4],plan[index*4+1],plan[index*4+2],plan[index*4+3]};
        SCARD_IO_REQUEST pci = {protocol, sizeof(SCARD_IO_REQUEST)};
        uint8_t response[2] = {0}; uint32_t response_length = sizeof(response);
        result->write_attempts++;
        if (!index) result->commit_attempted = 1;
        status = SCardTransmit(card, &pci, command, sizeof(command), NULL, response, &response_length);
        if (!status && (response_length != 2 || response[0] != 0x90 || response[1] != 0)) status = ATLAS_DIAG_REJECTED;
        atlas_clear(response, sizeof(response));
        if (status) goto finish;
        result->stage = ATLAS_DIAG_PAGE_READBACK;
        status = read16(card, protocol, (uint8_t)page, check_page, result);
        if (!status && memcmp(plan + index*4, check_page, 4)) status = ATLAS_DIAG_READBACK_MISMATCH;
        if (status) goto finish;
        result->stage = ATLAS_DIAG_JOURNAL;
        if (journal(journal_context, "page_verified", page)) { status = ATLAS_DIAG_JOURNAL_FAILED; goto finish; }
    }
    result->stage = ATLAS_DIAG_FINAL_READBACK;
    for (uint32_t offset = 0; offset < sizeof(after); offset += 16) {
        status = read16(card, protocol, (uint8_t)(4 + offset / 4), after + offset, result);
        if (status) goto finish;
    }
    if (memcmp(plan, after, plan_length) || memcmp(before + plan_length, after + plan_length, sizeof(after) - plan_length)) {
        status = ATLAS_DIAG_READBACK_MISMATCH; goto finish;
    }
    result->stage = ATLAS_DIAG_IDENTITY;
    status = read16(card, protocol, 0, check_header, result);
    if (!status && memcmp(header, check_header, sizeof(header))) status = ATLAS_DIAG_REJECTED;
    if (!status) result->readback_verified = 1;
finish:
    if (have_card) {
        int32_t disconnected = SCardDisconnect(card, SCARD_LEAVE_CARD);
        if (!status && disconnected) { status = disconnected; result->stage = ATLAS_DIAG_DISCONNECT; }
    }
    if (have_context) {
        int32_t released = SCardReleaseContext(context);
        if (!status && released) { status = released; result->stage = ATLAS_DIAG_RELEASE; }
    }
    if (!status) {
        result->stage = ATLAS_DIAG_JOURNAL;
        if (journal(journal_context, "write_readback_verified", 0)) status = ATLAS_DIAG_JOURNAL_FAILED;
    }
    if (!status) result->stage = 0;
    atlas_clear(plan, sizeof(plan)); atlas_clear(before, sizeof(before)); atlas_clear(after, sizeof(after));
    atlas_clear(header, sizeof(header)); atlas_clear(check_header, sizeof(check_header)); atlas_clear(check_page, sizeof(check_page));
    return status;
}
