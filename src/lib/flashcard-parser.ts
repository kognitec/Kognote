export interface Flashcard {
  id: string;
  front: string;
  back: string;
  filePath: string;
  interval: number;
  repetition: number;
  efactor: number;
  nextReviewDate: string;
  stability?: number;
  difficulty?: number;
  state?: number;
  noteDueDate?: string;
  notePriority?: string;
}


function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

export function parseFlashcards(content: string, filePath: string): Flashcard[] {
  const cards: Flashcard[] = [];
  const cardIds = new Set<string>();

  // Flashcards syntax: @flashcard (Question::Answer) or @flashcards (Question::Answer)
  const regex1 = /@flashcards?\s*\(([\s\S]*?)::([\s\S]*?)\)/gi;
  let match;

  while ((match = regex1.exec(content)) !== null) {
    const front = match[1].trim();
    const back = match[2].trim();

    if (front && back) {
      const id = hashString(`${filePath}:${front}:${back}`);
      if (!cardIds.has(id)) {
        cardIds.add(id);
        cards.push({
          id,
          front,
          back,
          filePath,
          interval: 0,
          repetition: 0,
          efactor: 2.5,
          nextReviewDate: new Date().toISOString().split("T")[0],
        });
      }
    }
  }

  return cards;
}
