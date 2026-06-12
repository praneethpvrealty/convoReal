import { MetadataRoute } from 'next';

interface ExtendedManifest extends MetadataRoute.Manifest {
  share_target?: {
    action: string;
    method?: 'get' | 'post' | 'GET' | 'POST';
    enctype?: 'application/x-www-form-urlencoded' | 'multipart/form-data';
    params: {
      title?: string;
      text?: string;
      url?: string;
    };
  };
}

export default function manifest(): MetadataRoute.Manifest {
  const manifestObj: ExtendedManifest = {
    name: 'waCRM',
    short_name: 'waCRM',
    description: 'WhatsApp CRM for Real Estate',
    start_url: '/contacts',
    display: 'standalone',
    background_color: '#020617',
    theme_color: '#020617',
    icons: [
      {
        src: '/icon?size=192',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icon?size=512',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
    // Web Share Target API config for Android sharing
    share_target: {
      action: '/contacts/import',
      method: 'GET',
      enctype: 'application/x-www-form-urlencoded',
      params: {
        title: 'title',
        text: 'text',
        url: 'url',
      },
    },
  };

  return manifestObj as MetadataRoute.Manifest;
}

