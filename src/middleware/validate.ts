import { Request, Response, NextFunction } from 'express';
import { AnyZodObject, ZodError } from 'zod';
import { ApiError } from '../utils/ApiError';

type Source = 'body' | 'query' | 'params';

export function validate(schema: AnyZodObject, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const parsed = schema.parse(req[source]);
      if (source === 'body') req.body = parsed;
      else Object.assign(req[source], parsed);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const details = err.errors.map((e) => ({ path: e.path.join('.'), message: e.message }));
        return next(ApiError.badRequest(err.errors[0]?.message ?? 'Invalid input', details));
      }
      next(err);
    }
  };
}
