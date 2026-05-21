import { Module } from '@nestjs/common';

import {
    ToporBalancerAdminController,
    ToporBalancerBootstrapController,
} from './topor-balancer-admin.controller';
import { ToporBalancerAdminGuard } from './topor-balancer-admin.guard';
import { ToporBalancerDiscoveryService } from './topor-balancer-discovery.service';
import { ToporBalancerService } from './topor-balancer.service';

@Module({
    controllers: [ToporBalancerBootstrapController, ToporBalancerAdminController],
    providers: [ToporBalancerService, ToporBalancerDiscoveryService, ToporBalancerAdminGuard],
    exports: [ToporBalancerService, ToporBalancerAdminGuard],
})
export class ToporBalancerModule {}
