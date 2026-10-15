// Shows the Earshot web app and connects it to the native voice engine.
import SwiftUI
import UIKit
import WebKit

let earshotHome = URL(string: "https://wronski8248.github.io/earshot/")!

struct ReaderView: UIViewRepresentable {
  func makeCoordinator() -> Bridge { Bridge() }

  func makeUIView(context: Context) -> WKWebView {
    let config = WKWebViewConfiguration()
    // Needed for offline support (service workers) inside an app.
    config.limitsNavigationsToAppBoundDomains = true
    config.allowsInlineMediaPlayback = true
    config.mediaTypesRequiringUserActionForPlayback = []
    config.websiteDataStore = .default()

    let content = WKUserContentController()
    content.addUserScript(WKUserScript(
      source: "window.__EARSHOT_NATIVE__ = { version: 1, voice: 'kokoro-mlx' };",
      injectionTime: .atDocumentStart, forMainFrameOnly: true))
    content.add(context.coordinator, name: "earshot")
    config.userContentController = content

    let web = WKWebView(frame: .zero, configuration: config)
    web.scrollView.contentInsetAdjustmentBehavior = .never
    web.isOpaque = false
    web.backgroundColor = .systemBackground
    web.allowsBackForwardNavigationGestures = false
    if #available(iOS 16.4, *) { web.isInspectable = true }
    web.navigationDelegate = context.coordinator
    web.uiDelegate = context.coordinator
    context.coordinator.webView = web
    web.load(URLRequest(url: earshotHome))
    return web
  }

  func updateUIView(_ uiView: WKWebView, context: Context) {}
}

final class Bridge: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
  weak var webView: WKWebView?
  private lazy var voice = VoiceEngine { [weak self] message in self?.send(message) }

  // Messages from the page: load the voice, make audio, cancel, keep the screen awake.
  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else { return }
    switch cmd {
    case "load":
      voice.load()
    case "gen":
      let id = (body["id"] as? NSNumber)?.intValue ?? 0
      voice.enqueue(.init(id: id, text: body["text"] as? String ?? "", voice: body["voice"] as? String ?? "bf_emma"))
    case "cancel":
      voice.cancel()
    case "awake":
      UIApplication.shared.isIdleTimerDisabled = (body["on"] as? Bool) ?? false
    default:
      break
    }
  }

  // Replies to the page.
  func send(_ message: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: message),
          let json = String(data: data, encoding: .utf8) else { return }
    DispatchQueue.main.async { [weak self] in
      self?.webView?.evaluateJavaScript("window.__earshotNative && window.__earshotNative(\(json));", completionHandler: nil)
    }
  }

  // Links to other websites open in Safari.
  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    if let url = action.request.url, let host = url.host, host != earshotHome.host, action.navigationType == .linkActivated {
      UIApplication.shared.open(url)
      decisionHandler(.cancel)
      return
    }
    decisionHandler(.allow)
  }

  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = action.request.url { UIApplication.shared.open(url) }
    return nil
  }

  // First launch with no internet: explain and retry.
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    showRetry(webView, error)
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    showRetry(webView, error)
  }

  private func showRetry(_ webView: WKWebView, _ error: Error) {
    if (error as NSError).code == NSURLErrorCancelled { return }
    let alert = UIAlertController(
      title: "Can't open Earshot",
      message: "Earshot needs the internet the first time it opens. After that it also works offline.\n\n(\(error.localizedDescription))",
      preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "Try again", style: .default) { _ in webView.load(URLRequest(url: earshotHome)) })
    webView.window?.rootViewController?.present(alert, animated: true)
  }
}
