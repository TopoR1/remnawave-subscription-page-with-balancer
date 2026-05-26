import { Injectable, Logger } from '@nestjs/common';

import { AxiosService } from '../../common/axios';

import type {
    ToporRemnawaveTopologyHost,
    ToporRemnawaveTopologyInbound,
    ToporRemnawaveTopologyNode,
    ToporRemnawaveTopologySnapshot,
    ToporRemnawaveTopologySquad,
} from './types';

import { ToporBalancerService } from './topor-balancer.service';

interface RawEndpointResult {
    body: unknown;
    ok: boolean;
    warning?: string;
}

export interface ToporRemnawaveGroupValidationResult {
    compatible: boolean;
    warnings: string[];
    nodes: Array<{
        technicalHostName: string;
        accessibleSquads: Array<{ name: string; uuid: string }>;
        compatible: boolean;
    }>;
}

@Injectable()
export class ToporRemnawaveTopologyService {
    private readonly logger = new Logger(ToporRemnawaveTopologyService.name);

    constructor(
        private readonly axiosService: AxiosService,
        private readonly toporBalancerService: ToporBalancerService,
    ) {}

    public async refreshTopology(): Promise<ToporRemnawaveTopologySnapshot> {
        const [
            hostsResult,
            nodesResult,
            profilesResult,
            inboundsResult,
            squadsResult,
        ] = await Promise.all([
            this.fetchRaw('/api/hosts'),
            this.fetchRaw('/api/nodes'),
            this.fetchRaw('/api/config-profiles'),
            this.fetchRaw('/api/config-profiles/inbounds'),
            this.fetchRaw('/api/internal-squads'),
        ]);
        const warnings = [
            hostsResult.warning,
            nodesResult.warning,
            profilesResult.warning,
            inboundsResult.warning,
            squadsResult.warning,
        ].filter((warning): warning is string => Boolean(warning));
        const nodes = this.normalizeNodes(nodesResult.body);
        const squads = this.normalizeSquads(squadsResult.body);
        const profiles = this.normalizeProfiles(profilesResult.body);
        const inbounds = this.normalizeInbounds(inboundsResult.body, profiles);
        const accessibleNodeUuidsBySquad = await this.fetchAccessibleNodeUuidsBySquad(squads, warnings);
        const hosts = this.normalizeHosts({
            hostsBody: hostsResult.body,
            inbounds,
            nodes,
            squads,
            accessibleNodeUuidsBySquad,
        });
        const snapshot: ToporRemnawaveTopologySnapshot = {
            hosts,
            inbounds,
            nodes,
            squads,
            warnings,
            refreshedAt: new Date().toISOString(),
        };

        await this.toporBalancerService.replaceRemnawaveTopologyCache(snapshot);
        this.logger.log(
            `[ToporRemnawaveTopology] cached ${hosts.length} hosts, ${nodes.length} nodes, ${inbounds.length} inbounds, ${squads.length} squads`,
        );

        return snapshot;
    }

    public async getCachedTopology(): Promise<ToporRemnawaveTopologySnapshot> {
        return this.toporBalancerService.getRemnawaveTopologyCache();
    }

    public async validateGroup(groupId: string): Promise<ToporRemnawaveGroupValidationResult> {
        const [group, groupNodes, topology] = await Promise.all([
            this.toporBalancerService.getAdminGroup(groupId),
            this.toporBalancerService.listAdminGroupNodes(groupId),
            this.getCachedTopology(),
        ]);
        const hostByRemark = new Map(topology.hosts.map((host) => [host.remark, host]));
        const nodes = groupNodes.map((node) => {
            const host = hostByRemark.get(node.technicalHostName);
            const compatible =
                group.squadScope !== 'specific_internal_squad' ||
                !group.internalSquadUuid ||
                Boolean(
                    host?.accessibleSquads.some(
                        (squad) => squad.uuid === group.internalSquadUuid,
                    ),
                );

            return {
                technicalHostName: node.technicalHostName,
                accessibleSquads: host?.accessibleSquads ?? [],
                compatible,
            };
        });
        const incompatibleNodes = nodes.filter((node) => !node.compatible);
        const warnings =
            incompatibleNodes.length > 0
                ? [
                      `Group contains nodes that are not accessible to selected squad: ${incompatibleNodes
                          .map((node) => node.technicalHostName)
                          .join(', ')}.`,
                  ]
                : [];

        return {
            compatible: warnings.length === 0,
            nodes,
            warnings,
        };
    }

