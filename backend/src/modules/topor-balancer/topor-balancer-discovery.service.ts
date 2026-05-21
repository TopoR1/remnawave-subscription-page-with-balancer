import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AxiosService } from '../../common/axios';

import type {
    ToporBalancerDiscoveredHost,
    ToporBalancerDiscoveryImportInput,
    ToporBalancerDiscoveryImportResult,
    ToporBalancerDiscoveryResponse,
    ToporBalancerGroupDiscoveryItem,
    ToporBalancerGroupDiscoveryResponse,
} from './types';

import { parseSubscription } from './topor-balancer-subscription.parser';
import { ToporBalancerService } from './topor-balancer.service';

@Injectable()
export class ToporBalancerDiscoveryService {
    private readonly logger = new Logger(ToporBalancerDiscoveryService.name);

    constructor(
        private readonly axiosService: AxiosService,
        private readonly configService: ConfigService,
        private readonly toporBalancerService: ToporBalancerService,
    ) {}

    public getPanelUrl(): string {
        return this.configService.getOrThrow<string>('REMNAWAVE_PANEL_URL');
    }

    public async discoverFromRemnawaveApi(): Promise<ToporBalancerDiscoveryResponse> {
        const [hostsResponse, nodesResponse, importedNodes] = await Promise.all([
            this.axiosService.getRemnawaveHosts(),
            this.axiosService.getRemnawaveNodes(),
            this.getImportedNodesSafe(),
        ]);

        if (!hostsResponse.isOk || !hostsResponse.response) {
            throw new ServiceUnavailableException('Remnawave hosts API discovery failed');
        }

        const remnawaveNodes = new Map<string, string>();

        if (nodesResponse.isOk && nodesResponse.response) {
            for (const node of nodesResponse.response.response) {
                remnawaveNodes.set(node.uuid, node.name);
            }
        }

        const items = hostsResponse.response.response
            .filter((host) => this.normalizeTechnicalHostName(host.remark).length > 0)
            .map((host): ToporBalancerDiscoveredHost => {
                const technicalHostName = this.normalizeTechnicalHostName(host.remark);
                const matchedNode = importedNodes.get(technicalHostName);
                const firstRemnawaveNodeUuid = host.nodes[0];

                return {
                    alreadyImported: Boolean(matchedNode),
                    host: host.address,
                    matchedGroupId: matchedNode?.groupId,
                    matchedGroupPlanCode: matchedNode?.planCode,
                    matchedGroupPublicHostCode: matchedNode?.publicHostCode,
                    matchedNodeId: matchedNode?.id ?? null,
                    port: host.port,
                    protocol: 'vless',
                    rawRemark: host.remark,
                    remnawaveNodeName: firstRemnawaveNodeUuid
                        ? remnawaveNodes.get(firstRemnawaveNodeUuid)
                        : undefined,
                    remnawaveNodeUuid: firstRemnawaveNodeUuid
                        ? this.maskSecret(firstRemnawaveNodeUuid)
                        : undefined,
                    security: host.securityLayer.toLowerCase(),
                    sni: host.sni ?? undefined,
                    technicalHostName,
                };
            });

        return {
            source: 'remnawave-api',
            items: this.deduplicateByTechnicalHostName(items),
        };
    }

