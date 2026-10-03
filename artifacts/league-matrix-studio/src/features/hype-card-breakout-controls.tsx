import { useRef, type CSSProperties } from 'react';

import './hype-card-breakout-controls.css';

export type BreakoutTransform = {
  zoom: number;
  x: number;
  y: number;
};

export type HypeCardBreakoutControlsProps = {
  enabled: boolean;
  borderColor: string;
  cutoutDataUrl: string | null;
  availabilityMessage: string | null;
  disabled?: boolean;
  transform: BreakoutTransform;
  onEnabledChange: (enabled: boolean) => void;
  onBorderColorChange: (color: string) => void;
  onCutoutSelect: (file: File) => void;
  onCutoutRemove: () => void;
  onTransformChange: (transform: BreakoutTransform) => void;
  onTransformReset: () => void;
};

const swatches = [
  { name: 'Blue', color: '#35A8FF' },
  { name: 'Red', color: '#F04444' },
  { name: 'Green', color: '#35C77A' },
  { name: 'Gold', color: '#F5C94D' },
  { name: 'Purple', color: '#9B70F5' },
  { name: 'Silver', color: '#C7D0D9' },
  { name: 'Pink', color: '#F16FA5' },
];

function colorValue(value: string) {
  return /^#[\da-f]{6}$/i.test(value) ? value : '#35A8FF';
}

