#include <Python.h>

static struct PyModuleDef speedster_compiler_probe = {
    PyModuleDef_HEAD_INIT,
    "speedster_compiler_probe",
    NULL,
    -1,
    NULL,
};

PyMODINIT_FUNC PyInit_speedster_compiler_probe(void) {
    return PyModule_Create(&speedster_compiler_probe);
}
