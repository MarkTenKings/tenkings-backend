#include "CAtlasPCSC.h"
#include <errno.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <sys/resource.h>
#include <time.h>
#include <unistd.h>

static atomic_int output_claimed = 0;
static atomic_int armed = 0;

_Noreturn void atlas_finish(const char *json, size_t length, int status) {
    if (atomic_exchange(&output_claimed, 1) == 0) {
        // The watchdog exits independently even if stdout is a blocked pipe.
        if (json && length <= 4096) (void)write(STDOUT_FILENO, json, length);
    }
    _exit(status);
}

static void *deadline(void *milliseconds) {
    uint32_t ms = (uint32_t)(uintptr_t)milliseconds;
    struct timespec remaining = {ms / 1000, (ms % 1000) * 1000000L};
    while (nanosleep(&remaining, &remaining) && errno == EINTR) {}
    // Do not write here: even diagnostic output can block. Exit 124 is the
    // timeout signal to the caller. Never change shared inherited stdout flags.
    _exit(124);
}

int atlas_start_deadline(uint32_t milliseconds) {
    if (milliseconds < 1 || milliseconds > 8000 || atomic_exchange(&armed, 1)) return -1;
    // A diagnostic crash must not persist tag buffers in a core dump.
    struct rlimit noCore = {0, 0};
    if (setrlimit(RLIMIT_CORE, &noCore)) return -1;
    pthread_t thread;
    if (pthread_create(&thread, NULL, deadline, (void *)(uintptr_t)milliseconds)) return -1;
    if (pthread_detach(thread)) return -1;
    return 0;
}
