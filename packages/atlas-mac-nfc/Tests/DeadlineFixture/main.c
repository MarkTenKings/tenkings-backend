#include "CAtlasPCSC.h"
#include <unistd.h>
// Synthetic blocked external work; no PC/SC API call and no reader needed.
int main(int argc, char **argv) {
    if (atlas_start_deadline(100) != 0) return 70;
    (void)argv;
    if (argc > 1) atlas_finish("blocked\n", 8, 0);
    for (;;) pause();
}
