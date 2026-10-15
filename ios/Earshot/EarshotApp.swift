// Earshot for iPhone: the Earshot reader, with the Kokoro AI voice running natively (MLX).
import AVFoundation
import SwiftUI

@main
struct EarshotApp: App {
  init() {
    // "Playback" lets reading continue with the screen locked or the silent switch on.
    let session = AVAudioSession.sharedInstance()
    try? session.setCategory(.playback, mode: .spokenAudio, options: [])
    try? session.setActive(true)
  }

  var body: some Scene {
    WindowGroup {
      ReaderView()
        .ignoresSafeArea()
        .background(Color(uiColor: .systemBackground))
    }
  }
}
