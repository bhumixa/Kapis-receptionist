import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { Tenant, TenantStatus } from '../../shared/models/tenant.model';
import { AuthStateService } from '../auth/auth-state.service';
import { tenantActiveGuard } from './tenant-active.guard';

function makeTenant(status: TenantStatus): Tenant {
  return {
    id: 'tenant-1',
    name: 'Bella Salon',
    slug: 'bella-salon',
    status,
    timezone: 'UTC',
    addressLine1: null,
    city: null,
    countryCode: null,
    defaultLocale: 'en',
    logoUrl: null,
    trialEndsAt: null,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

describe('tenantActiveGuard', () => {
  let authState: jasmine.SpyObj<Pick<AuthStateService, 'currentTenant'>>;
  let router: Router;

  beforeEach(() => {
    authState = jasmine.createSpyObj('AuthStateService', ['currentTenant']);

    TestBed.configureTestingModule({
      providers: [{ provide: AuthStateService, useValue: authState }],
    });
    router = TestBed.inject(Router);
  });

  function runGuard() {
    return TestBed.runInInjectionContext(() => tenantActiveGuard({} as never, {} as never));
  }

  it('allows activation when there is no current tenant (e.g. a non-impersonating SUPER_ADMIN)', () => {
    authState.currentTenant.and.returnValue(null);
    expect(runGuard()).toBe(true);
  });

  it('allows activation for an ACTIVE tenant', () => {
    authState.currentTenant.and.returnValue(makeTenant('ACTIVE'));
    expect(runGuard()).toBe(true);
  });

  it('allows activation for a TRIAL tenant', () => {
    authState.currentTenant.and.returnValue(makeTenant('TRIAL'));
    expect(runGuard()).toBe(true);
  });

  it('allows activation for a PAST_DUE tenant (grace period — stays functional)', () => {
    authState.currentTenant.and.returnValue(makeTenant('PAST_DUE'));
    expect(runGuard()).toBe(true);
  });

  it('redirects to /app/billing for a SUSPENDED tenant', () => {
    authState.currentTenant.and.returnValue(makeTenant('SUSPENDED'));
    const result = runGuard() as UrlTree;

    expect(result instanceof UrlTree).toBe(true);
    expect(router.serializeUrl(result)).toBe('/app/billing');
  });

  it('redirects to /app/billing for a CANCELLED tenant', () => {
    authState.currentTenant.and.returnValue(makeTenant('CANCELLED'));
    const result = runGuard() as UrlTree;

    expect(result instanceof UrlTree).toBe(true);
    expect(router.serializeUrl(result)).toBe('/app/billing');
  });
});
