package expo.modules.leaderboardtextrecognizer

import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Reads text from a local photo with ML Kit, on the device. The photo is never uploaded.
// Same shape as the Apple module: one item per recognized line (Vision observations are lines too) with its
// text, confidence and box in top-left coordinates (0 to 1). fromFilePath applies the photo's EXIF rotation,
// so boxes are in the upright image, like Vision given the UIImage orientation.
class LeaderboardTextRecognizerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LeaderboardTextRecognizer")

    AsyncFunction("recognize") { uri: String, promise: Promise ->
      val image = try {
        InputImage.fromFilePath(requireNotNull(appContext.reactContext), Uri.parse(uri))
      } catch (e: Exception) {
        promise.reject("BAD_IMAGE", "Could not open that photo.", e)
        return@AsyncFunction
      }
      // ML Kit boxes are in pixels of the upright image. Swap width and height if a rotation is still pending.
      val turned = image.rotationDegrees % 180 != 0
      val width = (if (turned) image.height else image.width).toDouble()
      val height = (if (turned) image.width else image.height).toDouble()
      val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
      recognizer.process(image)
        .addOnSuccessListener { text ->
          val boxes = text.textBlocks.flatMap { it.lines }.mapNotNull { line ->
            val box = line.boundingBox ?: return@mapNotNull null
            mapOf(
              "text" to line.text,
              "confidence" to line.confidence.toDouble(),
              "x" to box.left / width,
              "y" to box.top / height,
              "width" to box.width() / width,
              "height" to box.height() / height
            )
          }
          promise.resolve(boxes)
        }
        .addOnFailureListener { e -> promise.reject("OCR_FAILED", e.localizedMessage, e) }
        .addOnCompleteListener { recognizer.close() }
    }
  }
}
