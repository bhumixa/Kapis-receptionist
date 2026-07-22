import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { Tenant } from '../../shared/models/tenant.model';
import { User } from '../../shared/models/user.model';
import { AuthApiService } from './auth-api.service';
import { AuthStateService } from './auth-state.service';
import { SessionService } from './session.service';

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

describe('SessionService', () => {
  let authApi: jasmine.SpyObj<Pick<AuthApiService, 'refresh' | 'me' | 'logout'>>;
  let authState: jasmine.SpyObj<
    Pick<AuthStateService, 'setSession' | 'updateAccessToken' | 'clear'>
  >;
  let service: SessionService;

  beforeEach(() => {
    authApi = jasmine.createSpyObj('AuthApiService', ['refresh', 'me', 'logout']);
    authState = jasmine.createSpyObj('AuthStateService', [
      'setSession',
      'updateAccessToken',
      'clear',
    ]);

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthApiService, useValue: authApi },
        { provide: AuthStateService, useValue: authState },
      ],
    });
    service = TestBed.inject(SessionService);
  });

  describe('bootstrap()', () => {
    it('hydrates AuthStateService from a valid refresh cookie', (done) => {
      authApi.refresh.and.returnValue(of({ accessToken: 'jwt', expiresIn: 900 }));
      authApi.me.and.returnValue(of({ user, tenant }));

      service.bootstrap().subscribe((result) => {
        expect(result).toBe(true);
        expect(authState.setSession).toHaveBeenCalledWith(user, tenant, 'jwt');
        done();
      });
    });

    it('clears state and resolves false when there is no valid session', (done) => {
      authApi.refresh.and.returnValue(throwError(() => new Error('no cookie')));

      service.bootstrap().subscribe((result) => {
        expect(result).toBe(false);
        expect(authState.clear).toHaveBeenCalled();
        expect(authApi.me).not.toHaveBeenCalled();
        done();
      });
    });
  });

  describe('refreshAccessToken()', () => {
    it('updates AuthStateService with the rotated token', (done) => {
      authApi.refresh.and.returnValue(of({ accessToken: 'jwt-2', expiresIn: 900 }));

      service.refreshAccessToken().subscribe((token) => {
        expect(token).toBe('jwt-2');
        expect(authState.updateAccessToken).toHaveBeenCalledWith('jwt-2');
        done();
      });
    });

    it('shares one in-flight HTTP call across concurrent callers (refresh-storm prevention)', (done) => {
      authApi.refresh.and.returnValue(of({ accessToken: 'jwt-3', expiresIn: 900 }));

      const first = service.refreshAccessToken();
      const second = service.refreshAccessToken();

      let completed = 0;
      const onDone = () => {
        completed++;
        if (completed === 2) {
          expect(authApi.refresh).toHaveBeenCalledTimes(1);
          done();
        }
      };
      first.subscribe(onDone);
      second.subscribe(onDone);
    });

    it('issues a fresh call on the next refresh after the in-flight one settles', () => {
      // `of(...)` is a synchronous source, so by the time each `subscribe()`
      // call below returns, that call (including SessionService's
      // `finalize`, which clears `refreshInFlight$`) has already run to
      // completion — no `done()` needed, and asserting *inside* either
      // callback would race `finalize` (see the two tests below).
      authApi.refresh.and.returnValue(of({ accessToken: 'jwt-4', expiresIn: 900 }));

      service.refreshAccessToken().subscribe();
      service.refreshAccessToken().subscribe();

      expect(authApi.refresh).toHaveBeenCalledTimes(2);
    });
  });

  describe('logout()', () => {
    it('clears local state even though the API call already handled server-side revocation', () => {
      // Asserted synchronously after `subscribe()` returns, not inside its
      // callback: `finalize`'s cleanup runs on unsubscribe, which a
      // Subscriber triggers *after* the terminal (complete/error)
      // notification already reached this test's callback — asserting
      // inside that callback would read `clear` before it's actually been
      // called yet, a classic RxJS `finalize`-ordering pitfall.
      authApi.logout.and.returnValue(of({ message: 'Logged out.' }));

      service.logout().subscribe();

      expect(authState.clear).toHaveBeenCalled();
    });

    it('still clears local state if the logout call itself fails (e.g. network error)', () => {
      authApi.logout.and.returnValue(throwError(() => new Error('network down')));

      service.logout().subscribe({ error: () => undefined });

      expect(authState.clear).toHaveBeenCalled();
    });
  });
});
