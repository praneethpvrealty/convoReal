import { Composition } from 'remotion';
import { NetVideo, DURATION_MS } from './NetVideo';

const FPS = 30;

export const Root = () => (
  <Composition
    id="TheNet"
    component={NetVideo}
    durationInFrames={Math.ceil((DURATION_MS / 1000) * FPS)}
    fps={FPS}
    width={1920}
    height={1080}
  />
);
