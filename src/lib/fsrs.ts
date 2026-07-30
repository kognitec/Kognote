export interface FSRSState {
  interval: number;
  repetition: number;
  efactor: number;
  nextReviewDate: string;
  stability?: number;
  difficulty?: number;
  state?: number;
}

// FSRS v5 parameters (default trained parameters)
const w = [
  0.4, 0.9, 2.3, 10.9, // w0..w3 (initial stability after Again, Hard, Good, Easy)
  4.93, 0.94, 0.86, 0.01, // w4..w7 (difficulty updates)
  1.49, 0.14, 0.94, // w8..w10 (stability recall)
  2.18, 0.05, 0.34, 1.26, // w11..w14 (stability lapse)
  0.29, 2.61 // w15..w16 (Hard and Easy recall multipliers)
];

// Ratings in FSRS:
// 1 = Again, 2 = Hard, 3 = Good, 4 = Easy
function mapGradeToRating(grade: number): number {
  if (grade <= 0) return 1; // Again
  if (grade <= 2) return 2; // Hard
  if (grade === 3) return 3; // Good
  return 4; // Easy (grade 5)
}

/// Computes the next review date and spacing metadata using FSRS v5 algorithm.
export function computeFSRS(state: FSRSState, grade: number): FSRSState {
  const rating = mapGradeToRating(grade);
  let { interval, repetition, efactor, stability, difficulty, state: fsrsState } = state;

  // Initialize FSRS fields if they don't exist yet (migration from SM-2 cards)
  if (stability === undefined || difficulty === undefined) {
    stability = w[rating - 1];
    difficulty = w[4] - (rating - 3) * w[5];
    difficulty = Math.max(1, Math.min(10, difficulty));
    fsrsState = rating === 1 ? 1 : 2; // 1 = Learning (Again), 2 = Review (Hard/Good/Easy)
    repetition = 1;
    interval = Math.max(1, Math.round(stability));
  } else {
    // Retrieve card memory properties
    let S = stability;
    let D = difficulty;

    // Calculate elapsed time (t) since last review.
    const now = new Date();
    const nextReviewDate = state.nextReviewDate ? new Date(state.nextReviewDate) : new Date();
    const lastReviewDate = new Date(nextReviewDate.getTime() - interval * 24 * 60 * 60 * 1000);
    const elapsedMs = now.getTime() - lastReviewDate.getTime();
    const t = Math.max(0.1, elapsedMs / (24 * 60 * 60 * 1000));

    // Probability of recall (R) at review time
    const R = Math.pow(1 + t / (9 * S), -1);

    // 1. Update difficulty (D)
    let nextD = D - w[6] * (rating - 3);
    // Apply mean reversion to prevent extreme difficulty drifting
    nextD = w[7] * w[4] + (1 - w[7]) * nextD;
    D = Math.max(1, Math.min(10, nextD));

    // 2. Update stability (S)
    if (rating === 1) {
      // Lapse: user forgot the card (Again)
      S = w[11] * Math.pow(D, -w[12]) * (Math.pow(S + 1, w[13]) - 1) * Math.exp(w[14] * (1 - R));
      S = Math.max(0.1, S);
      fsrsState = 3; // Relearning
    } else {
      // Recall: user remembered the card (Hard, Good, Easy)
      let h = 1.0;
      if (rating === 2) h = w[15]; // Hard modifier
      if (rating === 4) h = w[16]; // Easy modifier

      S = S * (1 + Math.exp(w[8]) * (11 - D) * Math.pow(S, -w[9]) * (Math.exp(w[10] * (1 - R)) - 1) * h);
      fsrsState = 2; // Review
    }

    stability = S;
    difficulty = D;
    repetition += 1;
    interval = Math.max(1, Math.round(S));
  }

  // Derive next review date
  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + interval);
  const nextReviewDateStr = nextDate.toISOString().split("T")[0];

  // E-factor legacy field is kept for database compatibility, but updated to represent stability
  efactor = Math.max(1.3, Number((stability / (repetition || 1)).toFixed(2)));

  return {
    interval,
    repetition,
    efactor,
    nextReviewDate: nextReviewDateStr,
    stability,
    difficulty,
    state: fsrsState,
  };
}
