#include "CAtlasPCSC.h"
#include <PCSC/winscard.h>
#include <string.h>

void atlas_clear(void *buffer, size_t length) {
    volatile uint8_t *bytes = buffer;
    while (length--) *bytes++ = 0;
}

int32_t atlas_list_readers(char *buffer, uint32_t capacity, uint32_t *length) {
    if (!buffer || !length || capacity < 2 || capacity > 65536) return ATLAS_INVALID_LENGTH;
    *length = 0;
    SCARDCONTEXT context = 0;
    int32_t status = SCardEstablishContext(SCARD_SCOPE_USER, NULL, NULL, &context);
    if (status) return status;
    uint32_t size = capacity;
    status = SCardListReaders(context, NULL, buffer, &size);
    if ((uint32_t)status == SCARD_E_NO_READERS_AVAILABLE) { status = 0; size = 0; }
    // Apple returns success with one NUL (length 1) for an empty reader list.
    if (!status && size == 1 && buffer[0] == 0) size = 0;
    if (!status && size > capacity) status = ATLAS_INVALID_LENGTH;
    int32_t release = SCardReleaseContext(context);
    if (!status) status = release;
    if (!status) *length = size;
    return status;
}

int atlas_is_ultralight_atr(const uint8_t *atr, size_t length) {
    // ACS standard storage-card ATR, ISO14443A part3 + MIFARE Ultralight 0003.
    // Do not expose ATR bytes; unsupported/alternate ATRs remain unclassified.
    static const uint8_t prefix[] = {0x3B,0x8F,0x80,0x01,0x80,0x4F,0x0C,0xA0,0,0,3,6,3,0,3,0,0,0,0};
    if (!atr || length != 20 || memcmp(atr, prefix, sizeof(prefix))) return 0;
    uint8_t checksum = 0;
    for (size_t i = 1; i < length; i++) checksum ^= atr[i];
    return checksum == 0;
}

int32_t atlas_resolve_present_type2(const char *first, const char *second, uint32_t *selected) {
    if (!selected) return ATLAS_INVALID_LENGTH;
    *selected = UINT32_MAX;
    if (!first || !second || !*first || !*second || !strcmp(first, second)
        || strlen(first) > 1024 || strlen(second) > 1024) return ATLAS_INVALID_LENGTH;
    SCARDCONTEXT context = 0;
    int32_t status = SCardEstablishContext(SCARD_SCOPE_USER, NULL, NULL, &context);
    if (status) return status;
    SCARD_READERSTATE states[2] = {0};
    states[0].szReader = first;
    states[1].szReader = second;
    status = SCardGetStatusChange(context, 0, states, 2);
    uint32_t present = 0, candidate = UINT32_MAX;
    if (!status) {
        for (uint32_t i = 0; i < 2; i++) {
            const uint32_t event = states[i].dwEventState;
            if (event & (SCARD_STATE_UNKNOWN | SCARD_STATE_UNAVAILABLE | SCARD_STATE_IGNORE)) {
                status = SCARD_E_READER_UNAVAILABLE; break;
            }
            if (event & (SCARD_STATE_EXCLUSIVE | SCARD_STATE_INUSE)) {
                status = SCARD_E_SHARING_VIOLATION; break;
            }
            if (!!(event & SCARD_STATE_PRESENT) == !!(event & SCARD_STATE_EMPTY)) {
                status = ATLAS_AMBIGUOUS_INTERFACE; break;
            }
            if (event & SCARD_STATE_PRESENT) {
                present++;
                if (!(event & (SCARD_STATE_MUTE | SCARD_STATE_UNPOWERED))
                    && atlas_is_ultralight_atr(states[i].rgbAtr, states[i].cbAtr)) candidate = i;
            }
        }
        if (!status) {
            if (present > 1) status = ATLAS_AMBIGUOUS_INTERFACE;
            else if (!present) status = SCARD_E_NO_SMARTCARD;
            else if (candidate == UINT32_MAX) status = ATLAS_UNSUPPORTED_ATR;
        }
    }
    atlas_clear(states, sizeof(states));
    int32_t released = SCardReleaseContext(context);
    if (!status) status = released;
    if (!status) *selected = candidate;
    return status;
}

