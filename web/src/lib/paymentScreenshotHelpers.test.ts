import { describe, expect, it } from 'vitest';
import { withDefaultScreenshotFlagIfUrl } from './paymentScreenshotHelpers';

describe('withDefaultScreenshotFlagIfUrl', () => {
  it('leaves entries with url and flag unchanged', () => {
    const e = { url: 'https://x/y.jpg', flag: 'red' };
    expect(withDefaultScreenshotFlagIfUrl(e)).toEqual(e);
  });

  it('adds green when url present but flag missing', () => {
    const e = { url: 'https://x/y.jpg', id: '1' };
    expect(withDefaultScreenshotFlagIfUrl(e)).toEqual({
      ...e,
      flag: 'green',
    });
  });

  it('does not add flag for waived-only entries without url', () => {
    const e = { waivedNoScreenshot: true, waivedByUserId: 'u1' };
    expect(withDefaultScreenshotFlagIfUrl(e)).toEqual(e);
  });
});
