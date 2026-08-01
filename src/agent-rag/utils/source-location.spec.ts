import {
  normalizeSourceLocation,
  buildGraphSummary,
} from './source-location';

describe('normalizeSourceLocation', () => {
  it('parses L42', () => {
    expect(normalizeSourceLocation('L42')).toBe('42');
  });

  it('parses bare line numbers', () => {
    expect(normalizeSourceLocation('42')).toBe('42');
  });

  it('parses ranges', () => {
    expect(normalizeSourceLocation('10-20')).toBe('10-20');
    expect(normalizeSourceLocation('L10-L20')).toBe('10-20');
  });

  it('returns null for unparseable values', () => {
    expect(normalizeSourceLocation(undefined)).toBeNull();
    expect(normalizeSourceLocation('')).toBeNull();
    expect(normalizeSourceLocation('somewhere')).toBeNull();
  });
});

describe('buildGraphSummary', () => {
  it('includes type name path and line', () => {
    expect(
      buildGraphSummary({
        type: 'Class',
        name: 'Foo',
        filePath: 'src/foo.ts',
        lineRange: '12',
      }),
    ).toBe('Class Foo @ src/foo.ts:12');
  });
});
