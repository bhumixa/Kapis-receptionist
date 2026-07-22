import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/**
 * Mirrors docs/API_SPECIFICATION.md Section 4 `/auth/register` server-side
 * password rules exactly, so the user sees the same constraint before
 * submitting, not just after a round-trip (FRONTEND_ARCHITECTURE.md
 * Section 5.2).
 */
export function passwordStrengthValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value as string | null;
    if (!value) {
      return null; // `Validators.required` owns the empty case.
    }

    const errors: ValidationErrors = {};
    if (value.length < 8) {
      errors['minLength'] = true;
    }
    if (!/[A-Z]/.test(value)) {
      errors['uppercase'] = true;
    }
    if (!/[0-9]/.test(value)) {
      errors['number'] = true;
    }

    return Object.keys(errors).length > 0 ? errors : null;
  };
}
