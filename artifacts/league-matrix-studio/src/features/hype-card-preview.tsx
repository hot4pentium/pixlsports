import type { RefObject } from 'react';

import { buildHypeCardSvg, getPhotoClipInfo, getPhotoFrame, STADIUM_MEDIA_FRAME } from './hype-card-svg';
import { getDimensions, type HypeCardProject } from './hype-card-types';

export function PreviewArtwork({
  project,
  videoUrl,
  videoRef,
  ns,
  testId,
  poster,
  muted = true,
}: {
  project: HypeCardProject;
  videoUrl?: string;
  videoRef?: RefObject<HTMLVideoElement | null>;
  ns: string;
  testId: string;
  poster?: string;
  muted?: boolean;
}) {
  const dimensions = getDimensions(project.format);
  const clipInfo = getPhotoClipInfo(project, ns);
  const frame = project.format === 'card' ? STADIUM_MEDIA_FRAME : getPhotoFrame(project.format);
  const hasVideo = project.mediaType === 'video' && Boolean(videoUrl);
  const hasImage = project.mediaType !== 'video' && Boolean(project.photo);

  if (!hasVideo && !hasImage) {
    return (
      <div
        className="h-full w-full [&>svg]:h-full [&>svg]:w-full"
        data-testid={testId}
        dangerouslySetInnerHTML={{ __html: buildHypeCardSvg(project, 'all', ns) }}
      />
    );
  }

  const mediaStyle = {
    left: `${(clipInfo.x - frame.x) / frame.width * 100}%`,
    top: `${(clipInfo.y - frame.y) / frame.height * 100}%`,
    width: `${clipInfo.w / frame.width * 100}%`,
    height: `${clipInfo.h / frame.height * 100}%`,
    filter: `brightness(${project.adjustments.brightness}) contrast(${project.adjustments.contrast}) saturate(${project.adjustments.saturation})`,
    transformOrigin: 'center',
    transform: `rotate(${project.photoTransform.rotation}deg) scaleX(${project.photoTransform.flip ? -1 : 1})`,
    objectFit: hasVideo && project.videoFit === 'fill' ? ('cover' as const) : ('contain' as const),
  };

  return (
    <div className="relative h-full w-full overflow-hidden" data-testid={testId}>
      <div className="absolute inset-0 pointer-events-none [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: buildHypeCardSvg(project, 'bg', ns) }} />
      <div
        className="absolute overflow-hidden"
        style={{
          left: `${frame.x / dimensions.width * 100}%`,
          top: `${frame.y / dimensions.height * 100}%`,
          width: `${frame.width / dimensions.width * 100}%`,
          height: `${frame.height / dimensions.height * 100}%`,
          borderRadius: `${frame.radius / frame.width * 100}%`,
        }}
      >
        {hasVideo ? (
          <>
            {project.videoFit === 'fit' && (
              <video src={videoUrl} className="absolute inset-0 h-full w-full scale-110 object-cover opacity-45 blur-xl" muted playsInline aria-hidden="true" />
            )}
            <video
              ref={videoRef}
              src={videoUrl}
              poster={poster}
              className="absolute max-w-none"
              muted={muted}
              playsInline
              style={mediaStyle}
            />
          </>
        ) : (
          <img
            src={project.photo ?? ''}
            alt=""
            className="absolute max-w-none object-contain"
            draggable={false}
            style={mediaStyle}
          />
        )}
      </div>
      <div className="absolute inset-0 pointer-events-none [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: buildHypeCardSvg(project, 'fg', ns) }} />
    </div>
  );
}