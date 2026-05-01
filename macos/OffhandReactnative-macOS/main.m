#import <Cocoa/Cocoa.h>
#import <string.h>
#import "SherpaHelper.h"

int main(int argc, const char *argv[]) {
  // When the parent app re-execs us with `--sherpa-helper`, run the
  // out-of-process Sherpa transcription loop instead of booting the GUI.
  // All ONNX Runtime / sherpa-onnx memory then lives in this short-lived
  // child process and is fully reclaimed when the parent kills it.
  for (int i = 1; i < argc; i++) {
    if (argv[i] && strcmp(argv[i], "--sherpa-helper") == 0) {
      return sherpa_helper_main(argc, argv);
    }
  }
  return NSApplicationMain(argc, argv);
}
