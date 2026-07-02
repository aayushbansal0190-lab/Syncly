import { useEffect, useState } from "react";

interface AuthImagePatternProps {
  title: string;
  subtitle: string;
}

const SIZE = 3;
const TILES = SIZE * SIZE;

// Each origin returns a tile's "distance" from where the wave starts, so tiles
// nearer that edge/corner turn first. Cycling through corners AND edges makes the
// wave arrive from a different direction each round — including straight down and
// straight up — instead of only diagonals. Ordered to sweep around like a clock:
// corner, straight edge, corner, straight edge...
const ORIGINS = [
  (r: number, c: number) => r + c, // from top-left
  (r: number, _c: number) => r, // from the top (downward)
  (r: number, c: number) => r + (SIZE - 1 - c), // from top-right
  (_r: number, c: number) => SIZE - 1 - c, // from the right
  (r: number, c: number) => SIZE - 1 - r + (SIZE - 1 - c), // from bottom-right
  (r: number, _c: number) => SIZE - 1 - r, // from the bottom (upward)
  (r: number, c: number) => SIZE - 1 - r + c, // from bottom-left
  (_r: number, c: number) => c, // from the left
];

const FLIP_MS = 1800; // how long a single tile takes to turn 180°
const STEP_MS = 220; // gap between successive tiles within one wave
const ROUND_MS = 3600; // gap between waves (> longest wave + one flip so it settles)

const AuthImagePattern = ({ title, subtitle }: AuthImagePatternProps) => {
  // Each tile's accumulated rotation. A wave adds 180° to a tile, so it turns to
  // its other face and *stays* there; the next wave turns it again. Transitioning
  // to the new value (rather than a one-shot spin) is what makes it hold.
  const [rotations, setRotations] = useState<number[]>(() => Array(TILES).fill(0));

  useEffect(() => {
    let dir = 0;
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    const runWave = () => {
      const order = ORIGINS[dir];
      for (let i = 0; i < TILES; i++) {
        const row = Math.floor(i / SIZE);
        const col = i % SIZE;
        const t = setTimeout(() => {
          setRotations((prev) => {
            const next = [...prev];
            next[i] += 180;
            return next;
          });
        }, order(row, col) * STEP_MS);
        timeouts.push(t);
      }
      dir = (dir + 1) % ORIGINS.length;
    };

    runWave();
    const interval = setInterval(runWave, ROUND_MS);
    return () => {
      clearInterval(interval);
      timeouts.forEach(clearTimeout);
    };
  }, []);

  return (
    <div className="hidden lg:flex items-center justify-center bg-base-200 p-12">
      <div className="max-w-md text-center">
        <div className="grid grid-cols-3 gap-3 mb-8">
          {[...Array(TILES)].map((_, i) => (
            // Per-tile perspective wrapper: each square gets its own vanishing
            // point so they all turn identically, instead of skewing toward a
            // single point shared across the whole grid.
            <div key={i} className="aspect-square [perspective:600px]">
              <div
                className="relative w-full h-full [transform-style:preserve-3d]"
                style={{
                  transform: `rotateY(${rotations[i]}deg)`,
                  transition: `transform ${FLIP_MS}ms ease-in-out`,
                }}
              >
                {/* Both faces use the same gradient mix, so the tile keeps its
                    look through the whole turn. */}
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary/40 to-secondary/40 shadow-lg shadow-primary/20 [backface-visibility:hidden]" />
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary/40 to-secondary/40 shadow-lg shadow-primary/20 [backface-visibility:hidden] [transform:rotateY(180deg)]" />
              </div>
            </div>
          ))}
        </div>
        <h2 className="text-2xl font-bold mb-4">{title}</h2>
        <p className="text-base-content/60">{subtitle}</p>
      </div>
    </div>
  );
};

export default AuthImagePattern;
