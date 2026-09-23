#include "CAtlasNFCCompanion.h"
#include <assert.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>
int main(void) {
    char path[]="/tmp/atlas-companion-full-sync-XXXXXX"; int fd=mkstemp(path); assert(fd>=3);
    assert(!fchmod(fd,0600)); assert(write(fd,"fixture",7)==7); assert(!atlas_companion_full_sync(fd));
    assert(atlas_companion_full_sync(1)); assert(!fchmod(fd,0644)); assert(atlas_companion_full_sync(fd));
    close(fd); unlink(path);
    pid_t child=fork(); assert(child>=0);
    if(!child) { assert(!atlas_companion_start_watchdog()); assert(!atlas_companion_deadline(50)); for(;;) pause(); }
    int status=0; assert(waitpid(child,&status,0)==child && WIFEXITED(status) && WEXITSTATUS(status)==124);
    puts("{\"test\":\"native_companion_fullsync_deadline\",\"ok\":true,\"scenarios\":4}"); return 0;
}