    private async fetchRaw(endpoint: string): Promise<RawEndpointResult> {
        const response = await this.axiosService.getRemnawaveRawEndpoint(endpoint);

        if (!response.isOk) {
            return {
                body: undefined,
                ok: false,
                warning: `${endpoint} is unavailable.`,
            };
        }

        return {
            body: response.response,
            ok: true,
        };
    }

    private async fetchAccessibleNodeUuidsBySquad(
        squads: ToporRemnawaveTopologySquad[],
        warnings: string[],
    ): Promise<Map<string, Set<string>>> {
        const result = new Map<string, Set<string>>();

        for (const squad of squads) {
            const response = await this.axiosService.getRemnawaveRawEndpoint(
                `/api/internal-squads/${encodeURIComponent(squad.uuid)}/accessible-nodes`,
            );

            if (!response.isOk) {
                warnings.push(`Accessible nodes are unavailable for squad ${squad.name}.`);
                continue;
            }

            result.set(
                squad.uuid,
                new Set(
                    this.extractArray(response.response)
                        .map((item) => this.readString(item, ['uuid', 'id', 'nodeUuid']))
                        .filter((uuid): uuid is string => Boolean(uuid)),
                ),
            );
        }

        return result;
    }

    private normalizeHosts(input: {
        accessibleNodeUuidsBySquad: Map<string, Set<string>>;
        hostsBody: unknown;
        inbounds: ToporRemnawaveTopologyInbound[];
        nodes: ToporRemnawaveTopologyNode[];
        squads: ToporRemnawaveTopologySquad[];
    }): ToporRemnawaveTopologyHost[] {
        const nodeByUuid = new Map(input.nodes.map((node) => [node.uuid, node]));
        const inboundByUuid = new Map(input.inbounds.map((inbound) => [inbound.uuid, inbound]));

        return this.extractArray(input.hostsBody)
            .map((item): ToporRemnawaveTopologyHost | null => {
                const uuid = this.readString(item, ['uuid', 'id']);
                const remark = this.readString(item, ['remark', 'name', 'publicName']);

                if (!uuid || !remark) {
                    return null;
                }

                const nodeUuid =
                    this.readString(item, ['nodeUuid', 'node_uuid']) ??
                    this.readStringArray(item, ['nodes', 'nodeUuids', 'node_uuids'])[0];
                const inboundUuid = this.readString(item, ['inboundUuid', 'inbound_uuid']);
                const inbound = inboundUuid ? inboundByUuid.get(inboundUuid) : undefined;
                const node = nodeUuid ? nodeByUuid.get(nodeUuid) : undefined;
                const accessibleSquads = input.squads.filter((squad) => {
                    const accessibleNodeUuids = input.accessibleNodeUuidsBySquad.get(squad.uuid);

                    return Boolean(nodeUuid && accessibleNodeUuids?.has(nodeUuid));
                });

                return {
                    uuid,
                    remark,
                    address: this.readString(item, ['address', 'host']),
                    flow: this.readString(item, ['flow']),
                    inboundUuid,
                    lastSeenAt: new Date().toISOString(),
                    nodeUuid,
                    nodeName: node?.name,
                    port: this.readNumber(item, ['port']),
                    protocol: 'vless',
                    profileUuid: inbound?.profileUuid,
                    profileName: inbound?.profileName,
                    security: this.readString(item, ['security', 'securityLayer', 'security_layer'])?.toLowerCase(),
                    sni: this.readString(item, ['sni', 'serverName', 'server_name']),
                    transport: this.readString(item, ['type', 'transport', 'network']),
                    inboundName: inbound?.name,
                    accessibleSquads,
                };
            })
            .filter((host): host is ToporRemnawaveTopologyHost => Boolean(host));
    }

