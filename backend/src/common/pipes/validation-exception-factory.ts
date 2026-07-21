import { UnprocessableEntityException } from '@nestjs/common';
import { ValidationError } from 'class-validator';
import { ERROR_CODES } from '../constants/error-codes.constant';

interface FieldIssue {
  field: string;
  issue: string;
}

function flatten(errors: ValidationError[], parentPath = ''): FieldIssue[] {
  return errors.flatMap((error) => {
    const path = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;

    if (error.children && error.children.length > 0) {
      return flatten(error.children, path);
    }

    return Object.values(error.constraints ?? {}).map((issue) => ({
      field: path,
      issue,
    }));
  });
}

/**
 * Produces the exact shape docs/API_SPECIFICATION.md Section 2.3 requires
 * for `VALIDATION_ERROR` (one `{ field, issue }` entry per failing field),
 * instead of Nest's default `message: string[]` shape.
 */
export function validationExceptionFactory(
  errors: ValidationError[],
): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: ERROR_CODES.VALIDATION_ERROR,
    message: 'One or more fields failed validation.',
    details: flatten(errors),
  });
}
