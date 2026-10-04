import { useState, type CSSProperties, type ReactNode } from "react";
import {
  CalendarDays,
  ChevronRight,
  ImagePlus,
  MessageCircle,
  Palette,
  Share2,
  SlidersHorizontal,
  Zap,
  type LucideIcon,
} from "lucide-react";
import "./_group.css";
import "./hype-manager-wallet.css";

type DemoTask = {
  id: string;
  title: string;
  description: string;
  Icon: LucideIcon;
  badge?: string;
};

const tasks: DemoTask[] = [
  { id: "share", title: "Share HYPE Card", description: "Choose a card to share", Icon: Share2, badge: "Live" },
  { id: "design", title: "Card Design", description: "Classic, Gallery or Spotlight", Icon: Palette, badge: "Classic" },
  { id: "live-taps", title: "Family Live Taps", description: "Create and revoke in-person family QR codes", Icon: Zap },
  { id: "photo", title: "Upload Photo", description: "Add a new athlete photo", Icon: ImagePlus, badge: "Photo added" },
  { id: "sections", title: "Visible Sections", description: "Choose what supporters see", Icon: SlidersHorizontal },
  { id: "events", title: "Allow Events", description: "Show all Event Cards, or none", Icon: CalendarDays, badge: "Events on" },
  { id: "hypes", title: "Fan Shoutouts", description: "See messages from fans", Icon: MessageCircle, badge: "3 received" },
];