    private normalizeNodes(body: unknown): ToporRemnawaveTopologyNode[] {
        return this.extractArray(body)
            .map((item): ToporRemnawaveTopologyNode | null => {
                const uuid = this.readString(item, ['uuid', 'id']);
                const name = this.readString(item, ['name', 'nodeName']);

                if (!uuid || !name) {
                    return null;
                }

                return {
                    uuid,
                    name,
                    address: this.readString(item, ['address', 'host']),
                    status: this.readString(item, ['status']),
                };
            })
            .filter((node): node is ToporRemnawaveTopologyNode => Boolean(node));
    }

    private normalizeProfiles(body: unknown): Map<string, string> {
        return new Map(
            this.extractArray(body)
                .map((item): [string, string] | null => {
                    const uuid = this.readString(item, ['uuid', 'id']);
                    const name = this.readString(item, ['name', 'profileName']);

                    return uuid && name ? [uuid, name] : null;
                })
                .filter((item): item is [string, string] => Boolean(item)),
        );
    }

    private normalizeInbounds(
        body: unknown,
        profiles: Map<string, string>,
    ): ToporRemnawaveTopologyInbound[] {
        return this.extractArray(body)
            .map((item): ToporRemnawaveTopologyInbound | null => {
                const uuid = this.readString(item, ['uuid', 'id', 'inboundUuid']);
                const name = this.readString(item, ['name', 'tag', 'remark']) ?? uuid;

                if (!uuid || !name) {
                    return null;
                }

                const profileUuid = this.readString(item, [
                    'profileUuid',
                    'configProfileUuid',
                    'config_profile_uuid',
                ]);

                return {
                    uuid,
                    name,
                    profileUuid,
                    profileName: profileUuid ? profiles.get(profileUuid) : undefined,
                };
            })
            .filter((inbound): inbound is ToporRemnawaveTopologyInbound => Boolean(inbound));
    }

    private normalizeSquads(body: unknown): ToporRemnawaveTopologySquad[] {
        return this.extractArray(body)
            .map((item): ToporRemnawaveTopologySquad | null => {
                const uuid = this.readString(item, ['uuid', 'id']);
                const name = this.readString(item, ['name', 'title']);

                return uuid && name ? { uuid, name } : null;
            })
            .filter((squad): squad is ToporRemnawaveTopologySquad => Boolean(squad));
    }

    private extractArray(body: unknown): unknown[] {
        if (Array.isArray(body)) {
            return body;
        }

        if (!body || typeof body !== 'object') {
            return [];
        }

        const record = body as Record<string, unknown>;

        for (const key of ['response', 'items', 'data']) {
            const value = record[key];

            if (Array.isArray(value)) {
                return value;
            }

            if (value && typeof value === 'object') {
                const nested = value as Record<string, unknown>;

                for (const nestedKey of ['items', 'hosts', 'nodes', 'inbounds', 'internalSquads']) {
                    if (Array.isArray(nested[nestedKey])) {
                        return nested[nestedKey] as unknown[];
                    }
                }
            }
        }

        return [];
    }

    private readString(item: unknown, keys: string[]): string | undefined {
        if (!item || typeof item !== 'object') {
            return undefined;
        }

        const record = item as Record<string, unknown>;

        for (const key of keys) {
            const value = record[key];

            if (typeof value === 'string' && value.trim()) {
                return value.trim();
            }
        }

        return undefined;
    }

    private readStringArray(item: unknown, keys: string[]): string[] {
        if (!item || typeof item !== 'object') {
            return [];
        }

        const record = item as Record<string, unknown>;

        for (const key of keys) {
            const value = record[key];

            if (Array.isArray(value)) {
                return value.filter((part): part is string => typeof part === 'string');
            }
        }

        return [];
    }

    private readNumber(item: unknown, keys: string[]): number | undefined {
        if (!item || typeof item !== 'object') {
            return undefined;
        }

        const record = item as Record<string, unknown>;

        for (const key of keys) {
            const value = record[key];

            if (typeof value === 'number' && Number.isFinite(value)) {
                return value;
            }

            if (typeof value === 'string' && value.trim()) {
                const parsed = Number(value);

                if (Number.isFinite(parsed)) {
                    return parsed;
                }
            }
        }

        return undefined;
    }
}
