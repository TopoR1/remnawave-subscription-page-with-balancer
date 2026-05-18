import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';

import type { ToporBalancerNodeStatus } from './types';

import { ToporBalancerAdminGuard } from './topor-balancer-admin.guard';
import { ToporBalancerService } from './topor-balancer.service';

@UseGuards(ToporBalancerAdminGuard)
@Controller('api/topor-balancer')
export class ToporBalancerAdminController {
    constructor(private readonly toporBalancerService: ToporBalancerService) {}

    @Get('health')
    public async health() {
        return this.toporBalancerService.getAdminHealth();
    }

    @Get('nodes')
    public async nodes() {
        return this.toporBalancerService.listAdminNodes();
    }

    @Patch('nodes/:id')
    public async updateNode(
        @Param('id') id: string,
        @Body()
        body: {
            weight?: number;
            maxUsers?: number;
            status?: ToporBalancerNodeStatus;
            publicName?: string;
        },
    ) {
        return this.toporBalancerService.updateAdminNode(id, {
            weight: body.weight,
            maxUsers: body.maxUsers,
            status: body.status,
            publicName: body.publicName,
        });
    }

    @Get('assignments')
    public async assignments(
        @Query('shortUuid') shortUuid?: string,
        @Query('publicHostCode') publicHostCode?: string,
        @Query('planCode') planCode?: string,
        @Query('nodeId') nodeId?: string,
    ) {
        return this.toporBalancerService.listAdminAssignments({
            shortUuid,
            publicHostCode,
            planCode,
            nodeId,
        });
    }

    @Get('requests')
    public async requests(@Query('shortUuid') shortUuid?: string) {
        return this.toporBalancerService.listAdminRequests({
            shortUuid,
        });
    }

    @Post('reassign')
    public async reassign(
        @Body()
        body: {
            shortUuid: string;
            publicHostCode: string;
            planCode: string;
            technicalHostName: string;
        },
    ) {
        return this.toporBalancerService.reassignAdminAssignment(body);
    }

    @Post('nodes/:id/drain')
    public async drainNode(@Param('id') id: string) {
        return this.toporBalancerService.setAdminNodeStatus(id, 'draining');
    }

    @Post('nodes/:id/enable')
    public async enableNode(@Param('id') id: string) {
        return this.toporBalancerService.setAdminNodeStatus(id, 'active');
    }

    @Post('nodes/:id/disable')
    public async disableNode(@Param('id') id: string) {
        return this.toporBalancerService.setAdminNodeStatus(id, 'disabled');
    }
}
