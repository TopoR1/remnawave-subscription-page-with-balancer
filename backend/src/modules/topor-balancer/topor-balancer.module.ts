import { Module } from '@nestjs/common';

import {
    ToporBalancerAdminController,
    ToporBalancerBootstrapController,
} from './topor-balancer-admin.controller';
import { ToporBalancerAdminGuard } from './topor-balancer-admin.guard';
import { ToporBalancerService } from './topor-balancer.service';

@Module({
    controllers: [ToporBalancerBootstrapController, ToporBalancerAdminController],
    providers: [ToporBalancerService, ToporBalancerAdminGuard],
    exports: [ToporBalancerService],
})
export class ToporBalancerModule {}
