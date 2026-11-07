import { ApiProperty } from '@nestjs/swagger';

export class PaginationMeta {
  @ApiProperty({ example: 2, description: 'Página actual, desde 1' })
  page: number;

  @ApiProperty({
    example: 20,
    description: 'Cantidad máxima de ítems por página',
  })
  limit: number;

  @ApiProperty({
    example: 45,
    description: 'Total de ítems que coinciden con la búsqueda',
  })
  totalItems: number;

  @ApiProperty({ example: 3, description: 'Total de páginas' })
  totalPages: number;
}

// One page of results plus the totals a client needs to render a pager
export class PaginatedResult<T> {
  items: T[];

  @ApiProperty({ type: PaginationMeta })
  meta: PaginationMeta;

  static of<T>(
    items: T[],
    totalItems: number,
    page: number,
    limit: number,
  ): PaginatedResult<T> {
    const result = new PaginatedResult<T>();
    result.items = items;
    result.meta = {
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
    };

    return result;
  }
}