    public async discoverFromSubscription(shortUuid: string): Promise<ToporBalancerDiscoveryResponse> {
        const normalizedShortUuid = shortUuid.trim();

        if (!normalizedShortUuid) {
            throw new BadRequestException('shortUuid is required');
        }

        const subscriptionResponse = await this.axiosService.getSubscription(
            '127.0.0.1',
            normalizedShortUuid,
            {},
        );

        if (!subscriptionResponse) {
            throw new ServiceUnavailableException('Remnawave subscription discovery failed');
        }

        const body = this.stringifySubscriptionBody(subscriptionResponse.response);

        if (body === null) {
            throw new BadRequestException('Subscription response is not a text body');
        }

        const importedNodes = await this.getImportedNodesSafe();
        const parsedSubscription = parseSubscription(body, this.getContentType(subscriptionResponse.headers));
        const items = parsedSubscription.links
            .filter((link) => Boolean(link.remark))
            .map((link): ToporBalancerDiscoveredHost => {
                const technicalHostName = this.normalizeTechnicalHostName(link.remark ?? '');
                const matchedNode = importedNodes.get(technicalHostName);

                return {
                    alreadyImported: Boolean(matchedNode),
                    flow: link.flow,
                    host: link.host,
                    matchedGroupId: matchedNode?.groupId,
                    matchedGroupPlanCode: matchedNode?.planCode,
                    matchedGroupPublicHostCode: matchedNode?.publicHostCode,
                    matchedNodeId: matchedNode?.id ?? null,
                    pbk: this.maskSecret(link.pbk),
                    port: link.port,
                    protocol: 'vless',
                    rawRemark: link.remark,
                    security: link.security,
                    sid: this.maskSecret(link.sid),
                    sni: link.sni,
                    technicalHostName,
                    type: link.type,
                };
            });

        this.logger.log(
            `[ToporBalancerDiscovery] parsed subscription ${this.maskSecret(normalizedShortUuid)} with ${items.length} VLESS items`,
        );

        return {
            source: 'subscription',
            shortUuid: this.maskSecret(normalizedShortUuid),
            items: this.deduplicateByTechnicalHostName(items),
        };
    }

    public async discoverGroupFromRemnawaveApi(
        groupId: string,
    ): Promise<ToporBalancerGroupDiscoveryResponse> {
        const response = await this.discoverFromRemnawaveApi();

        return this.mapDiscoveryResponseToGroup(groupId, response);
    }

    public async refreshGroupFromRemnawaveApi(
        groupId: string,
    ): Promise<ToporBalancerGroupDiscoveryResponse> {
        try {
            return await this.discoverGroupFromRemnawaveApi(groupId);
        } catch (error) {
            const group = await this.toporBalancerService.getAdminGroup(groupId);

            this.logger.warn(`[ToporBalancerDiscovery] Remnawave API group refresh failed: ${error}`);

            return {
                group: this.mapGroupSummary(group),
                items: [],
                message: 'Remnawave API discovery is not available; use subscription scan.',
                source: 'remnawave-api',
            };
        }
    }

    public async discoverGroupFromSubscription(
        groupId: string,
        shortUuid: string,
    ): Promise<ToporBalancerGroupDiscoveryResponse> {
        const response = await this.discoverFromSubscription(shortUuid);

        return this.mapDiscoveryResponseToGroup(groupId, response);
    }

    public async importDiscoveredNodes(
        input: ToporBalancerDiscoveryImportInput,
    ): Promise<ToporBalancerDiscoveryImportResult> {
        return this.toporBalancerService.importDiscoveredNodes(input);
    }

    private async mapDiscoveryResponseToGroup(
        groupId: string,
        response: ToporBalancerDiscoveryResponse,
    ): Promise<ToporBalancerGroupDiscoveryResponse> {
        const group = await this.toporBalancerService.getAdminGroup(groupId);
        const importedNodes = await this.toporBalancerService.listAdminNodes();
        const items = response.items.map((item) =>
            this.mapDiscoveredHostToGroupItem(item, group.id, importedNodes),
        );

        return {
            group: this.mapGroupSummary(group),
            items,
            shortUuid: response.shortUuid,
            source: response.source,
        };
    }

