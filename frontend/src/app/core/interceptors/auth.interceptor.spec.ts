import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AuthStateService } from '../auth/auth-state.service';
import { SessionService } from '../auth/session.service';
import { authInterceptor } from './auth.interceptor';

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let authState: jasmine.SpyObj<Pick<AuthStateService, 'accessToken' | 'clear'>>;
  let sessionService: jasmine.SpyObj<Pick<SessionService, 'refreshAccessToken'>>;
  let router: Router;

  beforeEach(() => {
    authState = jasmine.createSpyObj('AuthStateService', ['accessToken', 'clear']);
    sessionService = jasmine.createSpyObj('SessionService', ['refreshAccessToken']);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AuthStateService, useValue: authState },
        { provide: SessionService, useValue: sessionService },
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => httpMock.verify());

  it('attaches the bearer token to outgoing requests when one is present', () => {
    authState.accessToken.and.returnValue('jwt-1');

    http.get('/api/v1/employees').subscribe();
    const req = httpMock.expectOne('/api/v1/employees');
    expect(req.request.headers.get('Authorization')).toBe('Bearer jwt-1');
    req.flush({});
  });

  it('sends no Authorization header when there is no token', () => {
    authState.accessToken.and.returnValue(null);

    http.get('/api/v1/employees').subscribe();
    const req = httpMock.expectOne('/api/v1/employees');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it('on a 401, refreshes once and transparently retries the original request', (done) => {
    authState.accessToken.and.returnValue('expired-jwt');
    sessionService.refreshAccessToken.and.returnValue(of('fresh-jwt'));

    http.get('/api/v1/employees').subscribe((body) => {
      expect(body).toEqual({ ok: true });
      expect(sessionService.refreshAccessToken).toHaveBeenCalledTimes(1);
      done();
    });

    const firstAttempt = httpMock.expectOne('/api/v1/employees');
    firstAttempt.flush(
      { error: { code: 'UNAUTHORIZED' } },
      { status: 401, statusText: 'Unauthorized' },
    );

    const retry = httpMock.expectOne('/api/v1/employees');
    expect(retry.request.headers.get('Authorization')).toBe('Bearer fresh-jwt');
    retry.flush({ ok: true });
  });

  it('clears the session and redirects to login when the refresh itself fails', (done) => {
    authState.accessToken.and.returnValue('expired-jwt');
    sessionService.refreshAccessToken.and.returnValue(
      throwError(() => new Error('refresh failed')),
    );
    const navigateSpy = spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));

    http.get('/api/v1/employees').subscribe({
      error: () => {
        expect(authState.clear).toHaveBeenCalled();
        expect(navigateSpy).toHaveBeenCalledWith(['/auth/login'], jasmine.any(Object));
        done();
      },
    });

    httpMock
      .expectOne('/api/v1/employees')
      .flush({ error: { code: 'UNAUTHORIZED' } }, { status: 401, statusText: 'Unauthorized' });
  });

  it('does not attempt a refresh loop when /auth/login itself returns 401', (done) => {
    authState.accessToken.and.returnValue(null);

    http.post('/api/v1/auth/login', {}).subscribe({
      error: () => {
        expect(sessionService.refreshAccessToken).not.toHaveBeenCalled();
        done();
      },
    });

    httpMock
      .expectOne('/api/v1/auth/login')
      .flush(
        { error: { code: 'INVALID_CREDENTIALS' } },
        { status: 401, statusText: 'Unauthorized' },
      );
  });
});
