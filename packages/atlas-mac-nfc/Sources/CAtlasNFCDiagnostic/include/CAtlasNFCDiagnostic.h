#ifndef ATLAS_NFC_DIAGNOSTIC_H
#define ATLAS_NFC_DIAGNOSTIC_H
#include <stddef.h>
#include <stdint.h>

// This separate executable has one fixed diagnostic URI. It cannot encode jobs,
// accept user-supplied bytes/URLs/APDUs, write security pages or lock a tag.
const char *atlas_diagnostic_uri(void);
uint32_t atlas_diagnostic_plan(uint8_t *buffer, uint32_t capacity);
typedef int32_t (*AtlasDiagnosticJournal)(void *context, const char *event, uint32_t page);
typedef struct {
    uint32_t stage;
    uint32_t read_attempts;
    uint32_t write_attempts;
    uint8_t commit_attempted;
    uint8_t readback_verified;
} AtlasDiagnosticResult;
int32_t atlas_write_diagnostic(const char *reader, AtlasDiagnosticJournal journal,
                              void *journal_context, AtlasDiagnosticResult *result);
enum {
    ATLAS_DIAG_INPUT = 1, ATLAS_DIAG_CONTEXT, ATLAS_DIAG_CONNECT, ATLAS_DIAG_STATUS,
    ATLAS_DIAG_ATR, ATLAS_DIAG_HEADER, ATLAS_DIAG_PREFLIGHT_READ, ATLAS_DIAG_NOT_EMPTY,
    ATLAS_DIAG_JOURNAL, ATLAS_DIAG_IDENTITY, ATLAS_DIAG_WRITE,
    ATLAS_DIAG_PAGE_READBACK, ATLAS_DIAG_FINAL_READBACK,
    ATLAS_DIAG_DISCONNECT, ATLAS_DIAG_RELEASE
};
#define ATLAS_DIAG_REJECTED ((int32_t)0xA7200001)
#define ATLAS_DIAG_READBACK_MISMATCH ((int32_t)0xA7200002)
#define ATLAS_DIAG_JOURNAL_FAILED ((int32_t)0xA7200003)
#endif
