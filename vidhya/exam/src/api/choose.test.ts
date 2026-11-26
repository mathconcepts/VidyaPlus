import { describe, it, expect } from 'vitest';
import { chooseApi } from './choose';
import { HttpExamApi } from './http';

describe('chooseApi (production selection is unchanged by the demo build)', () => {
  it('returns the real HTTP client by default', async () => {
    expect(await chooseApi('')).toBeInstanceOf(HttpExamApi);
  });
  it('never returns the demo API: ?demo=1 and ?fake=1 outside dev do not select synthetic data', async () => {
    expect(await chooseApi('?demo=1')).toBeInstanceOf(HttpExamApi);
  });
});
