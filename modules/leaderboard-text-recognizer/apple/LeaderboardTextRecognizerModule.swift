import ExpoModulesCore
import UIKit
import Vision

// Reads text from a local photo with Apple Vision, on the device. The photo is never uploaded.
// Returns one item per recognized text box: its text, confidence and box in top-left coordinates (0 to 1).
public class LeaderboardTextRecognizerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LeaderboardTextRecognizer")
    AsyncFunction("recognize") { (uri: String, promise: Promise) in
      guard let url = URL(string: uri), let image = UIImage(contentsOfFile: url.path), let cgImage = image.cgImage else {
        promise.reject("BAD_IMAGE", "Could not open that photo.")
        return
      }
      let request = VNRecognizeTextRequest { request, error in
        if let error = error {
          promise.reject("OCR_FAILED", error.localizedDescription)
          return
        }
        let boxes = (request.results as? [VNRecognizedTextObservation] ?? []).compactMap { observation -> [String: Any]? in
          guard let best = observation.topCandidates(1).first else { return nil }
          let box = observation.boundingBox
          return ["text": best.string, "confidence": Double(best.confidence), "x": box.minX, "y": 1 - box.maxY, "width": box.width, "height": box.height]
        }
        promise.resolve(boxes)
      }
      request.recognitionLevel = .accurate
      // Language correction rewrites numbers and units, so it stays off for labels.
      request.usesLanguageCorrection = false
      let handler = VNImageRequestHandler(cgImage: cgImage, orientation: CGImagePropertyOrientation(image.imageOrientation), options: [:])
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          try handler.perform([request])
        } catch {
          promise.reject("OCR_FAILED", error.localizedDescription)
        }
      }
    }
  }
}

private extension CGImagePropertyOrientation {
  init(_ orientation: UIImage.Orientation) {
    switch orientation {
    case .up: self = .up
    case .down: self = .down
    case .left: self = .left
    case .right: self = .right
    case .upMirrored: self = .upMirrored
    case .downMirrored: self = .downMirrored
    case .leftMirrored: self = .leftMirrored
    case .rightMirrored: self = .rightMirrored
    @unknown default: self = .up
    }
  }
}
