import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';

import type { ToporBalancerGroupStrategy, ToporBalancerNodeStatus } from './types';

import { ToporBalancerAdminGuard } from './topor-balancer-admin.guard';
import { ToporBalancerDiscoveryService } from './topor-balancer-discovery.service';
import { ToporBalancerService } from './topor-balancer.service';

@Controller('api/topor-balancer')
export class ToporBalancerBootstrapController {
    constructor(private readonly toporBalancerService: ToporBalancerService) {}

    @Get('bootstrap')
    public async bootstrap() {
        return this.toporBalancerService.getBootstrap();
    }
}

@UseGuards(ToporBalancerAdminGuard)
@Controller('api/topor-balancer')
export class ToporBalancerAdminController {
    constructor(
        private readonly toporBalancerService: ToporBalancerService,
        private readonly toporBalancerDiscoveryService: ToporBalancerDiscoveryService,
    ) {}

    @Get('health')
    public async health() {
        const health = await this.toporBalancerService.getAdminHealth();

        return {
            ...health,
            remnawavePanelUrl: this.toporBalancerDiscoveryService.getPanelUrl(),
        };
    }

    @Get('nodes')
    public async nodes() {
        return this.toporBalancerService.listAdminNodes();
    }

    @Get('groups')
    public async groups() {
        return this.toporBalancerService.listAdminGroups();
    }

    @Post('groups')
    public async createGroup(
        @Body()
        body: {
            publicHostCode: string;
            publicName: string;
            locationCode?: string;
            planCode: string;
            strategy?: ToporBalancerGroupStrategy;
            enabled?: boolean;
        },
    ) {
        return this.toporBalancerService.createAdminGroup({
            enabled: body.enabled ?? true,
            locationCode: body.locationCode,
            planCode: body.planCode,
            publicHostCode: body.publicHostCode,
            publicName: body.publicName,
            strategy: body.strategy ?? 'least_loaded',
        });
    }

    @Patch('groups/:id')
    public async updateGroup(
        @Param('id') id: string,
        @Body()
        body: {
            publicHostCode?: string;
            publicName?: string;
            locationCode?: string;
            planCode?: string;
            strategy?: ToporBalancerGroupStrategy;
            enabled?: boolean;
        },
    ) {
        return this.toporBalancerService.updateAdminGroup(id, body);
    }

    @Delete('groups/:id')
    public async deleteGroup(@Param('id') id: string) {
        return this.toporBalancerService.deleteAdminGroup(id);
    }

    @Get('groups/:id/nodes')
    public async groupNodes(@Param('id') id: string) {
        return this.toporBalancerService.listAdminGroupNodes(id);
    }

    @Post('groups/:id/nodes')
    public async createGroupNode(
        @Param('id') id: string,
        @Body()
        body: {
            technicalHostName: string;
            weight?: number;
            maxUsers?: number;
            status?: ToporBalancerNodeStatus;
        },
    ) {
        return this.toporBalancerService.createAdminGroupNode(id, {
            maxUsers: body.maxUsers ?? 300,
            status: body.status ?? 'active',
            technicalHostName: body.technicalHostName,
            weight: body.weight ?? 1,
        });
    }

    @Patch('groups/:id/nodes/:nodeId')
    public async updateGroupNode(
        @Param('id') id: string,
        @Param('nodeId') nodeId: string,
        @Body()
        body: {
            technicalHostName?: string;
            weight?: number;
            maxUsers?: number;
            status?: ToporBalancerNodeStatus;
        },
    ) {
        return this.toporBalancerService.updateAdminGroupNode(id, nodeId, body);
    }

    @Delete('groups/:id/nodes/:nodeId')
    public async deleteGroupNode(@Param('id') id: string, @Param('nodeId') nodeId: string) {
        return this.toporBalancerService.deleteAdminGroupNode(id, nodeId);
    }

    @Post('nodes')
    public async createNode(
        @Body()
        body: {
            technicalHostName: string;
            publicHostCode: string;
            publicName: string;
            locationCode?: string;
            planCode: string;
            weight: number;
            maxUsers: number;
            status: ToporBalancerNodeStatus;
        },
    ) {
        return this.toporBalancerService.createAdminNode(body);
    }

    @Patch('nodes/:id')
    public async updateNode(
        @Param('id') id: string,
        @Body()
        body: {
            technicalHostName?: string;
            publicHostCode?: string;
            weight?: number;
            maxUsers?: number;
            status?: ToporBalancerNodeStatus;
            publicName?: string;
            locationCode?: string;
            planCode?: string;
        },
    ) {
        return this.toporBalancerService.updateAdminNode(id, {
            technicalHostName: body.technicalHostName,
            publicHostCode: body.publicHostCode,
            weight: body.weight,
            maxUsers: body.maxUsers,
            status: body.status,
            publicName: body.publicName,
            locationCode: body.locationCode,
            planCode: body.planCode,
        });
    }

    @Delete('nodes/:id')
    public async deleteNode(@Param('id') id: string) {
        return this.toporBalancerService.deleteAdminNode(id);
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

    @Get('discovery/remnawave')
    public async discoverFromRemnawaveApi() {
        return this.toporBalancerDiscoveryService.discoverFromRemnawaveApi();
    }

    @Post('discovery/subscription')
    public async discoverFromSubscription(@Body() body: { shortUuid: string }) {
        return this.toporBalancerDiscoveryService.discoverFromSubscription(body.shortUuid);
    }

    @Post('discovery/import')
    public async importDiscoveredNodes(
        @Body()
        body: {
            groupId?: string;
            group?: {
                publicHostCode: string;
                publicName: string;
                locationCode?: string;
                planCode: string;
            };
            publicHostCode?: string;
            publicName?: string;
            locationCode?: string;
            planCode?: string;
            nodes: Array<{
                technicalHostName: string;
                weight: number;
                maxUsers: number;
                status: ToporBalancerNodeStatus;
            }>;
        },
    ) {
        return this.toporBalancerDiscoveryService.importDiscoveredNodes(body);
    }

    @Post('debug/process-subscription')
    public async debugProcessSubscription(@Body() body: { shortUuid: string }) {
        return this.toporBalancerService.debugProcessSubscription(body.shortUuid);
    }

    @Post('diagnostics/subscription')
    public async diagnoseSubscription(@Body() body: { shortUuid: string; userAgent?: string }) {
        return this.toporBalancerService.diagnoseSubscription({
            shortUuid: body.shortUuid,
            userAgent: body.userAgent,
        });
    }
}
