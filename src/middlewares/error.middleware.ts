import { ErrorRequestHandler } from 'express';

import { ZodError } from 'zod';
import {
  INTERNAL_SERVER_ERROR,
  BAD_REQUEST,
  INTERNAL_SERVER_ERROR_MESSAGE,
  AppError,
} from '@core/main';

export const errorMiddleware: ErrorRequestHandler = (
  err: AppError | Error,
  req,
  res,
  next,
) => {
  /* For Operational Errors */
  if (err instanceof ZodError) {
    return res.status(BAD_REQUEST).json({
      success: false,
      message: 'Validation failed!',
      error: err.issues.map((issue) => issue?.message),
    });
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: err.success,
      message: err.message,
      ...(process.env.APP_ENV === 'development' && { stack: err.stack }),
    });
  }

  /* For Programmatic Errors */
  console.log('Error occurred', err);

  return res.status(INTERNAL_SERVER_ERROR).json({
    message: INTERNAL_SERVER_ERROR_MESSAGE,
    ...(process.env.APP_ENV === 'development' && { stack: err.stack }),
  });
};
