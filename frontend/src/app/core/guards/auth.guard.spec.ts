import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { AuthStateService } from '../auth/auth-state.service';
import { authGuard } from './auth.guard';

describe('authGuard', () => {
  let authState: jasmine.SpyObj<Pick<AuthStateService, 'isAuthenticated'>>;
  let router: Router;

  beforeEach(() => {
    authState = jasmine.createSpyObj('AuthStateService', ['isAuthenticated']);

    TestBed.configureTestingModule({
      providers: [{ provide: AuthStateService, useValue: authState }],
    });
    router = TestBed.inject(Router);
  });

  function runGuard(url: string) {
    return TestBed.runInInjectionContext(() =>
      authGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
    );
  }

  it('allows activation when authenticated', () => {
    authState.isAuthenticated.and.returnValue(true);
    expect(runGuard('/app/dashboard')).toBe(true);
  });

  it('redirects to /auth/login with a returnUrl when not authenticated', () => {
    authState.isAuthenticated.and.returnValue(false);
    const result = runGuard('/app/dashboard') as UrlTree;

    expect(result instanceof UrlTree).toBe(true);
    expect(router.serializeUrl(result)).toBe('/auth/login?returnUrl=%2Fapp%2Fdashboard');
  });
});
