import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PermissionService } from '../../core/auth/permission.service';
import { HasPermissionDirective } from './has-permission.directive';

@Component({
  standalone: true,
  imports: [HasPermissionDirective],
  template: `<div *appHasPermission="'staff:invite'" class="protected">Invite Staff</div>`,
})
class HostComponent {}

describe('HasPermissionDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let canSignal: ReturnType<typeof signal<boolean>>;

  beforeEach(() => {
    canSignal = signal(false);
    const permissionService = jasmine.createSpyObj<PermissionService>('PermissionService', ['can']);
    permissionService.can.and.returnValue(canSignal.asReadonly());

    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [{ provide: PermissionService, useValue: permissionService }],
    });

    fixture = TestBed.createComponent(HostComponent);
  });

  it('does not render the host template when the permission is denied', () => {
    canSignal.set(false);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.protected')).toBeNull();
  });

  it('renders the host template when the permission is granted', () => {
    canSignal.set(true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.protected')).not.toBeNull();
  });

  it('reacts to the permission signal changing after initial render', () => {
    canSignal.set(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.protected')).toBeNull();

    canSignal.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.protected')).not.toBeNull();
  });
});
