import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { AuthStateService } from '../auth/auth-state.service';
import { guestOnlyGuard } from './guest-only.guard';

describe('guestOnlyGuard', () => {
  let authState: jasmine.SpyObj<Pick<AuthStateService, 'isAuthenticated'>>;
  let router: Router;

  beforeEach(() => {
    authState = jasmine.createSpyObj('AuthStateService', ['isAuthenticated']);

    TestBed.configureTestingModule({
      providers: [{ provide: AuthStateService, useValue: authState }],
    });
    router = TestBed.inject(Router);
  });

  function runGuard() {
    return TestBed.runInInjectionContext(() => guestOnlyGuard({} as never, {} as never));
  }

  it('allows activation when not authenticated', () => {
    authState.isAuthenticated.and.returnValue(false);
    expect(runGuard()).toBe(true);
  });

  it('redirects an already-authenticated user to /app/dashboard', () => {
    authState.isAuthenticated.and.returnValue(true);
    const result = runGuard() as UrlTree;

    expect(result instanceof UrlTree).toBe(true);
    expect(router.serializeUrl(result)).toBe('/app/dashboard');
  });
});
