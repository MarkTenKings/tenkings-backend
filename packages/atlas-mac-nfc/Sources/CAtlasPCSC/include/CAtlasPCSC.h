#ifndef ATLAS_PCSC_H
#define ATLAS_PCSC_H
#include <stddef.h>
#include <stdint.h>
void atlas_clear(void *buffer, size_t length);
// No arbitrary command, UID, control, authentication, write, reset or lock API.
int32_t atlas_list_readers(char *buffer, uint32_t capacity, uint32_t *length);
// Presence snapshot only: no connection or command to either candidate.
int32_t atlas_resolve_present_type2(const char *first, const char *second, uint32_t *selected);
typedef enum {
    ATLAS_STAGE_NONE = 0,
    ATLAS_STAGE_INPUT = 1,
    ATLAS_STAGE_CONTEXT = 2,
    ATLAS_STAGE_CONNECT = 3,
    ATLAS_STAGE_STATUS = 4,
    ATLAS_STAGE_PROTOCOL = 5,
    ATLAS_STAGE_ATR = 6,
    ATLAS_STAGE_TRANSMIT = 7,
    ATLAS_STAGE_RESPONSE = 8,
    ATLAS_STAGE_DISCONNECT = 9,
    ATLAS_STAGE_RELEASE = 10
} AtlasInspectionStage;
typedef struct {
    uint32_t failure_stage;
    uint8_t fixed_read_attempted;
} AtlasInspectionDiagnostics;
int32_t atlas_read_type2_header(const char *reader, uint8_t response[18], uint32_t *length,
                               AtlasInspectionDiagnostics *diagnostics);
int atlas_is_ultralight_atr(const uint8_t *atr, size_t length);
// Process-wide watchdog must be started before any PC/SC call. This is an executable API.
int atlas_start_deadline(uint32_t milliseconds);
_Noreturn void atlas_finish(const char *json, size_t length, int status);
#define ATLAS_UNSUPPORTED_ATR ((int32_t)0xA7100001)
#define ATLAS_INVALID_LENGTH ((int32_t)0xA7100002)
#define ATLAS_INVALID_PROTOCOL ((int32_t)0xA7100003)
#define ATLAS_AMBIGUOUS_INTERFACE ((int32_t)0xA7100004)
#endif
