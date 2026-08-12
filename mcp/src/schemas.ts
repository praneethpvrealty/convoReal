// Zod fragments shared across tools, so paging and format behave
// identically everywhere and are described to the model once.

import { z } from 'zod';

import { ResponseFormat } from './format.js';

export const responseFormatField = z
  .enum([ResponseFormat.MARKDOWN, ResponseFormat.JSON])
  .default(ResponseFormat.MARKDOWN)
  .describe(
    "Output format. 'markdown' (default) is compact and readable; 'json' returns the full envelope for programmatic use."
  );

export const limitField = z
  .number()
  .int()
  .min(1)
  .max(100)
  .default(25)
  .describe('Maximum results to return (1-100, default 25).');

export const offsetField = z
  .number()
  .int()
  .min(0)
  .default(0)
  .describe(
    'Results to skip, for paging. Use the next_offset from a previous call.'
  );

export const paginationFields = {
  limit: limitField,
  offset: offsetField,
  response_format: responseFormatField,
};

export const idField = (what: string) =>
  z
    .string()
    .uuid(`Must be a ${what} UUID`)
    .describe(`The ${what}'s id (UUID).`);
