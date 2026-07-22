import { TestBed } from '@angular/core/testing';
import { User } from '../../shared/models/user.model';
import { AuthStateService } from './auth-state.service';
import { PermissionService } from './permission.service';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'user@salon.com',
    firstName: 'Ana',
    lastName: 'Ruiz',
    roles: ['STAFF'],
    isActive: true,
    isEmailVerified: true,
    lastLoginAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('PermissionService', () => {
  let authState: AuthStateService;
  let service: PermissionService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    authState = TestBed.inject(AuthStateService);
    service = TestBed.inject(PermissionService);
  });

  it('reports false for every permission when no user is authenticated', () => {
    expect(service.can('staff:invite')()).toBe(false);
  });

  it('reports false for a permission STAFF does not hold', () => {
    authState.setSession(makeUser({ roles: ['STAFF'] }), null, 'token');
    expect(service.can('staff:invite')()).toBe(false);
  });

  it('reports true for a permission MANAGER holds', () => {
    authState.setSession(makeUser({ roles: ['MANAGER'] }), null, 'token');
    expect(service.can('staff:invite')()).toBe(true);
  });

  it('reports true for SUPER_ADMIN on every known permission', () => {
    authState.setSession(makeUser({ roles: ['SUPER_ADMIN'] }), null, 'token');
    expect(service.can('billing:manage')()).toBe(true);
    expect(service.can('staff:invite')()).toBe(true);
  });

  it('reacts to session changes (signal-reactive, not a one-time snapshot)', () => {
    const can = service.can('staff:invite');
    expect(can()).toBe(false);

    authState.setSession(makeUser({ roles: ['MANAGER'] }), null, 'token');
    expect(can()).toBe(true);

    authState.clear();
    expect(can()).toBe(false);
  });
});
