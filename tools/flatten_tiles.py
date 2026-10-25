import sys

import numpy as np
from PIL import Image

SIGMA_FRACTION = 1 / 48


def blur(a, sigma):
    h, w = a.shape[:2]
    fy, fx = np.fft.fftfreq(h)[:, None], np.fft.fftfreq(w)[None, :]
    kernel = np.exp(-2 * (np.pi * sigma) ** 2 * (fx ** 2 + fy ** 2))
    if a.ndim == 3:
        kernel = kernel[..., None]
    return np.real(np.fft.ifft2(np.fft.fft2(a, axes=(0, 1)) * kernel, axes=(0, 1)))


for path in sys.argv[1:]:
    img = Image.open(path)
    a = np.asarray(img.convert("RGB"), dtype=float) / 255
    sigma = a.shape[1] * SIGMA_FRACTION
    if "_nor_" in path:
        xy = a[..., :2] * 2 - 1
        xy -= blur(xy, sigma) - xy.mean(axis=(0, 1))
        z = np.sqrt(np.clip(1 - (xy ** 2).sum(-1), 0, 1))
        out = np.dstack([(xy + 1) / 2, (z + 1) / 2])
    elif "_ao_" in path:
        out = a * (a.mean() / np.maximum(blur(a, sigma), 1e-3))
    else:
        out = a * (a.mean(axis=(0, 1)) / np.maximum(blur(a, sigma), 1e-3))
    Image.fromarray((np.clip(out, 0, 1) * 255).round().astype(np.uint8)).save(path, quality=95)
    print(f"flattened {path}")
