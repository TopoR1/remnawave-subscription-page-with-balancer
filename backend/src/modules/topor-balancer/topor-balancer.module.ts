import { Module } from '@nestjs/common';

import { AxiosModule } from '../../common/axios';

import {
    ToporBalancerAdminController,
    ToporBalancerBootstrapController,
} from './topor-balancer-admin.controller';
import { ToporBalancerAdminGuard } from './topor-balancer-admin.guard';
import { ToporBalancerDiscoveryService } from './topor-balancer-discovery.service';
import { ToporBalancerService } from './topor-balancer.service';

@Module({
    imports: [AxiosModule],
    controllers: [ToporBalancerBootstrapController, ToporBalancerAdminController],
    providers: [ToporBalancerService, ToporBalancerDiscoveryService, ToporBalancerAdminGuard],
    exports: [ToporBalancerService, ToporBalancerAdminGuard],
})
export class ToporBalancerModule {}
