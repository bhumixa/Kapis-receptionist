import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * Centered single-column card, no navigation chrome
 * (docs/FRONTEND_ARCHITECTURE.md Section 4.1) — used for `/auth/login` and
 * `/auth/register`.
 */
@Component({
  selector: 'app-auth-layout',
  standalone: true,
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './auth-layout.html',
})
export class AuthLayout {
  readonly currentYear = new Date().getFullYear();
}