int32_t atlas_read_type2_header(const char *reader, uint8_t response[18], uint32_t *length,
                               AtlasInspectionDiagnostics *diagnostics) {
    if (!diagnostics) return ATLAS_INVALID_LENGTH;
    diagnostics->failure_stage = ATLAS_STAGE_NONE;
    diagnostics->fixed_read_attempted = 0;
    if (!reader || !response || !length) {
        diagnostics->failure_stage = ATLAS_STAGE_INPUT;
        return ATLAS_INVALID_LENGTH;
    }
    *length = 0;
    atlas_clear(response, 18);
    SCARDCONTEXT context = 0;
    SCARDHANDLE card = 0;
    uint32_t protocol = 0;
    int32_t status = SCardEstablishContext(SCARD_SCOPE_USER, NULL, NULL, &context);
    if (status) { diagnostics->failure_stage = ATLAS_STAGE_CONTEXT; return status; }
    // Exclusive connection avoids concurrent applications changing the tag between status/read.
    status = SCardConnect(context, reader, SCARD_SHARE_EXCLUSIVE, SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1, &card, &protocol);
    if (status) diagnostics->failure_stage = ATLAS_STAGE_CONNECT;
    if (!status) {
        uint8_t atr[64] = {0};
        char connectedReader[4096] = {0};
        uint32_t atrLength = sizeof(atr), readerLength = sizeof(connectedReader), state = 0, actualProtocol = 0;
        status = SCardStatus(card, connectedReader, &readerLength, &state, &actualProtocol, atr, &atrLength);
        if (status) diagnostics->failure_stage = ATLAS_STAGE_STATUS;
        if (!status && (protocol != actualProtocol || (protocol != SCARD_PROTOCOL_T0 && protocol != SCARD_PROTOCOL_T1))) {
            status = ATLAS_INVALID_PROTOCOL; diagnostics->failure_stage = ATLAS_STAGE_PROTOCOL;
        }
        if (!status && !atlas_is_ultralight_atr(atr, atrLength)) {
            status = ATLAS_UNSUPPORTED_ATR; diagnostics->failure_stage = ATLAS_STAGE_ATR;
        }
        atlas_clear(atr, sizeof(atr));
        atlas_clear(connectedReader, sizeof(connectedReader));
        if (!status) {
            // The only application APDU in this entire package. ACS manual READ BINARY,
            // page zero, sixteen bytes. No GET_VERSION until exact F8215 support is confirmed.
            static const uint8_t readHeader[] = {0xFF, 0xB0, 0x00, 0x00, 0x10};
            SCARD_IO_REQUEST pci = {protocol, sizeof(SCARD_IO_REQUEST)};
            uint32_t received = 18;
            // Means SCardTransmit was invoked, not that the tag received/completed the read.
            diagnostics->fixed_read_attempted = 1;
            status = SCardTransmit(card, &pci, readHeader, sizeof(readHeader), NULL, response, &received);
            if (status) diagnostics->failure_stage = ATLAS_STAGE_TRANSMIT;
            if (!status && received != 18) {
                status = ATLAS_INVALID_LENGTH; diagnostics->failure_stage = ATLAS_STAGE_RESPONSE;
            }
            if (!status) *length = received;
        }
        int32_t disconnected = SCardDisconnect(card, SCARD_LEAVE_CARD);
        if (!status && disconnected) {
            status = disconnected; diagnostics->failure_stage = ATLAS_STAGE_DISCONNECT;
        }
    }
    int32_t released = SCardReleaseContext(context);
    if (!status && released) { status = released; diagnostics->failure_stage = ATLAS_STAGE_RELEASE; }
    // Preserve the first failing operation even when cleanup also fails.
    if (status) { atlas_clear(response, 18); *length = 0; }
    return status;
}
