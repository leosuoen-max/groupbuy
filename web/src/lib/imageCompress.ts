/**
 * 付款截图 / 凭证上传前压缩，减轻移动端上行带宽与 Storage 耗时。
 * 不可解码（如部分 HEIC）或非图片时原样返回。
 */
const SOFT_SIZE_BYTES = 750 * 1024;
const MAX_EDGE_PX = 2048;
const JPEG_QUALITY = 0.82;

export async function compressImageFileForUpload(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  if (file.size <= SOFT_SIZE_BYTES) return file;

  try {
    const bitmap = await createImageBitmap(file);
    try {
      let w = bitmap.width;
      let h = bitmap.height;
      if (w > MAX_EDGE_PX || h > MAX_EDGE_PX) {
        const scale = Math.min(MAX_EDGE_PX / w, MAX_EDGE_PX / h);
        w = Math.max(1, Math.round(w * scale));
        h = Math.max(1, Math.round(h * scale));
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return file;
      ctx.drawImage(bitmap, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/jpeg', JPEG_QUALITY)
      );
      if (!blob) return file;
      if (blob.size >= file.size) return file;
      const base =
        file.name.replace(/\.[^/.]+$/, '').trim() || 'payment';
      return new File([blob], `${base}.jpg`, {
        type: 'image/jpeg',
        lastModified: Date.now(),
      });
    } finally {
      bitmap.close();
    }
  } catch {
    return file;
  }
}
