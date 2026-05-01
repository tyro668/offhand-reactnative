#pragma once

#ifdef __cplusplus
extern "C" {
#endif

// Entry point for the out-of-process Sherpa transcription helper.
//
// The Offhand app re-execs its own bundled binary with a `--sherpa-helper`
// argument so that all sherpa-onnx + ONNX Runtime memory lives in a
// short-lived child process. When the parent kills the child (idle timeout)
// every byte allocated by the runtime is returned to the kernel, which is
// not reliably possible in-process because dlclose() and ONNX Runtime's
// global state effectively never let the dylib unload.
//
// Returns a process exit code.
int sherpa_helper_main(int argc, const char **argv);

#ifdef __cplusplus
}
#endif
