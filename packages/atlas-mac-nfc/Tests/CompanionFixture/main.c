#include "CAtlasNFCCompanion.h"
#include <PCSC/winscard.h>
#include <assert.h>
#include <stdio.h>
#include <string.h>

enum { OK, CONTEXT_FAIL, CONNECT_FAIL, ATR_BAD, PROTOCOL_BAD, HEADER_SHORT, OCCUPIED,
       SWAP_PREFLIGHT, SWAP_PARTIAL, WRITE_LOST, WRITE_SHORT, READBACK_BAD, FINAL_GUARD_BAD,
       DISCONNECT_FAIL, RELEASE_FAIL, SCENARIOS };
static int scenario, connects, releases, disconnects, reads, writes, headers, present, removed;
static uint8_t memory[256], plan[80], atr[] = {0x3b,0x8f,0x80,1,0x80,0x4f,0x0c,0xa0,0,0,3,6,3,0,3,0,0,0,0,0x68};
static const uint32_t length = 80;
int32_t SCardEstablishContext(uint32_t scope, const void *a, const void *b, LPSCARDCONTEXT out) {
    assert(scope == SCARD_SCOPE_USER && !a && !b); if (scenario == CONTEXT_FAIL) return SCARD_E_NO_SERVICE; *out = 10; return 0;
}
int32_t SCardReleaseContext(SCARDCONTEXT context) { assert(context == 10); releases++; return scenario == RELEASE_FAIL ? SCARD_E_NO_SERVICE : 0; }
int32_t SCardListReaders(SCARDCONTEXT c, const char *g, char *o, uint32_t *l) { (void)c;(void)g;(void)o;(void)l; assert(0); return -1; }
int32_t SCardConnect(SCARDCONTEXT c, const char *reader, uint32_t share, uint32_t protocols, LPSCARDHANDLE card, uint32_t *protocol) {
    assert(c == 10 && !strcmp(reader,"ACS ACR1552 1S CL Reader(1)") && share == SCARD_SHARE_EXCLUSIVE);
    assert(protocols == (SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1)); connects++;
    if (scenario == CONNECT_FAIL) return SCARD_E_NO_SMARTCARD; *card = 20; *protocol = SCARD_PROTOCOL_T1; return 0;
}
int32_t SCardStatus(SCARDHANDLE card, char *names, uint32_t *names_length, uint32_t *state, uint32_t *protocol, unsigned char *out, uint32_t *size) {
    assert(card == 20 && *size >= sizeof(atr)); (void)names;(void)names_length; *state = SCARD_PRESENT;
    memcpy(out,atr,sizeof(atr)); *size = sizeof(atr); if(scenario == ATR_BAD) out[14] ^= 1;
    *protocol = scenario == PROTOCOL_BAD ? SCARD_PROTOCOL_T0 : SCARD_PROTOCOL_T1; return 0;
}
int32_t SCardDisconnect(SCARDHANDLE card, uint32_t disposition) { assert(card == 20 && disposition == SCARD_LEAVE_CARD); disconnects++; return scenario == DISCONNECT_FAIL ? SCARD_E_NO_SMARTCARD : 0; }
int32_t SCardTransmit(SCARDHANDLE card, LPCSCARD_IO_REQUEST pci, const unsigned char *command, uint32_t size,
                      LPSCARD_IO_REQUEST receive, unsigned char *out, uint32_t *out_size) {
    assert(card == 20 && pci->dwProtocol == SCARD_PROTOCOL_T1 && !receive && command[0] == 0xff && command[2] == 0);
    uint32_t page = command[3];
    if (command[1] == 0xb0) {
        assert(size == 5 && command[4] == 16 && *out_size == 18 && page + 3 <= 63); reads++;
        memcpy(out,memory + page * 4,16); out[16] = 0x90; out[17] = 0; *out_size = 18;
        if (!page) {
            headers++;
            if (scenario == HEADER_SHORT && headers == 1) *out_size = 2;
            if ((scenario == SWAP_PREFLIGHT && headers == 2) || (scenario == SWAP_PARTIAL && writes)) out[1] ^= 1;
        } else if (scenario == READBACK_BAD && writes) out[0] ^= 1;
        return 0;
    }
    assert(command[1] == 0xd6 && size == 9 && command[4] == 4 && *out_size == 2);
    assert(page >= 4 && page < 4 + length / 4 && !memcmp(command + 5, plan + (page - 4) * 4, 4));
    assert(page == 4 ? writes == (int)length / 4 - 1 : page == (uint32_t)writes + 5);
    writes++; memcpy(memory + page * 4,command + 5,4); out[0] = 0x90; out[1] = 0; *out_size = 2;
    if (scenario == WRITE_LOST) return SCARD_E_TIMEOUT;
    if (scenario == WRITE_SHORT) *out_size = 1;
    if (scenario == FINAL_GUARD_BAD && page == 4) memory[16 + length + 8] ^= 1;
    return 0;
}
int32_t SCardGetStatusChange(SCARDCONTEXT c, uint32_t timeout, LPSCARD_READERSTATE_A states, uint32_t count) {
    assert(c == 10 && timeout <= 5000 && (count == 1 || count == 2));
    for (uint32_t i = 0; i < count; i++) {
        states[i].dwEventState = count == 1 ? (removed ? SCARD_STATE_EMPTY : SCARD_STATE_PRESENT) :
            (present == 2 || (present == 1 && i == 0) ? SCARD_STATE_PRESENT : SCARD_STATE_EMPTY);
        memcpy(states[i].rgbAtr,atr,sizeof(atr)); states[i].cbAtr = sizeof(atr);
        if (present == 3) states[i].dwEventState |= SCARD_STATE_UNKNOWN;
    }
    return 0;
}
static void reset(void) {
    connects = releases = disconnects = reads = writes = headers = present = removed = 0;
    memset(memory,0,sizeof(memory)); memory[0] = 0x1d; memory[1] = 0x11; memory[12] = 0xe1;
    memory[16] = 3; memory[18] = 0xfe; if (scenario == OCCUPIED) memory[30] = 1;
}
int main(void) {
    // Synthetic bytes model a signed source-bound dynamic URL. No hardware framework
    // is linked: every PC/SC symbol above is an in-process fixture.
    memset(plan,0,sizeof(plan)); plan[0]=3; plan[1]=74; plan[2]=0xd1; plan[3]=1; plan[4]=70; plan[5]=0x55; plan[6]=4;
    memset(plan+7,'x',69); plan[76]=0xfe;
    for (scenario=0; scenario<SCENARIOS; scenario++) {
        reset(); AtlasCompanionSession *session = NULL;
        int32_t status = atlas_companion_open("ACS ACR1552 1S CL Reader(1)",4,63,plan,length,&session);
        const int opens = scenario == OK || scenario >= SWAP_PARTIAL;
        assert((status == 0) == opens);
        if (session) {
            uint8_t out[16]; int before = reads;
            assert(atlas_companion_read16(session,3,out) != 0 && atlas_companion_read16(session,61,out) != 0 && reads == before);
            assert(atlas_companion_write4(session,4,plan) == ATLAS_COMPANION_ORDER && !writes);
            uint8_t wrong[4]={0}; assert(atlas_companion_write4(session,5,wrong) == ATLAS_COMPANION_ORDER && !writes);
            for (uint32_t step=1; !status && step<=length/4; step++) {
                uint32_t index = step == length/4 ? 0 : step;
                status = atlas_companion_write4(session,4+index,plan+index*4);
            }
            const int verified = scenario == OK || scenario == DISCONNECT_FAIL || scenario == RELEASE_FAIL;
            assert((atlas_companion_readback_verified(session) != 0) == verified);
            int previous = writes; assert(atlas_companion_write4(session,5,plan+4) != 0 && writes == previous);
            uint32_t found = 0; assert(!atlas_companion_wait_removed(session,0,&found) && !found);
            removed=1; assert(!atlas_companion_wait_removed(session,10,&found) && found);
            (void)atlas_companion_close(session);
        }
        assert(disconnects == (scenario == CONTEXT_FAIL || scenario == CONNECT_FAIL ? 0 : 1));
        assert(releases == (scenario == CONTEXT_FAIL ? 0 : 1));
        assert(writes <= (int)length/4);
        if (scenario == OK) assert(!memcmp(memory+16,plan,length));
        assert(memory[0] == 0x1d && memory[1] == 0x11 && memory[12] == 0xe1);
    }
    scenario=OK; reset(); AtlasCompanionSession *session=NULL;
    assert(atlas_companion_open("other",4,63,plan,length,&session) && !connects);
    assert(atlas_companion_open("ACS ACR1552 1S CL Reader(1)",4,20,plan,length,&session) && !connects);
    uint32_t state=0, selected=0; assert(!atlas_companion_presence(0,&state,&selected) && state==0 && selected==UINT32_MAX);
    present=1; assert(!atlas_companion_presence(0,&state,&selected) && state==1 && selected==0);
    present=2; assert(atlas_companion_presence(0,&state,&selected)); present=3; assert(atlas_companion_presence(0,&state,&selected));
    printf("{\"test\":\"native_companion_pcsc_fixture\",\"ok\":true,\"scenarios\":%d}\n",SCENARIOS+6);
    return 0;
}
