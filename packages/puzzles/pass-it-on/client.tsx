import type { ClipDelivery, PuzzleClientProps } from '@split-signal/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { playClip, type Playback } from '../lib/audio';
import { GlyphSvg } from '../lib/GlyphSvg';
import { RecordButton } from '../lib/RecordButton';
import styles from './client.module.css';
import type {
  Action,
  BuilderView,
  KeyholderView,
  Part,
  ReaderView,
  RevealView,
  Step,
  Tool,
  ToolsmithView,
  View,
} from './types';

type Props = PuzzleClientProps<View, Action>;

const ROLE_NAMES = {
  builder: 'Builder',
  reader: 'Reader',
  keyholder: 'Keyholder',
  toolsmith: 'Toolsmith',
};

export default function PassItOn(props: Props) {
  const { view } = props;
  if (view.role === 'reveal') return <Reveal view={view} />;
  return (
    <div className={styles.root}>
      <Ring {...props} />
      {view.role === 'builder' && <Builder view={view} send={props.send} />}
      {view.role === 'reader' && <Reader view={view} />}
      {view.role === 'keyholder' && <Keyholder view={view} />}
      {view.role === 'toolsmith' && <Toolsmith view={view} />}
    </div>
  );
}

/** Who you hear from and speak to, the record button, and the clips you've been sent. */
function Ring({ view, clips, comms, team }: Props) {
  const nameOf = (id: string | undefined) =>
    team.players.find((p) => p.id === id)?.name ?? 'someone';
  const role = view.role === 'reveal' ? null : ROLE_NAMES[view.role];
  return (
    <section className={styles.ring}>
      <p className={styles.roleLine}>
        You are the <strong>{role}</strong>.{' '}
        {comms.ring && (
          <>
            You hear from <strong>{nameOf(comms.ring.prev)}</strong>, you speak to{' '}
            <strong>{nameOf(comms.ring.next)}</strong>.
          </>
        )}
      </p>
      {clips && (
        <>
          <RecordButton
            recording={clips.recording}
            maxSeconds={5}
            onRecord={() => void clips.record()}
            onStop={clips.stop}
          />
          <Incoming clips={clips.incoming} nameOf={nameOf} />
        </>
      )}
      <p className={styles.note}>
        Every clip arrives chopped up and scrambled, and nobody can answer the person who told them.
      </p>
    </section>
  );
}

/** Plays each new clip as it arrives, and lets you hear recent ones again. */
function Incoming({ clips, nameOf }: { clips: ClipDelivery[]; nameOf: (id: string) => string }) {
  const heard = useRef(clips.at(-1)?.id ?? 0);
  const current = useRef<Playback | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);

  const play = useCallback(async (clip: ClipDelivery) => {
    current.current?.stop();
    const playback = await playClip(clip);
    if (!playback) return;
    current.current = playback;
    setPlaying(clip.id);
    await playback.done;
    if (current.current === playback) {
      current.current = null;
      setPlaying(null);
    }
  }, []);

  useEffect(() => {
    const latest = clips.at(-1);
    if (!latest || latest.id <= heard.current) return;
    heard.current = latest.id;
    const start = setTimeout(() => void play(latest).catch(() => {}), 0);
    return () => clearTimeout(start);
  }, [clips, play]);

  useEffect(() => () => current.current?.stop(), []);

  if (clips.length === 0) return <p className={styles.note}>No clips yet.</p>;
  return (
    <ol className={styles.clips} reversed>
      {[...clips]
        .reverse()
        .slice(0, 5)
        .map((clip) => (
          <li key={clip.id}>
            <span>From {nameOf(clip.from)}</span>
            <button
              className="secondary"
              onClick={() => void play(clip).catch(() => {})}
              disabled={playing === clip.id}
            >
              {playing === clip.id ? 'Playing…' : '▶ Again'}
            </button>
          </li>
        ))}
    </ol>
  );
}

const partOf = (parts: Part[], id: string) => parts.find((p) => p.id === id);
const toolOf = (tools: Tool[], id: string | null) => tools.find((t) => t.id === id);

