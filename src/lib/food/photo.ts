// Food photos (#51): take or choose a photo, read its text on the device, then delete the copy. Nothing is
// uploaded, so there is no server copy to retain or delete. iOS only (Apple Vision); elsewhere the scan buttons
// are hidden and food is entered by search or as a custom food.
import { requireOptionalNativeModule } from 'expo';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';

import { toLines, type ScanLine, type TextBox } from './scan';

type Recognizer = { recognize: (uri: string) => Promise<TextBox[]> };
const recognizer = requireOptionalNativeModule<Recognizer>('LeaderboardTextRecognizer');

export const photoScanAvailable = () => recognizer != null;

export const MAX_PHOTO_BYTES = 20 * 1024 * 1024;

export class PhotoError extends Error {}

// The picked photo's local uri, or null when the person cancels. The picker copies the photo into this app's
// cache, so the original in the photo library is never changed.
export async function pickPhoto(source: 'camera' | 'library'): Promise<string | null> {
  if (source === 'camera') {
    const { granted } = await ImagePicker.requestCameraPermissionsAsync();
    if (!granted) throw new PhotoError('Allow camera access in Settings, or choose a photo instead.');
  }
  // No picker crop: on iOS it is always square, which cuts off tall labels.
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8, exif: false };
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  if (asset.fileSize != null && asset.fileSize > MAX_PHOTO_BYTES) {
    deletePhoto(asset.uri);
    throw new PhotoError('That photo is too large. Use one under 20 MB, or crop it.');
  }
  return asset.uri;
}

// Reads the text and always deletes the cached copy, whether reading worked or not.
export async function readPhoto(uri: string): Promise<ScanLine[]> {
  try {
    if (!recognizer) throw new PhotoError('Reading photos is not available on this device.');
    const boxes = await recognizer.recognize(uri).catch(() => {
      throw new PhotoError("Couldn't read that photo. Try again with a sharper, well-lit photo.");
    });
    return toLines(boxes);
  } finally {
    deletePhoto(uri);
  }
}

export function deletePhoto(uri: string) {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Already gone. The OS also clears the cache folder.
  }
}
