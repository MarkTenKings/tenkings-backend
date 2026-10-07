#include "CAtlasPCSC.h"
#include <PCSC/winscard.h>
#include <assert.h>
#include <stdio.h>
#include <string.h>
static int scenario, transmitted, disconnected, released;
int32_t SCardEstablishContext(uint32_t scope,const void *a,const void *b,LPSCARDCONTEXT context) {
    assert(scope==SCARD_SCOPE_USER && !a && !b); if(scenario==7)return SCARD_E_NO_SMARTCARD; *context=10; return 0;
}
int32_t SCardReleaseContext(SCARDCONTEXT context) { assert(context==10); released++; return (scenario==11 || scenario==13 || scenario==15 || scenario==26 || scenario==27)?SCARD_E_NO_SMARTCARD:0; }
int32_t SCardGetStatusChange(SCARDCONTEXT context,uint32_t timeout,LPSCARD_READERSTATE_A states,uint32_t count) {
    assert(context==10 && timeout==0 && count==2 && scenario>=17);
    assert(!strcmp(states[0].szReader,"candidate-a") && !strcmp(states[1].szReader,"candidate-b"));
    const uint8_t atr[]={0x3B,0x8F,0x80,0x01,0x80,0x4F,0x0C,0xA0,0,0,3,6,3,0,3,0,0,0,0,0x68};
    for(int i=0;i<2;i++){
        assert(states[i].dwCurrentState==SCARD_STATE_UNAWARE && !states[i].pvUserData);
        states[i].dwEventState=SCARD_STATE_EMPTY|SCARD_STATE_CHANGED;
    }
    int selected=scenario==18?1:0;
    states[selected].dwEventState=SCARD_STATE_PRESENT|SCARD_STATE_CHANGED;
    memcpy(states[selected].rgbAtr,atr,sizeof(atr));states[selected].cbAtr=sizeof(atr);
    if(scenario==19)states[0].dwEventState=SCARD_STATE_EMPTY;
    if(scenario==20)states[1].dwEventState=SCARD_STATE_PRESENT;
    if(scenario==21)states[0].rgbAtr[14]^=1;
    if(scenario==22)states[0].dwEventState|=SCARD_STATE_EXCLUSIVE;
    if(scenario==23)states[1].dwEventState|=SCARD_STATE_UNKNOWN;
    if(scenario==24)states[1].dwEventState|=SCARD_STATE_PRESENT;
    if(scenario==28)states[0].cbAtr=UINT32_MAX;
    return (scenario==25 || scenario==27)?SCARD_E_TIMEOUT:0;
}
int32_t SCardListReaders(SCARDCONTEXT context,const char *groups,char *out,uint32_t *length) {
    assert(context==10 && !groups); if(scenario==4)return SCARD_E_NO_READERS_AVAILABLE;
    if(scenario==5){*length=70000;return 0;}
    if(scenario==6){out[0]=0;*length=1;return 0;}
    const char list[]="ACS ACR1552U PICC 00\0"; assert(*length>=sizeof(list));
    memcpy(out,list,sizeof(list)); *length=sizeof(list); return 0;
}
int32_t SCardConnect(SCARDCONTEXT context,const char *reader,uint32_t share,uint32_t protocols,LPSCARDHANDLE card,uint32_t *protocol) {
    assert(context==10 && strcmp(reader,"ACS ACR1552U PICC 00")==0);
    assert(share==SCARD_SHARE_EXCLUSIVE && protocols==(SCARD_PROTOCOL_T0|SCARD_PROTOCOL_T1));
    if(scenario==1 || scenario==15)return SCARD_E_NO_SMARTCARD; *card=20;*protocol=SCARD_PROTOCOL_T1;return 0;
}
int32_t SCardStatus(SCARDHANDLE card,char *names,uint32_t *namesLength,uint32_t *state,uint32_t *protocol,unsigned char *atr,uint32_t *atrLength) {
    assert(card==20 && *atrLength>=20); (void)names;(void)namesLength;*state=0;*protocol=SCARD_PROTOCOL_T1;
    uint8_t valid[]={0x3B,0x8F,0x80,0x01,0x80,0x4F,0x0C,0xA0,0,0,3,6,3,0,3,0,0,0,0,0x68};
    memcpy(atr,valid,20);*atrLength=20;if(scenario==2 || scenario==16)atr[14]=1;
    if(scenario==14)*protocol=SCARD_PROTOCOL_T0;
    return (scenario==8 || scenario==12)?SCARD_E_NO_SMARTCARD:0;
}
int32_t SCardTransmit(SCARDHANDLE card,LPCSCARD_IO_REQUEST pci,const unsigned char *command,uint32_t commandLength,LPSCARD_IO_REQUEST recvPci,unsigned char *response,uint32_t *responseLength) {
    const uint8_t expected[]={0xFF,0xB0,0,0,0x10};
    assert(card==20 && pci->dwProtocol==SCARD_PROTOCOL_T1 && pci->cbPciLength==sizeof(SCARD_IO_REQUEST));
    assert(!recvPci && commandLength==sizeof(expected) && !memcmp(command,expected,sizeof(expected)));
    assert(*responseLength==18); transmitted++;memset(response,0xaa,18);
    if(scenario==9 || scenario==13)return SCARD_E_NO_SMARTCARD;
    if(scenario==3){*responseLength=2;return 0;}*responseLength=18;return 0;
}
int32_t SCardDisconnect(SCARDHANDLE card,uint32_t disposition) {
    assert(card==20 && disposition==SCARD_LEAVE_CARD);disconnected++;return (scenario==10 || scenario==12 || scenario==16)?SCARD_E_NO_SMARTCARD:0;
}
int main(void) {
    const uint32_t expectedStage[]={ATLAS_STAGE_NONE,ATLAS_STAGE_CONNECT,ATLAS_STAGE_ATR,
        ATLAS_STAGE_RESPONSE,0,0,0,ATLAS_STAGE_CONTEXT,ATLAS_STAGE_STATUS,ATLAS_STAGE_TRANSMIT,
        ATLAS_STAGE_DISCONNECT,ATLAS_STAGE_RELEASE,ATLAS_STAGE_STATUS,ATLAS_STAGE_TRANSMIT,
        ATLAS_STAGE_PROTOCOL,ATLAS_STAGE_CONNECT,ATLAS_STAGE_ATR};
    for(scenario=0;scenario<17;scenario++){
        if(scenario>=4 && scenario<=6)continue;
        transmitted=disconnected=released=0;uint8_t response[18];memset(response,0xbb,18);uint32_t length=99;
        AtlasInspectionDiagnostics diagnostics={99,99};
        int32_t result=atlas_read_type2_header("ACS ACR1552U PICC 00",response,&length,&diagnostics);
        assert(released==(scenario==7?0:1));
        assert(disconnected==((scenario==1 || scenario==7 || scenario==15)?0:1));
        const int expectedRead=(scenario==0 || scenario==3 || scenario==9 || scenario==10 || scenario==11 || scenario==13);
        assert(transmitted==expectedRead && diagnostics.fixed_read_attempted==expectedRead);
        assert(diagnostics.failure_stage==expectedStage[scenario]);
        if(scenario==0){assert(result==0 && length==18);}else{
            assert(result!=0 && length==0);for(int i=0;i<18;i++)assert(response[i]==0);
        }
    }
    for(scenario=4;scenario<7;scenario++){
        char names[4096];uint32_t length=99;released=0;
        int32_t result=atlas_list_readers(names,sizeof(names),&length);
        assert(released==1 && length==0);assert(scenario==5?result==ATLAS_INVALID_LENGTH:result==0);
    }
    const int32_t resolverStatus[]={0,0,SCARD_E_NO_SMARTCARD,ATLAS_AMBIGUOUS_INTERFACE,
        ATLAS_UNSUPPORTED_ATR,SCARD_E_SHARING_VIOLATION,SCARD_E_READER_UNAVAILABLE,
        ATLAS_AMBIGUOUS_INTERFACE,SCARD_E_TIMEOUT,SCARD_E_NO_SMARTCARD,SCARD_E_TIMEOUT,
        ATLAS_UNSUPPORTED_ATR};
    for(scenario=17;scenario<29;scenario++){
        transmitted=disconnected=released=0;uint32_t selected=99;
        int32_t result=atlas_resolve_present_type2("candidate-a","candidate-b",&selected);
        assert(result==resolverStatus[scenario-17]);
        assert(released==1 && transmitted==0 && disconnected==0);
        assert(selected==(scenario==17?0:scenario==18?1:UINT32_MAX));
    }
    puts("{\"test\":\"native_fixed_command_and_cleanup\",\"ok\":true,\"scenarios\":29}");
    return 0;
}
