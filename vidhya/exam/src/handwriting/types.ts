/** Handwriting pad types (T31, DR15b). Strokes are in canvas CSS pixels. */
export interface Point { x: number; y: number }
export type Stroke = Point[];

export interface Box { minX: number; minY: number; maxX: number; maxY: number }

/** One written character: the strokes that make it, left-to-right order. */
export interface CharGroup { strokes: Stroke[]; box: Box }

/** Classes the network knows, in output order. */
export const CLASSES = '0123456789.-';
export const INPUT_SIZE = 28;
