// Runs the open-source Kokoro voice natively with Apple's MLX framework.
// While the app is open it uses the graphics chip (fast); when the screen is locked iOS doesn't
// allow graphics-chip work, so it switches to the main processor and keeps going.
import Foundation
import KokoroSwift
import MLX
import MLXUtilsLibrary
import UIKit

final class VoiceEngine {
  struct Job {
    let id: Int
    let text: String
    let voice: String
  }

  private let work = DispatchQueue(label: "earshot.voice", qos: .userInitiated)
  private let lock = NSLock()
  private var pending: [Job] = []
  private var running = false
  private var foreground = true
  private var tts: KokoroTTS?
  private var voices: [String: MLXArray] = [:]
  private let send: ([String: Any]) -> Void

  init(send: @escaping ([String: Any]) -> Void) {
    self.send = send
    let center = NotificationCenter.default
    center.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
      self?.setForeground(false)
    }
    center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
      self?.setForeground(true)
    }
    Memory.cacheLimit = 256 * 1024 * 1024
  }

  private func setForeground(_ value: Bool) {
    lock.lock(); foreground = value; lock.unlock()
  }

  private var isForeground: Bool {
    lock.lock(); defer { lock.unlock() }
    return foreground
  }

  private func log(_ text: String) {
    send(["type": "log", "msg": text])
  }

  func load() {
    work.async { [self] in
      if tts != nil {
        send(["type": "ready", "device": "native", "threads": "native", "ms": 0])
        return
      }
      let started = Date()
      func resource(_ name: String, _ ext: String) -> URL? {
        Bundle.main.url(forResource: name, withExtension: ext, subdirectory: "Model")
          ?? Bundle.main.url(forResource: name, withExtension: ext)
      }
      guard let model = resource("kokoro-v1_0", "safetensors"),
            let voiceFile = resource("voices", "npz")
      else {
        send(["type": "fail", "message": "The voice files are missing from the app. Reinstall Earshot."])
        return
      }
      log("native voice engine (MLX): loading the model")
      send(["type": "stage", "stage": "starting"])
      tts = KokoroTTS(modelPath: model)
      voices = NpyzReader.read(fileFromPath: voiceFile) ?? [:]
      log("model loaded, \(voices.count) voices")
      send(["type": "stage", "stage": "testing"])
      do {
        let (audio, seconds) = try generate("Ready.", voice: "bf_emma")
        log(String(format: "test sentence: %.1fs of audio in %.2fs", Double(audio.count) / 24000, seconds))
      } catch {
        send(["type": "fail", "message": "The voice test failed: \(error.localizedDescription)"])
        return
      }
      send(["type": "ready", "device": "native", "threads": "native", "ms": Int(Date().timeIntervalSince(started) * 1000)])
    }
  }

  func enqueue(_ job: Job) {
    lock.lock()
    pending.append(job)
    let start = !running
    if start { running = true }
    lock.unlock()
    if start { work.async { [self] in pump() } }
  }

  func cancel() {
    lock.lock(); pending.removeAll(); lock.unlock()
  }

  private func nextJob() -> Job? {
    lock.lock(); defer { lock.unlock() }
    if pending.isEmpty { running = false; return nil }
    return pending.removeFirst()
  }

  private func pump() {
    while let job = nextJob() {
      do {
        let (audio, seconds) = try generate(job.text, voice: job.voice)
        var pcm = [Int16](repeating: 0, count: audio.count)
        for i in 0 ..< audio.count {
          let s = max(-1, min(1, audio[i]))
          pcm[i] = Int16(s < 0 ? s * 32768 : s * 32767)
        }
        let data = pcm.withUnsafeBufferPointer { Data(buffer: $0) }
        send(["type": "pcm", "id": job.id, "b64": data.base64EncodedString(), "rate": 24000, "ms": Int(seconds * 1000)])
      } catch {
        send(["type": "error", "id": job.id, "message": error.localizedDescription])
      }
    }
  }

  private func generate(_ text: String, voice: String) throws -> ([Float], Double) {
    guard let tts else { throw NSError(domain: "Earshot", code: 1, userInfo: [NSLocalizedDescriptionKey: "The voice isn't loaded yet."]) }
    guard let style = voices[voice + ".npy"] ?? voices[voice] else {
      throw NSError(domain: "Earshot", code: 2, userInfo: [NSLocalizedDescriptionKey: "Unknown voice \(voice)."])
    }
    let language: KokoroSwift.Language = voice.hasPrefix("a") ? .enUS : .enGB
    let device: Device = isForeground ? .gpu : .cpu
    let started = Date()
    let (audio, _) = try withError {
      try Device.withDefaultDevice(device) {
        try tts.generateAudio(voice: style, language: language, text: text)
      }
    }
    return (audio, Date().timeIntervalSince(started))
  }
}
