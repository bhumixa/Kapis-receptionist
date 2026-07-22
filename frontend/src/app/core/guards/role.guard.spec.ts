import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { User } from '../../shared/models/user.model';
import { AuthStateService } from '../auth/auth-state.service';
import { roleGuard } from './role.guard';

function makeUser(roles: User['roles']): User {
  return {
    id: 'user-1',
    email: 'user@salon.com',
    firstName: 'Ana',
    lastName: 'Ruiz',
    roles,
    isActive: true,
    isEmailVerified: true,
    lastLoginAt: null,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

describe('roleGuard', () => {
  let authState: jasmine.SpyObj<Pick<AuthStateService, 'currentUser'>>;
  let router: Router;

  beforeEach(() => {
    authState = jasmine.createSpyObj('AuthStateService', ['currentUser']);

    TestBed.configureTestingModule({
      providers: [{ provide: AuthStateService, useValue: authState }],
    });
    router = TestBed.inject(Router);
  });

  function runGuard(roles?: string[]) {
    return TestBed.runInInjectionContext(() =>
      roleGuard(
        { data: { roles } } as unknown as ActivatedRouteSnapshot,
        {} as RouterStateSnapshot,
      ),
    );
  }

  it('allows activation when the route declares no required roles', () => {
    authState.currentUser.and.returnValue(makeUser(['STAFF']));
    expect(runGuard(undefined)).toBe(true);
  });

  it('allows activation for an exact role match', () => {
    authState.currentUser.and.returnValue(makeUser(['MANAGER']));
    expect(runGuard(['MANAGER'])).toBe(true);
  });

  it('allows activation for a higher-ranked role', () => {
    authState.currentUser.and.returnValue(makeUser(['OWNER']));
    expect(runGuard(['MANAGER'])).toBe(true);
  });

  it('redirects to /403 for a lower-ranked role', () => {
    authState.currentUser.and.returnValue(makeUser(['STAFF']));
    const result = runGuard(['MANAGER']) as UrlTree;

    expect(result instanceof UrlTree).toBe(true);
    expect(router.serializeUrl(result)).toBe('/403');
  });

  it('redirects to /403 when no user is present', () => {
    authState.currentUser.and.returnValue(null);
    const result = runGuard(['MANAGER']) as UrlTree;

    expect(result instanceof UrlTree).toBe(true);
    expect(router.serializeUrl(result)).toBe('/403');
  });
});
