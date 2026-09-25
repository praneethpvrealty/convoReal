import { Directory, Paths } from 'expo-file-system';

export function mediaCacheDir(): Directory {
  const dir = new Directory(Paths.cache, 'whatsapp-media');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

export function clearMediaCache(): void {
  const dir = new Directory(Paths.cache, 'whatsapp-media');
  if (dir.exists) dir.delete();
}
