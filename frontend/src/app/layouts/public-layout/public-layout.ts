import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * Chrome only — no business logic (docs/FRONTEND_ARCHITECTURE.md Section
 * 2.2). The real Public/Auth/Dashboard/Admin layout set (Section 4) fills
 * in as each milestone needs it; this is the minimal shell Milestone 1's
 * single placeholder route runs under.
 */
@Component({
  selector: 'app-public-layout',
  standalone: true,
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './public-layout.html',
})
export class PublicLayout {}
