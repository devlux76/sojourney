export function starBrightness(vmag: number): number {
  return Math.pow(10, -0.2 * (vmag - 1));
}

const COLOUR_STOPS: [number, [number, number, number]][] = [
  [-0.3, [0.62, 0.73, 1.0]],
  [0.0, [0.85, 0.9, 1.0]],
  [0.6, [1.0, 0.96, 0.9]],
  [1.0, [1.0, 0.85, 0.7]],
  [1.6, [1.0, 0.7, 0.45]],
];

export function starColour(bv: number): [number, number, number] {
  if (bv <= COLOUR_STOPS[0][0]) return [...COLOUR_STOPS[0][1]];
  for (let i = 1; i < COLOUR_STOPS.length; i++) {
    const [b1, c1] = COLOUR_STOPS[i];
    if (bv <= b1) {
      const [b0, c0] = COLOUR_STOPS[i - 1], t = (bv - b0) / (b1 - b0);
      return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
    }
  }
  return [...COLOUR_STOPS[COLOUR_STOPS.length - 1][1]];
}
