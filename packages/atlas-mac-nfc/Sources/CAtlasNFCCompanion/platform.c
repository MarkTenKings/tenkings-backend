#include "CAtlasNFCCompanion.h"
#include <stdatomic.h>
#include <pthread.h>
#include <unistd.h>
#include <time.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <fcntl.h>
static atomic_ullong deadline_ns = 0;
static atomic_int started = 0;
static unsigned long long monotonic_ns(void) {
    struct timespec now; if (clock_gettime(CLOCK_MONOTONIC, &now)) _exit(125);
    return (unsigned long long)now.tv_sec * 1000000000ULL + now.tv_nsec;
}
static void *watchdog(void *unused) {
    (void)unused;
    for (;;) { struct timespec pause = {0, 10000000}; nanosleep(&pause, NULL);
        const unsigned long long until = atomic_load(&deadline_ns); if (until && monotonic_ns() >= until) _exit(124); }
}
int atlas_companion_deadline(uint32_t milliseconds) {
    if (!atomic_load(&started) || milliseconds < 1 || milliseconds > 900000) return -1;
    atomic_store(&deadline_ns, monotonic_ns() + (unsigned long long)milliseconds * 1000000ULL); return 0;
}
int atlas_companion_start_watchdog(void) {
    if (atomic_exchange(&started, 1)) return -1;
    struct rlimit core = {0, 0}; if (setrlimit(RLIMIT_CORE, &core)) return -1;
    if (atlas_companion_deadline(30000)) return -1;
    pthread_t thread; if (pthread_create(&thread, NULL, watchdog, NULL) || pthread_detach(thread)) return -1; return 0;
}
int atlas_companion_full_sync(int descriptor) {
    struct stat info;
    if (descriptor < 3 || descriptor > 255 || fstat(descriptor, &info) || !S_ISREG(info.st_mode)
        || info.st_uid != getuid() || (info.st_mode & 0077) || fsync(descriptor)) return -1;
    return fcntl(descriptor, F_FULLFSYNC);
}
