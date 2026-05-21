import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AxiosService } from '../../common/axios';

import type {
    ToporBalancerDiscoveredHost,
    ToporBalancerDiscoveryImportInput,
    ToporBalancerDiscoveryImportResult,
    ToporBalancerDiscoveryResponse,
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
            .filter((host) => host.remark.trim().length > 0)
            .map((host): ToporBalancerDiscoveredHost => {
                const matchedNode = importedNodes.get(host.remark);
                const firstRemnawaveNodeUuid = host.nodes[0];

                return {
                    alreadyImported: Boolean(matchedNode),
                    host: host.address,
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
                    technicalHostName: host.remark,
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
                const technicalHostName = link.remark ?? '';
                const matchedNode = importedNodes.get(technicalHostName);

                return {
                    alreadyImported: Boolean(matchedNode),
                    flow: link.flow,
                    host: link.host,
                    matchedNodeId: matchedNode?.id ?? null,
                    pbk: this.maskSecret(link.pbk),
                    port: link.port,
                    protocol: 'vless',
                    rawRemark: technicalHostName,
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

    public async importDiscoveredNodes(
        input: ToporBalancerDiscoveryImportInput,
    ): Promise<ToporBalancerDiscoveryImportResult> {
        return this.toporBalancerService.importDiscoveredNodes(input);
    }

    private async getImportedNodesSafe() {
        try {
            const nodes = await this.toporBalancerService.listAdminNodes();

            return new Map(nodes.map((node) => [node.technicalHostName, node]));
        } catch (error) {
            this.logger.warn(`[ToporBalancerDiscovery] local node lookup failed: ${error}`);

            return new Map();
        }
    }

    private deduplicateByTechnicalHostName(
        items: ToporBalancerDiscoveredHost[],
    ): ToporBalancerDiscoveredHost[] {
        return Array.from(new Map(items.map((item) => [item.technicalHostName, item])).values());
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