    private mapDiscoveredHostToGroupItem(
        item: ToporBalancerDiscoveredHost,
        groupId: string,
        importedNodes: Awaited<ReturnType<ToporBalancerService['listAdminNodes']>>,
    ): ToporBalancerGroupDiscoveryItem {
        const technicalHostName = this.normalizeTechnicalHostName(item.technicalHostName);
        const matchingNodes = importedNodes.filter(
            (node) => this.normalizeTechnicalHostName(node.technicalHostName) === technicalHostName,
        );
        const nodeInThisGroup = matchingNodes.find((node) => node.groupId === groupId);
        const nodesInOtherGroups = matchingNodes.filter((node) => node.groupId !== groupId);

        if (nodeInThisGroup) {
            return {
                ...item,
                alreadyImported: true,
                canAdd: false,
                currentGroupId: nodeInThisGroup.groupId ?? null,
                currentGroupName: nodeInThisGroup.publicName,
                matchedGroupId: nodeInThisGroup.groupId,
                matchedGroupPlanCode: nodeInThisGroup.planCode,
                matchedGroupPublicHostCode: nodeInThisGroup.publicHostCode,
                matchedNodeId: nodeInThisGroup.id,
                status: 'in_this_group',
                technicalHostName,
            };
        }

        if (nodesInOtherGroups.length === 1) {
            const nodeInOtherGroup = nodesInOtherGroups[0];

            return {
                ...item,
                alreadyImported: true,
                canAdd: false,
                currentGroupId: nodeInOtherGroup.groupId ?? null,
                currentGroupName: nodeInOtherGroup.publicName,
                matchedGroupId: nodeInOtherGroup.groupId,
                matchedGroupPlanCode: nodeInOtherGroup.planCode,
                matchedGroupPublicHostCode: nodeInOtherGroup.publicHostCode,
                matchedNodeId: nodeInOtherGroup.id,
                status: 'in_other_group',
                technicalHostName,
            };
        }

        if (nodesInOtherGroups.length > 1) {
            return {
                ...item,
                alreadyImported: true,
                canAdd: false,
                currentGroupId: null,
                currentGroupName: nodesInOtherGroups.map((node) => node.publicName).join(', '),
                matchedNodeId: null,
                status: 'conflict',
                technicalHostName,
            };
        }

        return {
            ...item,
            alreadyImported: false,
            canAdd: true,
            currentGroupId: null,
            currentGroupName: null,
            matchedGroupId: undefined,
            matchedGroupPlanCode: undefined,
            matchedGroupPublicHostCode: undefined,
            matchedNodeId: null,
            status: 'free',
            technicalHostName,
        };
    }

    private mapGroupSummary(group: {
        id: string;
        planCode: string;
        publicHostCode: string;
        publicName: string;
    }): ToporBalancerGroupDiscoveryResponse['group'] {
        return {
            id: group.id,
            planCode: group.planCode,
            publicHostCode: group.publicHostCode,
            publicName: group.publicName,
        };
    }

    private async getImportedNodesSafe() {
        try {
            const nodes = await this.toporBalancerService.listAdminNodes();

            return new Map(
                nodes.map((node) => [this.normalizeTechnicalHostName(node.technicalHostName), node]),
            );
        } catch (error) {
            this.logger.warn(`[ToporBalancerDiscovery] local node lookup failed: ${error}`);

            return new Map();
        }
    }

    private deduplicateByTechnicalHostName(
        items: ToporBalancerDiscoveredHost[],
    ): ToporBalancerDiscoveredHost[] {
        return Array.from(
            new Map(
                items.map((item) => [
                    this.normalizeTechnicalHostName(item.technicalHostName),
                    {
                        ...item,
                        technicalHostName: this.normalizeTechnicalHostName(item.technicalHostName),
                    },
                ]),
            ).values(),
        );
    }

    private normalizeTechnicalHostName(value: string): string {
        return value.trim();
    }

    private stringifySubscriptionBody(body: unknown): string | null {
        if (typeof body === 'string') {
            return body;
        }

        if (Buffer.isBuffer(body)) {
            return body.toString('utf8');
        }

        return null;
    }

    private getContentType(headers: Record<string, unknown>): string | undefined {
        const contentType = headers['content-type'];

        return Array.isArray(contentType) ? contentType.join(', ') : contentType?.toString();
    }

    private maskSecret(value: string | undefined): string | undefined {
        if (!value) {
            return undefined;
        }

        if (value.length <= 8) {
            return `${value.slice(0, 2)}***`;
        }

        return `${value.slice(0, 4)}...${value.slice(-4)}`;
    }
}
