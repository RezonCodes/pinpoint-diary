// device.js - phone hardware: GPS and camera photos.

import { fitSize } from './utils.js';

/** Gets the current GPS position. Rejects with a friendly message. */
export function getPosition({ timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Location is not supported on this device.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy),
        }),
      (err) => {
        const messages = {
          1: 'Location permission was denied. You can allow it in your phone settings.',
          2: 'Your location could not be found. Try moving outside.',
          3: 'Finding your location took too long.',
        };
        reject(new Error(messages[err.code] || 'Could not get your location.'));
      },
      { enableHighAccuracy: true, timeout, maximumAge: 60000 },
    );
  });
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be opened as a picture.'));
    };
    img.src = url;
  });
}

function drawScaled(img, maxSize, quality) {
  const { width, height } = fitSize(img.naturalWidth, img.naturalHeight, maxSize);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(img, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Shrinks a camera photo before saving (phone photos can be 5-10 MB).
 * Returns a ~1280px photo and a ~320px thumbnail as JPEG data URLs.
 * Browsers apply the EXIF rotation automatically, so photos are the right way up.
 */
export async function processPhoto(file) {
  if (!file || !file.type.startsWith('image/')) throw new Error('Please choose a photo.');
  if (file.size > 25 * 1024 * 1024) throw new Error('That photo is too large (max 25 MB).');
  const img = await loadImage(file);
  return {
    photo: drawScaled(img, 1280, 0.8),
    thumb: drawScaled(img, 320, 0.7),
  };
}
