export type InputState = {
  keys: Set<string>;
  pointerDown: boolean;
};

export function attachInput(target: HTMLElement): InputState {
  const state: InputState = { keys: new Set(), pointerDown: false };

  window.addEventListener('keydown', (e) => state.keys.add(e.key));
  window.addEventListener('keyup', (e) => state.keys.delete(e.key));
  target.addEventListener('pointerdown', () => (state.pointerDown = true));
  window.addEventListener('pointerup', () => (state.pointerDown = false));

  return state;
}
