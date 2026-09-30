import type { Glyph } from '../lib/glyphs';

export type Role = 'builder' | 'reader' | 'keyholder' | 'toolsmith';

export interface Part {
  id: string;
  name: string;
  icon: string;
}

export interface Tool {
  id: string;
  name: string;
  icon: string;
}

/** Attach a part to a slot, maybe finished off with a tool. */
export interface Step {
  part: string;
  slot: number;
  tool: string | null;
}

export interface State {
  roles: Record<string, Role>;
  glyphs: Glyph[];
  /** Part id -> glyph id: the Keyholder's key. */
  partGlyph: Record<string, string>;
  /** Tool id -> glyph id (three players: tools are written in glyphs too). */
  toolGlyph: Record<string, string>;
  /** Whether a Toolsmith holds the tools (four players). */
  toolsmith: boolean;
  target: Step[];
  assembly: Step[];
  finishedAt: number | null;
  /** Wrong steps when the Builder finished, each costing PENALTY_MS. */
  wrong: number;
}

export type Action =
  | { type: 'attach'; partId: string; slot: number }
  | { type: 'useTool'; toolId: string }
  | { type: 'undo' }
  | { type: 'finish' };

export interface BuilderView {
  role: 'builder';
  parts: Part[];
  tools: Tool[];
  slots: number;
  steps: number;
  assembly: Step[];
  finished: boolean;
}

export interface ReaderView {
  role: 'reader';
  glyphs: Glyph[];
  /** The instructions: part glyph, slot, and (three players) the tool's glyph. */
  steps: Array<{ glyph: string; slot: number; toolGlyph?: string | null }>;
}

export interface KeyholderView {
  role: 'keyholder';
  glyphs: Glyph[];
  parts: Array<{ glyph: string; part: Part }>;
  tools?: Array<{ glyph: string; tool: Tool }>;
}

export interface ToolsmithView {
  role: 'toolsmith';
  tools: Array<{ step: number; tool: Tool | null }>;
}

export interface RevealView {
  role: 'reveal';
  steps: Array<{ target: Step; built: Step | null; right: boolean }>;
  wrong: number;
  penaltyMs: number;
  parts: Part[];
  tools: Tool[];
}

export type View = BuilderView | ReaderView | KeyholderView | ToolsmithView | RevealView;
