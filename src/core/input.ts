type InputState = {
  keys: Set<string>;
  pointerDown: boolean;
};

export function attachInput(target: HTMLElement): InputState {
  const state: InputState = { keys: new Set(), pointerDown: false };

  const normalize = (key: string) => key.toLowerCase();

  window.addEventListener('keydown', (e) => state.keys.add(normalize(e.key)));
  window.addEventListener('keyup', (e) => state.keys.delete(normalize(e.key)));
  target.addEventListener('pointerdown', () => (state.pointerDown = true));
  window.addEventListener('pointerup', () => (state.pointerDown = false));

  return state;
}
