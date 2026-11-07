import { PaginatedResult } from './paginated.result';

describe('PaginatedResult', () => {
  it('keeps the items and computes the meta', () => {
    const result = PaginatedResult.of(['a', 'b'], 45, 2, 20);

    expect(result.items).toEqual(['a', 'b']);
    expect(result.meta).toEqual({
      page: 2,
      limit: 20,
      totalItems: 45,
      totalPages: 3,
    });
  });

  it('counts a full last page exactly', () => {
    expect(PaginatedResult.of([], 40, 1, 20).meta.totalPages).toBe(2);
  });

  it('has no pages when nothing matches', () => {
    expect(PaginatedResult.of([], 0, 1, 20).meta.totalPages).toBe(0);
  });

  it('keeps the real totals for a page past the end', () => {
    const result = PaginatedResult.of([], 3, 5, 2);

    expect(result.items).toEqual([]);
    expect(result.meta).toEqual({
      page: 5,
      limit: 2,
      totalItems: 3,
      totalPages: 2,
    });
  });
});
