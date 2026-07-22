import { Module } from '@nestjs/common';
import { CoreModule } from '../../../../src/core/core.module';
import { AuthModule } from '../../../../src/modules/auth/auth.module';
import { RbacProbeController } from './rbac-probe.controller';

/** Test-only — see `rbac-probe.controller.ts`'s doc comment. */
@Module({
  imports: [AuthModule, CoreModule],
  controllers: [RbacProbeController],
})
export class RbacProbeTestModule {}