function Builder({ view, send }: { view: BuilderView; send: Props['send'] }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const used = new Set(view.assembly.map((s) => s.part));
  const full = view.assembly.length >= view.steps;
  const locked = view.finished;

  return (
    <section className={styles.panel}>
      <h4>Your bench</h4>
      <div className={styles.slots}>
        {Array.from({ length: view.slots }, (_, i) => i + 1).map((slot) => (
          <button
            key={slot}
            className={`${styles.slot} ${picked ? styles.slotReady : ''}`}
            disabled={locked || !picked || full}
            onClick={() => {
              if (!picked) return;
              send({ type: 'attach', partId: picked, slot });
              setPicked(null);
            }}
          >
            <span className={styles.slotLabel}>Slot {slot}</span>
            {view.assembly
              .filter((s) => s.slot === slot)
              .map((s) => (
                <span key={s.part} className={styles.slotPart}>
                  {partOf(view.parts, s.part)?.icon}
                  {s.tool && <small>{toolOf(view.tools, s.tool)?.icon}</small>}
                </span>
              ))}
          </button>
        ))}
      </div>
      <p className={styles.note}>
        {picked
          ? `Now tap a slot for the ${partOf(view.parts, picked)?.name.toLowerCase()}.`
          : full
            ? 'All six steps are on. Finish when you think it’s right.'
            : 'Pick a part, then a slot. Tools finish off the last part you attached.'}
      </p>
      <div className={styles.tray}>
        {view.parts.map((part) => (
          <button
            key={part.id}
            className={`${styles.part} ${picked === part.id ? styles.picked : ''}`}
            disabled={locked || full || used.has(part.id)}
            onClick={() => setPicked(picked === part.id ? null : part.id)}
          >
            <span className={styles.icon}>{part.icon}</span>
            {part.name}
          </button>
        ))}
      </div>
      <div className={styles.tools}>
        {view.tools.map((tool) => (
          <button
            key={tool.id}
            className="secondary"
            disabled={locked || view.assembly.length === 0}
            onClick={() => send({ type: 'useTool', toolId: tool.id })}
          >
            {tool.icon} {tool.name}
          </button>
        ))}
      </div>
      <ol className={styles.steps}>
        {view.assembly.map((step, i) => (
          <li key={i}>
            <StepText step={step} parts={view.parts} tools={view.tools} />
          </li>
        ))}
      </ol>
      <div className={styles.actions}>
        <button
          className="secondary"
          disabled={locked || view.assembly.length === 0}
          onClick={() => send({ type: 'undo' })}
        >
          Undo last step
        </button>
        {confirming ? (
          <>
            <button
              onClick={() => {
                setConfirming(false);
                send({ type: 'finish' });
              }}
            >
              Yes, finish
            </button>
            <button className="link" onClick={() => setConfirming(false)}>
              Keep building
            </button>
          </>
        ) : (
          <button disabled={locked || !full} onClick={() => setConfirming(true)}>
            {locked ? 'Finished' : 'Finish'}
          </button>
        )}
      </div>
      {confirming && (
        <p className={styles.note}>
          You won&apos;t know what&apos;s wrong: each wrong step adds 15s.
        </p>
      )}
    </section>
  );
}

function StepText({ step, parts, tools }: { step: Step; parts: Part[]; tools: Tool[] }) {
  const part = partOf(parts, step.part);
  const tool = toolOf(tools, step.tool);
  return (
    <>
      {part?.icon} {part?.name} → slot {step.slot}
      {tool && ` · ${tool.icon} ${tool.name}`}
    </>
  );
}

function Reader({ view }: { view: ReaderView }) {
  const glyph = (id: string) => view.glyphs.find((g) => g.id === id);
  return (
    <section className={styles.panel}>
      <h4>The instructions</h4>
      <p className={styles.note}>Only you have these. The Keyholder knows what the glyphs mean.</p>
      <ol className={styles.glyphSteps}>
        {view.steps.map((step, i) => (
          <li key={i}>
            <span className={styles.glyph}>
              <GlyphSvg glyph={glyph(step.glyph)} size={40} />
            </span>
            <span>into slot {step.slot}</span>
            {step.toolGlyph !== undefined &&
              (step.toolGlyph ? (
                <span className={styles.withTool}>
                  then <GlyphSvg glyph={glyph(step.toolGlyph)} size={30} />
                </span>
              ) : (
                <span className={styles.muted}>no tool</span>
              ))}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Keyholder({ view }: { view: KeyholderView }) {
  const glyph = (id: string) => view.glyphs.find((g) => g.id === id);
  return (
    <section className={styles.panel}>
      <h4>The key</h4>
      <p className={styles.note}>What each glyph means. You never see the instructions.</p>
      <div className={styles.key}>
        {view.parts.map(({ glyph: id, part }) => (
          <div key={id} className={styles.keyCell}>
            <GlyphSvg glyph={glyph(id)} size={36} />
            <span>
              {part.icon} {part.name}
            </span>
          </div>
        ))}
        {view.tools?.map(({ glyph: id, tool }) => (
          <div key={id} className={`${styles.keyCell} ${styles.toolCell}`}>
            <GlyphSvg glyph={glyph(id)} size={36} />
            <span>
              {tool.icon} {tool.name}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Toolsmith({ view }: { view: ToolsmithView }) {
  return (
    <section className={styles.panel}>
      <h4>The tools</h4>
      <p className={styles.note}>Which tool finishes each step, if any.</p>
      <ol className={styles.steps}>
        {view.tools.map(({ step, tool }) => (
          <li key={step}>
            Step {step}:{' '}
            {tool ? `${tool.icon} ${tool.name}` : <span className={styles.muted}>no tool</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Reveal({ view }: { view: RevealView }) {
  return (
    <div className={styles.root}>
      <p className={styles.roleLine}>
        {view.wrong === 0
          ? 'Every step right!'
          : `${view.wrong} wrong ${view.wrong === 1 ? 'step' : 'steps'} (+${(view.wrong * view.penaltyMs) / 1000}s)`}
      </p>
      <ol className={styles.revealSteps}>
        {view.steps.map(({ target, built, right }, i) => (
          <li key={i} className={right ? styles.right : styles.wrong}>
            <span>
              {right ? '✓' : '✗'} <StepText step={target} parts={view.parts} tools={view.tools} />
            </span>
            {!right && (
              <small>
                built:{' '}
                {built ? (
                  <StepText step={built} parts={view.parts} tools={view.tools} />
                ) : (
                  'nothing'
                )}
              </small>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
