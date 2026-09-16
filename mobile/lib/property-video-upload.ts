import { Upload } from 'tus-js-client';

export interface PropertyVideoUploadSession {
  endpoint: string;
  path: string;
  token: string;
  maxBytes: number;
}

interface NativeVideoFile {
  uri: string;
  name: string;
  type: string;
  size?: number;
}

export function uploadPropertyVideoResumable(
  file: NativeVideoFile,
  session: PropertyVideoUploadSession,
  onProgress?: (percentage: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const upload = new Upload(file as unknown as File, {
      endpoint: session.endpoint,
      retryDelays: [0, 3_000, 5_000, 10_000, 20_000],
      headers: { 'x-signature': session.token },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: 6 * 1024 * 1024,
      metadata: {
        bucketName: 'property-videos',
        objectName: session.path,
        contentType: 'video/mp4',
        cacheControl: '3600',
      },
      onError: reject,
      onProgress: (uploaded, total) => {
        onProgress?.(total > 0 ? Math.round((uploaded / total) * 100) : 0);
      },
      onSuccess: () => resolve(),
    });

    void upload.findPreviousUploads().then((previous) => {
      if (previous[0]) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    }, reject);
  });
}
