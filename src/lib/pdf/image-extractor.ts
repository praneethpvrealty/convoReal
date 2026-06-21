/**
 * Scans a PDF buffer to extract embedded JPEGs (DCTDecode streams).
 * Filters out images smaller than 20 KB (to avoid tiny logos or spacer graphics).
 */
export async function extractImagesFromPdf(pdfBuffer: Buffer): Promise<Buffer[]> {
  const images: Buffer[] = [];
  let pos = 0;
  const minSize = 20000; // 20 KB

  while (true) {
    const index = pdfBuffer.indexOf('/DCTDecode', pos);
    if (index === -1) break;

    const streamStartIdx = pdfBuffer.indexOf('stream', index);
    if (streamStartIdx === -1) {
      pos = index + 10;
      continue;
    }

    // Determine the start of the binary stream (after 'stream\r\n' or 'stream\n')
    let binaryStart = streamStartIdx + 6;
    if (pdfBuffer[binaryStart] === 13) binaryStart++; // \r
    if (pdfBuffer[binaryStart] === 10) binaryStart++; // \n

    const streamEndIdx = pdfBuffer.indexOf('endstream', binaryStart);
    if (streamEndIdx === -1) {
      pos = index + 10;
      continue;
    }

    const streamBytes = pdfBuffer.slice(binaryStart, streamEndIdx);

    // Verify JPEG SOI (Start Of Image) marker: 0xFFD8
    const isJpeg = streamBytes[0] === 0xFF && streamBytes[1] === 0xD8;
    if (isJpeg && streamBytes.length >= minSize) {
      images.push(streamBytes);
    }

    pos = streamEndIdx + 9;
  }

  return images;
}
