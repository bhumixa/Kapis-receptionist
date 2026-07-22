import { Tenant } from '../../shared/models/tenant.model';
import { User } from '../../shared/models/user.model';
import { AuthStateService } from './auth-state.service';

const user: User = {
  id: 'user-1',
  email: 'owner@salon.com',
  firstName: 'Maria',
  lastName: 'Gomez',
  roles: ['OWNER'],
  isActive: true,
  isEmailVerified: false,
  lastLoginAt: null,
  createdAt: '2026-01-01T00:00:00Z',
};

const tenant: Tenant = {
  id: 'tenant-1',
  name: 'Bella Salon',
  slug: 'bella-salon',
  status: 'TRIAL',
  timezone: 'UTC',
  addressLine1: null,
  city: null,
  countryCode: null,
  defaultLocale: 'en',
  logoUrl: null,
  trialEndsAt: null,
  createdAt: '2026-01-01T00:00:00Z',
};

describe('AuthStateService', () => {
  let service: AuthStateService;

  beforeEach(() => {
    service = new AuthStateService();
  });

  it('starts unauthenticated with no user/tenant/token', () => {
    expect(service.isAuthenticated()).toBe(false);
    expect(service.currentUser()).toBeNull();
    expect(service.currentTenant()).toBeNull();
    expect(service.accessToken()).toBeNull();
  });

  it('setSession() populates all three signals and flips isAuthenticated', () => {
    service.setSession(user, tenant, 'jwt-token');

    expect(service.currentUser()).toEqual(user);
    expect(service.currentTenant()).toEqual(tenant);
    expect(service.accessToken()).toBe('jwt-token');
    expect(service.isAuthenticated()).toBe(true);
  });

  it('setSession() accepts a null tenant (e.g. a future SUPER_ADMIN session)', () => {
    service.setSession(user, null, 'jwt-token');
    expect(service.currentTenant()).toBeNull();
    expect(service.isAuthenticated()).toBe(true);
  });

  it('updateAccessToken() rotates only the token, leaving identity untouched', () => {
    service.setSession(user, tenant, 'jwt-token');
    service.updateAccessToken('jwt-token-rotated');

    expect(service.accessToken()).toBe('jwt-token-rotated');
    expect(service.currentUser()).toEqual(user);
    expect(service.currentTenant()).toEqual(tenant);
  });

  it('clear() resets every signal and isAuthenticated becomes false', () => {
    service.setSession(user, tenant, 'jwt-token');
    service.clear();

    expect(service.currentUser()).toBeNull();
    expect(service.currentTenant()).toBeNull();
    expect(service.accessToken()).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
  });
});
