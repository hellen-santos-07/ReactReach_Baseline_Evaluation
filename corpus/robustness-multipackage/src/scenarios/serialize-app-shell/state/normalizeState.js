export function normalizeState(initialState) {
  return { ...initialState, hydrated: true };
}
