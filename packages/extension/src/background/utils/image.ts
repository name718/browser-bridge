/**
 * 使用 OffscreenCanvas 对图片进行缩放和压缩
 */
export async function processImage(
  dataUrl: string,
  options: { scale?: number; quality?: number; format?: "png" | "jpeg" }
): Promise<string> {
  const { scale = 1, quality = 0.8, format = "jpeg" } = options;
  if (scale === 1 && format === "png") return dataUrl;

  // 在 Service Worker 中使用 OffscreenCanvas
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;

  ctx.drawImage(bitmap, 0, 0, width, height);
  
  const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";
  const resultBlob = await canvas.convertToBlob({ type: mimeType, quality });
  
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(resultBlob);
  });
}
