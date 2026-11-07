import * as ImagePicker from 'expo-image-picker';

import { pickPhoto, PhotoError, readPhoto } from './photo';

const mockRecognize = jest.fn();
const mockDeleted: string[] = [];

jest.mock('expo', () => ({ requireOptionalNativeModule: () => ({ recognize: (uri: string) => mockRecognize(uri) }) }));
jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation((path: string) => ({ exists: true, delete: () => mockDeleted.push(path) })),
}));
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

const picker = ImagePicker as jest.Mocked<typeof ImagePicker>;

beforeEach(() => {
  mockDeleted.length = 0;
  jest.clearAllMocks();
});

describe('readPhoto', () => {
  it('returns lines and deletes the photo', async () => {
    mockRecognize.mockResolvedValue([{ text: 'Calories 100', confidence: 0.9, x: 0, y: 0, width: 0.5, height: 0.05 }]);
    await expect(readPhoto('file:///cache/a.jpg')).resolves.toEqual([{ text: 'Calories 100', confidence: 0.9 }]);
    expect(mockDeleted).toEqual(['file:///cache/a.jpg']);
  });

  it('deletes the photo when reading fails', async () => {
    mockRecognize.mockRejectedValue(new Error('vision'));
    await expect(readPhoto('file:///cache/b.jpg')).rejects.toBeInstanceOf(PhotoError);
    expect(mockDeleted).toEqual(['file:///cache/b.jpg']);
  });
});

describe('pickPhoto', () => {
  it('returns null when cancelled', async () => {
    picker.launchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: null });
    await expect(pickPhoto('library')).resolves.toBeNull();
  });

  it('refuses a photo over the size limit and deletes the copy', async () => {
    picker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///cache/big.jpg', fileSize: 30 * 1024 * 1024, width: 1, height: 1 }] });
    await expect(pickPhoto('library')).rejects.toThrow('too large');
    expect(mockDeleted).toEqual(['file:///cache/big.jpg']);
  });

  it('explains when camera access is denied and does not open the camera', async () => {
    picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: false } as ImagePicker.CameraPermissionResponse);
    await expect(pickPhoto('camera')).rejects.toThrow('camera access');
    expect(picker.launchCameraAsync).not.toHaveBeenCalled();
  });

  it('asks only for images, without location metadata', async () => {
    picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: true } as ImagePicker.CameraPermissionResponse);
    picker.launchCameraAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///cache/c.jpg', fileSize: 1000, width: 1, height: 1 }] });
    await expect(pickPhoto('camera')).resolves.toBe('file:///cache/c.jpg');
    expect(picker.launchCameraAsync).toHaveBeenCalledWith(expect.objectContaining({ mediaTypes: ['images'], exif: false }));
  });
});
