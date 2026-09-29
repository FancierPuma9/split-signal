export const BUTTON_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const;

export type ButtonColor = (typeof BUTTON_COLORS)[number];

export interface State {
  buttons: Array<{ playerId: string; color: ButtonColor; pressed: boolean }>;
}

export interface View {
  color: ButtonColor;
  pressed: boolean;
  teamPressed: number;
  teamSize: number;
}

export type Action = { type: 'press' };
