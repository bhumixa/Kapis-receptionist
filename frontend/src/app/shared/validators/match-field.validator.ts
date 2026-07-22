import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/** Cross-field validator for confirm-password-style form controls. */
export function matchFieldValidator(controlName: string, matchingControlName: string): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const control = group.get(controlName);
    const matchingControl = group.get(matchingControlName);

    if (!control || !matchingControl) {
      return null;
    }
    if (matchingControl.value !== control.value) {
      matchingControl.setErrors({ ...matchingControl.errors, mismatch: true });
      return { mismatch: true };
    }

    if (matchingControl.hasError('mismatch')) {
      const rest = Object.fromEntries(
        Object.entries(matchingControl.errors ?? {}).filter(([key]) => key !== 'mismatch'),
      );
      matchingControl.setErrors(Object.keys(rest).length > 0 ? rest : null);
    }
    return null;
  };
}
