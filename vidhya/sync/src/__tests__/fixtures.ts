import type { Item } from '../../../brain/src/item/schema.js';

/** Clearly synthetic items. The verified bank never enters this public repo. */
export function mcq(id: string, over: Partial<Item> = {}): Item {
  return {
    id,
    pool: 'practice',
    type: 'MCQ',
    answer_kind: 'options',
    marks: 1,
    topic_id: 'synthetic-topic',
    concept_id: 'synthetic-concept',
    stem: 'What is 2+2?',
    options: ['3', '4', '5', '6'],
    key: 1,
    solution: { text: '2+2 = 4', checked: true },
    status: 'verified',
    since_version: '0.0.1',
    ...over,
  };
}

export function msq(id: string, over: Partial<Item> = {}): Item {
  return mcq(id, {
    type: 'MSQ',
    stem: 'Select the even numbers.',
    options: ['2', '3', '4', '5'],
    key: [0, 2],
    solution: { text: '2 and 4 are even', checked: true },
    ...over,
  });
}