function TaskCard({
  task,
  index,
  activeIndex,
  active,
  onSelect,
  children,
}: {
  task: DemoTask;
  index: number;
  activeIndex: number;
  active: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  const mobileGroup = Math.floor(index / 2);
  const mobileActiveGroup = Math.floor(activeIndex / 2);
  const desktopGroup = Math.floor(index / 3);
  const desktopActiveGroup = Math.floor(activeIndex / 3);
  const positions = {
    "--hype-task-column-mobile": String((index % 2) + 1),
    "--hype-task-row-mobile": String(mobileGroup + 1 + (activeIndex >= 0 && mobileGroup > mobileActiveGroup ? 1 : 0)),
    "--hype-panel-row-mobile": String(Math.max(1, mobileActiveGroup + 2)),
    "--hype-task-column-desktop": String((index % 3) + 1),
    "--hype-task-row-desktop": String(desktopGroup + 1 + (activeIndex >= 0 && desktopGroup > desktopActiveGroup ? 1 : 0)),
    "--hype-panel-row-desktop": String(Math.max(1, desktopActiveGroup + 2)),
  } as CSSProperties;
  const panelId = `demo-hype-manager-panel-${task.id}`;
  const triggerId = `demo-hype-manager-trigger-${task.id}`;

  return (
    <div className="hype-manager-task" style={positions}>
      <button
        id={triggerId}
        type="button"
        className="hype-manager-task-button"
        aria-expanded={active}
        aria-controls={panelId}
        onClick={onSelect}
      >
        <span className="hype-manager-task-icon" aria-hidden="true"><task.Icon /></span>
        <span className="hype-manager-task-copy">
          {task.badge && <span className="hype-manager-task-badge">{task.badge}</span>}
          <span className="hype-manager-task-title">{task.title}</span>
          <span className="hype-manager-task-description">{task.description}</span>
        </span>
        {task.id === "share" && (
          <span className="hype-manager-task-preview hype-manager-demo-athlete" aria-hidden="true">J</span>
        )}
        <span className="hype-manager-task-chevron" aria-hidden="true"><ChevronRight /></span>
      </button>
      <div
        id={panelId}
        className="hype-manager-task-panel"
        aria-labelledby={triggerId}
        hidden={!active}
      >
        {children}
      </div>
    </div>
  );
}

function DesignPanel() {
  const [scale, setScale] = useState(100);
  const [accent, setAccent] = useState("#c4e64b");

  return (
    <section className="hype-demo-design" aria-label="Card design controls">
      <div className="hype-demo-design-heading">
        <div>
          <p className="hype-demo-eyebrow">CARD DESIGN</p>
          <h3>See every change as you make it</h3>
          <p>Keep the live HYPE Card preview close to the settings that change it.</p>
        </div>
        <span className="hype-demo-save-state">Saved</span>
      </div>
      <div className="hype-demo-editor">
        <div className="hype-demo-preview-wrap">
          <div className="hype-demo-player-card" style={{ "--demo-accent": accent, transform: `scale(${scale / 100})` } as CSSProperties}>
            <div className="hype-demo-card-topline"><span>PIXl SPORTS</span><span>FALL 2026</span></div>
            <div className="hype-demo-athlete">
              <span className="hype-demo-number">12</span>
              <span className="hype-demo-initials">J</span>
            </div>
            <div className="hype-demo-card-name">JORDAN<br />CARTER</div>
            <div className="hype-demo-team">CITY HOOPS · GUARD</div>
          </div>
          <p className="hype-demo-preview-caption">LIVE PREVIEW · CLASSIC</p>
        </div>
        <div className="hype-demo-controls">
          <label className="hype-demo-control">
            <span><strong>Card scale</strong><output>{scale}%</output></span>
            <input aria-label="Card scale" type="range" min="85" max="110" value={scale} onChange={(event) => setScale(Number(event.target.value))} />
          </label>
          <fieldset className="hype-demo-control">
            <legend>Accent color</legend>
            <div className="hype-demo-swatches">
              {["#c4e64b", "#55a4ff", "#ff6433"].map((color) => (
                <button key={color} type="button" className={accent === color ? "is-selected" : ""} style={{ "--swatch": color } as CSSProperties} aria-label={`Use ${color} accent`} aria-pressed={accent === color} onClick={() => setAccent(color)} />
              ))}
            </div>
          </fieldset>
          <div className="hype-demo-control">
            <span><strong>Design style</strong></span>
            <div className="hype-demo-style-options"><button type="button" aria-pressed="true">Classic</button><button type="button" aria-pressed="false">Gallery</button><button type="button" aria-pressed="false">Spotlight</button></div>
          </div>
          <p className="hype-demo-helper">Your preview updates immediately. The save status remains visible as you move through settings.</p>
        </div>
      </div>
    </section>
  );
}

function PanelContent({ id }: { id: string }) {
  if (id === "design") return <DesignPanel />;
  const copy: Record<string, { title: string; body: string; action: string }> = {
    share: { title: "Share the HYPE Card", body: "The main link for family and fans stays with this athlete as the season updates.", action: "Copy link" },
    "live-taps": { title: "Family Live Taps", body: "Create a private QR code for family to scan in person during Game Day Live.", action: "Create family QR code" },
    photo: { title: "Upload a new athlete photo", body: "Choose a clear photo to personalize the HYPE Card.", action: "Choose photo" },
    sections: { title: "Visible sections", body: "Choose which saved stats and shoutouts supporters can see.", action: "Manage sections" },
    events: { title: "Event Cards", body: "Choose whether eligible saved Event Cards appear on the HYPE Card.", action: "Manage event visibility" },
    hypes: { title: "Fan Shoutouts", body: "Review messages from supporters and manage Shoutout visibility.", action: "Review Shoutouts" },
  };
  const panel = copy[id];
  return (
    <section className="hype-demo-simple-panel">
      <div><p className="hype-demo-eyebrow">MANAGER TASK</p><h3>{panel.title}</h3><p>{panel.body}</p></div>
      <button type="button">{panel.action}</button>
    </section>
  );
}

export default function HypeManagerGridCurrent() {
  const [activeTask, setActiveTask] = useState("design");
  const activeIndex = tasks.findIndex((task) => task.id === activeTask);

  return (
    <main className="hype-manager-demo-root">
      <div className="hype-manager-demo-shell">
        <header className="hype-manager-demo-header">
          <div><p className="hype-demo-eyebrow">OWNER ONLY</p><h1>HYPE Card Manager</h1><p>Build and share your athlete&apos;s story. Choose what you want to do next.</p></div>
          <span className="hype-demo-season">FALL 2026</span>
        </header>
        <div className="hype-manager-task-grid">
          {tasks.map((task, index) => (
            <TaskCard
              key={task.id}
              task={task}
              index={index}
              activeIndex={activeIndex}
              active={activeTask === task.id}
              onSelect={() => setActiveTask((current) => current === task.id ? "" : task.id)}
            >
              <PanelContent id={task.id} />
            </TaskCard>
          ))}
        </div>
      </div>
    </main>
  );
}