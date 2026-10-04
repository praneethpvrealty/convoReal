export function compressImageOnClient(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      const maxW = 1200;
      let w = img.width;
      let h = img.height;

      if (w > maxW) {
        h = Math.round(h * (maxW / w));
        w = maxW;
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Compression failed'))),
        'image/jpeg',
        0.75
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image load failed'));
    };
    img.src = url;
  });
}