export function HypeCardBreakoutControls({
  enabled,
  borderColor,
  cutoutDataUrl,
  availabilityMessage,
  disabled = false,
  transform,
  onEnabledChange,
  onBorderColorChange,
  onCutoutSelect,
  onCutoutRemove,
  onTransformChange,
  onTransformReset,
}: HypeCardBreakoutControlsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasCutout = Boolean(cutoutDataUrl);
  const safeColor = colorValue(borderColor);

  const updateTransform = (key: keyof BreakoutTransform, value: number) => {
    onTransformChange({ ...transform, [key]: value });
  };

  return (
    <section className="hype-breakout" aria-labelledby="hype-breakout-title" data-testid="panel-breakout-controls">
      <header className="hype-breakout__header">
        <div>
          <p className="hype-breakout__eyebrow">Player treatment / 04</p>
          <h2 id="hype-breakout-title" className="hype-breakout__title">Breakout</h2>
        </div>
        <label className="hype-breakout__switch">
          <input
            type="checkbox"
            checked={enabled}
            disabled={disabled}
            onChange={(event) => onEnabledChange(event.currentTarget.checked)}
            aria-label="Enable Breakout"
            data-testid="toggle-breakout"
          />
          <span className="hype-breakout__switch-track" aria-hidden="true"><span /></span>
          <span className="hype-breakout__switch-label">{enabled ? 'On' : 'Off'}</span>
        </label>
      </header>

      <p className="hype-breakout__intro">
        Lift the athlete beyond the frame with a crisp team-color edge.
      </p>

      {!hasCutout && (
        <div className="hype-breakout__notice" role="status" data-testid="text-breakout-requirement">
          <span className="hype-breakout__notice-mark" aria-hidden="true">!</span>
          <p>
            A transparent player cutout is required. Upload a transparent PNG or WebP to use Breakout.
            Your standard photo stays intact; this editor does not remove backgrounds automatically.
          </p>
        </div>
      )}

      {availabilityMessage && (
        <p className="hype-breakout__availability" role="status" data-testid="text-breakout-availability">
          {availabilityMessage}
        </p>
      )}

      <div className="hype-breakout__upload-row">
        <input
          ref={fileInputRef}
          className="hype-breakout__file-input"
          type="file"
          accept="image/png,image/webp,.png,.webp"
          disabled={disabled}
          aria-label="Choose transparent player cutout"
          data-testid="input-breakout-cutout"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) onCutoutSelect(file);
            event.currentTarget.value = '';
          }}
        />
        <button
          type="button"
          className="hype-breakout__button hype-breakout__button--primary"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          data-testid="button-select-breakout-cutout"
        >
          <span aria-hidden="true">+</span>
          {hasCutout ? 'Replace cutout' : 'Choose cutout'}
        </button>
        {hasCutout && (
          <button
            type="button"
            className="hype-breakout__button hype-breakout__button--quiet"
            onClick={onCutoutRemove}
            disabled={disabled}
            data-testid="button-remove-breakout-cutout"
          >
            Remove
          </button>
        )}
      </div>

      <div className={`hype-breakout__preview ${hasCutout ? 'is-loaded' : ''}`} data-testid="preview-breakout-cutout">
        <div className="hype-breakout__preview-top">
          <span>Cutout preview</span>
          <span className="hype-breakout__live"><i aria-hidden="true" /> Live</span>
        </div>
        <div className="hype-breakout__stage" aria-label={hasCutout ? 'Live cutout preview' : 'Cutout preview placeholder'}>
          <div className="hype-breakout__stage-lines" aria-hidden="true" />
          {cutoutDataUrl ? (
            <img
              src={cutoutDataUrl}
              alt="Uploaded player cutout preview"
              className="hype-breakout__cutout"
              draggable={false}
              style={{
                filter: `drop-shadow(0 0 0.18rem ${safeColor}) drop-shadow(0 0 0.1rem ${safeColor})`,
                 transform: `translate(${transform.x * 0.2}px, ${transform.y * 0.2}px) scale(${transform.zoom})`,
              }}
              data-testid="img-breakout-cutout-preview"
            />
          ) : (
            <div className="hype-breakout__placeholder" aria-hidden="true">
              <span className="hype-breakout__placeholder-head" />
              <span className="hype-breakout__placeholder-body" />
            </div>
          )}
          <span className="hype-breakout__stage-corner hype-breakout__stage-corner--tl" aria-hidden="true" />
          <span className="hype-breakout__stage-corner hype-breakout__stage-corner--br" aria-hidden="true" />
        </div>
        <div className="hype-breakout__preview-caption">
          <span>{hasCutout ? 'Position and scale' : 'Awaiting transparent cutout'}</span>
          <span className="hype-breakout__preview-format">PNG / WEBP</span>
        </div>
      </div>

      <fieldset className="hype-breakout__field-group" disabled={disabled}>
        <legend className="hype-breakout__label">Edge color</legend>
        <div className="hype-breakout__swatches" role="group" aria-label="Breakout edge color presets">
          {swatches.map((swatch) => (
            <button
              key={swatch.name}
              type="button"
              className={`hype-breakout__swatch ${safeColor.toLowerCase() === swatch.color.toLowerCase() ? 'is-selected' : ''}`}
              style={{ '--swatch-color': swatch.color } as CSSProperties & { '--swatch-color': string }}
              aria-label={`${swatch.name} edge`}
              aria-pressed={safeColor.toLowerCase() === swatch.color.toLowerCase()}
              title={swatch.name}
              onClick={() => onBorderColorChange(swatch.color)}
              data-testid={`button-breakout-color-${swatch.name.toLowerCase()}`}
            />
          ))}
        </div>
        <div className="hype-breakout__custom-color">
          <label className="hype-breakout__color-picker-label" htmlFor="breakout-custom-color">
            <input
              id="breakout-custom-color"
              type="color"
              value={safeColor}
              onChange={(event) => onBorderColorChange(event.currentTarget.value.toUpperCase())}
              aria-label="Custom edge color"
              data-testid="input-breakout-custom-color"
            />
            <span>Custom</span>
          </label>
          <label className="hype-breakout__hex-label" htmlFor="breakout-hex-color">HEX</label>
          <input
            id="breakout-hex-color"
            className="hype-breakout__hex-input"
            type="text"
            value={borderColor}
            onChange={(event) => onBorderColorChange(event.currentTarget.value)}
            pattern="^#[0-9A-Fa-f]{6}$"
            maxLength={7}
            aria-label="Edge color hex value"
            data-testid="input-breakout-hex-color"
          />
        </div>
      </fieldset>

      <fieldset className="hype-breakout__field-group" disabled={disabled || !hasCutout}>
        <div className="hype-breakout__controls-heading">
          <legend className="hype-breakout__label">Framing</legend>
          <button
            type="button"
            className="hype-breakout__reset"
            onClick={onTransformReset}
            disabled={disabled || !hasCutout}
            data-testid="button-reset-breakout-position"
          >
            Reset position
          </button>
        </div>
        <label className="hype-breakout__range-row" htmlFor="breakout-zoom">
          <span>Scale</span>
          <input
            id="breakout-zoom"
            type="range"
             min="0.7"
             max="1.65"
            step="0.01"
            value={transform.zoom}
            onChange={(event) => updateTransform('zoom', Number(event.currentTarget.value))}
            aria-label="Cutout scale"
            data-testid="input-breakout-zoom"
          />
          <output htmlFor="breakout-zoom" data-testid="value-breakout-zoom">{Math.round(transform.zoom * 100)}%</output>
        </label>
        <label className="hype-breakout__range-row" htmlFor="breakout-horizontal">
          <span>Horizontal</span>
          <input
            id="breakout-horizontal"
            type="range"
             min="-240"
             max="240"
            step="1"
            value={transform.x}
            onChange={(event) => updateTransform('x', Number(event.currentTarget.value))}
            aria-label="Cutout horizontal position"
            data-testid="input-breakout-horizontal"
          />
          <output htmlFor="breakout-horizontal" data-testid="value-breakout-horizontal">{transform.x}px</output>
        </label>
        <label className="hype-breakout__range-row" htmlFor="breakout-vertical">
          <span>Vertical</span>
          <input
            id="breakout-vertical"
            type="range"
             min="-240"
             max="240"
            step="1"
            value={transform.y}
            onChange={(event) => updateTransform('y', Number(event.currentTarget.value))}
            aria-label="Cutout vertical position"
            data-testid="input-breakout-vertical"
          />
          <output htmlFor="breakout-vertical" data-testid="value-breakout-vertical">{transform.y}px</output>
        </label>
      </fieldset>
    </section>
  );
}
