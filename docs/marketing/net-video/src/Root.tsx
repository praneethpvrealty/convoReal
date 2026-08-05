import { Composition } from 'remotion';
import { NetVideo, DURATION_MS } from './NetVideo';
import { SwitchboardVideo, SWITCHBOARD_DURATION_MS } from './SwitchboardVideo';

const FPS = 30;

export const Root = () => (
  <>
    <Composition
      id="TheNet"
      component={NetVideo}
      durationInFrames={Math.ceil((DURATION_MS / 1000) * FPS)}
      fps={FPS}
      width={1920}
      height={1080}
    />
    <Composition
      id="Switchboard"
      component={SwitchboardVideo}
      durationInFrames={Math.ceil((SWITCHBOARD_DURATION_MS / 1000) * FPS)}
      fps={FPS}
      width={1920}
      height={1080}
    />
  </>
);
