import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { catchError, of } from 'rxjs';
import { environment } from '../../../../../environments/environment';

interface ReadinessBody {
  status: 'ok' | 'error';
  database: 'connected' | 'unavailable';
  redis: 'connected' | 'unavailable';
}

/**
 * Placeholder landing page proving the foundation end to end (Angular ->
 * Nginx/CORS -> NestJS `/health/ready` -> Postgres/Redis) — not a business
 * feature. Real dashboard content lands in Milestone 9 (docs/
 * IMPLEMENTATION_ROADMAP.md Sprint 9.2).
 */
@Component({
  selector: 'app-dashboard-home-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard-home-page.html',
})
export class DashboardHomePage {
  private readonly http = inject(HttpClient);

  readonly readiness = signal<ReadinessBody | null>(null);
  readonly checkFailed = signal(false);

  constructor() {
    this.http
      .get<ReadinessBody>(`${environment.apiOrigin}/health/ready`)
      .pipe(
        catchError(() => {
          this.checkFailed.set(true);
          return of(null);
        }),
      )
      .subscribe((body) => this.readiness.set(body));
  }
}
