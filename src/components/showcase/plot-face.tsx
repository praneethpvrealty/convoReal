import type { Property } from '@/types';
import { plotFaceDetails } from '@/lib/showcase/deal-floor';

interface PlotFaceProps {
  property: Property;
}

export function PlotFace({ property }: PlotFaceProps) {
  const face = plotFaceDetails(property);
  return (
    <div
      className="df-plot-face"
      role="img"
      aria-label={`${face.headline}${face.caption ? `, ${face.caption}` : ''}${face.road ? `, ${face.road}` : ''}`}
    >
      <svg viewBox="0 0 400 300" aria-hidden="true">
        <defs>
          <pattern
            id={`df-grid-${property.id}`}
            width="20"
            height="20"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M20 0H0v20"
              fill="none"
              stroke="currentColor"
              strokeOpacity="0.14"
              strokeWidth="1"
            />
          </pattern>
        </defs>
        <rect width="400" height="300" fill={`url(#df-grid-${property.id})`} />
        <path
          d="M100 60h200v150H100z"
          className="df-plot-outline"
          strokeWidth="3"
          strokeDasharray="10 8"
        />
        <text x="360" y="40" textAnchor="middle" className="df-plot-mono">
          N ↑
        </text>
        {face.road && (
          <text x="200" y="250" textAnchor="middle" className="df-plot-mono">
            {face.road.toUpperCase()}
          </text>
        )}
      </svg>
      <div className="df-plot-copy">
        <span className="df-plot-headline">{face.headline}</span>
        {face.caption && (
          <span className="df-plot-caption">{face.caption}</span>
        )}
        <span className="df-plot-caption">Photos on request</span>
      </div>
    </div>
  );
}
