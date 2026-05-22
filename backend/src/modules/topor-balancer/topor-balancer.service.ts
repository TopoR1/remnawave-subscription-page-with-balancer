import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
    OnModuleDestroy,
    OnModuleInit,
    ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AxiosService } from '../../common/axios';

import type {
    ToporBalancerAssignmentFilters,
    ToporBalancerAssignmentRepository,
    ToporBalancerGroupCreateInput,
    ToporBalancerGroupNodeCreateInput,
    ToporBalancerGroupUpdateInput,
    ToporBalancerManualReassignInput,
    ToporBalancerNodeCreateInput,
    ToporBalancerNodeUpdateInput,
    ToporBalancerRequestFilters,
} from './topor-balancer-database.repository';
import type {
    ToporBalancerAdminHealth,
    ToporBalancerAdminGroup,
    ToporBalancerAdminNode,
    ToporBalancerAdminRequest,
    ToporBalancerBootstrap,
    ToporBalancerAssignmentMode,
    ToporBalancerConfig,
    ToporBalancerDbAssignment,
    ToporBalancerDiscoveryImportInput,
    ToporBalancerDiscoveryImportResult,
    ToporBalancerDebugProcessSubscriptionResult,
    ToporBalancerDebugInfo,
    ToporBalancerGroupStrategy,
    ToporBalancerGroupNodeImportResult,
    ToporBalancerNodeStatus,
    ToporBalancerProcessResult,
    ToporBalancerSubscriptionDiagnosticsFormat,
    ToporBalancerSubscriptionDiagnosticsResult,
    ToporBalancerSubscriptionDiagnosticsStatus,
    ToporBalancerSubscriptionDiagnosticsUnchangedReason,
    ToporRemnawaveTopologySnapshot,
} from './types';

import {
    processSubscriptionWithDatabaseBalancer,
    type ToporBalancerRuntimeUserAccess,
} from './topor-balancer-database.processor';
import { ToporBalancerPostgresRepository } from './topor-balancer-database.repository';
import { processSubscriptionWithHashBalancer } from './topor-balancer-hash.processor';
import { loadToporBalancerConfigFromFile } from './topor-balancer-config.loader';
import {
    decodeSubscriptionBody,
    detectSubscriptionFormat,
    extractVlessLinks,
    parseVlessLink,
} from './topor-balancer-subscription.parser';
import { buildMaskedVlessDiff } from './topor-balancer-subscription.diagnostics';

interface ToporBalancerProcessInput {
    shortUuid: string;
    body: unknown;
    contentType?: string;
    requestPath?: string;
    userAgent?: string;
}

interface ToporBalancerDiagnosticsGroupSource {
    enabled: boolean;
    publicHostCode: string;
    planCode: string;
    publicName: string;
    locationCode?: string;
    squadScope?: 'any_visible_to_user' | 'specific_internal_squad';
    internalSquadUuid?: string;
    nodes: Array<{
        status: ToporBalancerNodeStatus;
        technicalHostName: string;
    }>;
}

interface ToporBalancerDiagnosticsUnchangedReasonDetail {
    publicHostCode?: string;
    planCode?: string;
    reason: ToporBalancerSubscriptionDiagnosticsUnchangedReason;
    remark?: string;
    technicalHostName?: string;
    message: string;
}

const ADMIN_NODE_STATUSES = new Set<ToporBalancerNodeStatus>([
    'active',
    'dead',
    'disabled',
    'draining',
]);

const ADMIN_GROUP_STRATEGIES = new Set<ToporBalancerGroupStrategy>([
    'least_loaded',
    'manual',
    'priority_failover',
    'sticky_hash',
    'weighted',
]);

const ADMIN_GROUP_SQUAD_SCOPES = new Set([
    'any_visible_to_user',
    'specific_internal_squad',
]);

@Injectable()
export class ToporBalancerService implements OnModuleDestroy, OnModuleInit {
    private readonly logger = new Logger(ToporBalancerService.name);
    private repository: ToporBalancerAssignmentRepository | null = null;
    private startupConfig: ToporBalancerConfig | null = null;

    constructor(
        private readonly configService: ConfigService,
        private readonly axiosService?: AxiosService,
    ) {}

    public async onModuleInit(): Promise<void> {
        if (!this.isEnabled() || this.getAssignmentMode() !== 'database') {
            return;
        }

        try {
            const repository = this.getOrCreateRepository();

            await repository.initializeSchema();

            if (this.shouldImportConfigOnStart()) {
                const config = await this.loadOptionalConfig();

                if (config) {
                    await repository.upsertConfiguredNodes(config);
                    this.startupConfig = config;
                    this.logger.log('TopoR balancer config imported into database.');
                } else {
                    this.logger.log('TopoR balancer config import skipped: config file not found.');
                }
            }

            this.logger.log('TopoR balancer database schema initialized.');
        } catch (error) {
            this.logger.error('TopoR balancer database startup initialization failed', error);

            if (!this.shouldFallbackToHash()) {
                this.logger.warn('TopoR balancer will fail open with original responses.');
            }
        }
    }

    public async onModuleDestroy(): Promise<void> {
        await this.repository?.close();
    }

    public isEnabled(): boolean {
        return this.configService.getOrThrow<boolean>('TOPOR_BALANCER_ENABLED');
    }

    public getConfigPath(): string {
        return this.configService.getOrThrow<string>('TOPOR_BALANCER_CONFIG_PATH');
    }

    public getAssignmentMode(): ToporBalancerAssignmentMode {
        return this.configService.getOrThrow<ToporBalancerAssignmentMode>(
            'TOPOR_BALANCER_ASSIGNMENT_MODE',
        );
    }

    public async loadConfig(): Promise<ToporBalancerConfig> {
        return loadToporBalancerConfigFromFile(this.getConfigPath());
    }

    public async loadOptionalConfig(): Promise<ToporBalancerConfig | null> {
        try {
            return await this.loadConfig();
        } catch (error) {
            if (this.isMissingFileError(error)) {
                return null;
            }

            throw error;
        }
    }

    public async process(input: ToporBalancerProcessInput): Promise<unknown> {
        if (!this.isEnabled()) {
            return input.body;
        }

        const bodyText = this.stringifySupportedBody(input.body);

        if (bodyText === null) {
            return input.body;
        }

        try {
            const result =
                this.getAssignmentMode() === 'database'
                    ? await this.processWithDatabase(input, bodyText)
                    : processSubscriptionWithHashBalancer({
                          shortUuid: input.shortUuid,
                          body: bodyText,
                          contentType: input.contentType,
                          requestPath: input.requestPath,
                          userAgent: input.userAgent,
                          config: await this.loadConfig(),
                          debug: this.configService.getOrThrow<boolean>('TOPOR_BALANCER_DEBUG'),
                          logger: (message) => this.logger.log(message),
                      });

            if (Buffer.isBuffer(input.body)) {
                return result.body === bodyText ? input.body : Buffer.from(result.body, 'utf8');
            }

            return result.body;
        } catch (error) {
            this.logger.error(
                'TopoR balancer processing failed; returning original response',
                error,
            );

            return input.body;
        }
    }

    public isAdminTokenConfigured(): boolean {
        const adminToken = this.configService.get<string | undefined>('TOPOR_BALANCER_ADMIN_TOKEN');

        return Boolean(adminToken);
    }

    public getAdminToken(): string | undefined {
        return this.configService.get<string | undefined>('TOPOR_BALANCER_ADMIN_TOKEN');
    }

    public async getAdminHealth(): Promise<ToporBalancerAdminHealth> {
        let configLoaded = false;
        let databaseConnected = false;
        let nodeCount = 0;
        let assignmentCount = 0;
        let requestCount = 0;
        let lastError: string | undefined;

        try {
            configLoaded = Boolean(await this.loadOptionalConfig());
        } catch (error) {
            configLoaded = false;
            lastError = this.getErrorMessage(error);
        }

        try {
            const repository = this.getOrCreateRepository();

            await repository.initializeSchema();
            databaseConnected = await repository.healthCheck();
            nodeCount = await repository.countNodes();
            assignmentCount = await repository.countAssignments();
            requestCount = await repository.countRequests();
        } catch (error) {
            databaseConnected = false;
            lastError = this.getErrorMessage(error);
        }

        return {
            enabled: this.isEnabled(),
            assignmentMode: this.getAssignmentMode(),
            configLoaded,
            databaseConnected,
            nodeCount,
            assignmentCount,
            requestCount,
            ...(lastError ? { lastError } : {}),
        };
    }

    public async getBootstrap(): Promise<ToporBalancerBootstrap> {
        const nodes = await this.getBootstrapNodes();
        const hosts = this.getBootstrapHosts(nodes);

        return {
            version: '1',
            locale: 'ru',
            features: {
                failover: true,
                healthChecks: true,
                stickyAssignment: this.getAssignmentMode() === 'database',
                weightedBalancing: true,
            },
            settings: {
                assignmentMode: this.getAssignmentMode(),
                enabled: this.isEnabled(),
                fallbackToHash: this.shouldFallbackToHash(),
            },
            hosts,
            nodes,
        };
    }

    public async listAdminGroups(): Promise<ToporBalancerAdminGroup[]> {
        return this.getAdminRepository().listGroups();
    }

    public async getAdminGroup(id: string): Promise<ToporBalancerAdminGroup> {
        const group = await this.getAdminRepository().getGroup(id);

        if (!group) {
            throw new NotFoundException('TopoR balancer group not found');
        }

        return group;
    }

    public async createAdminGroup(
        input: ToporBalancerGroupCreateInput,
    ): Promise<ToporBalancerAdminGroup> {
        this.validateGroupCreate(input);

        const group = await this.getAdminRepository().createGroup({
            enabled: input.enabled ?? true,
            internalSquadUuid:
                input.squadScope === 'specific_internal_squad'
                    ? input.internalSquadUuid?.trim()
                    : undefined,
            locationCode: input.locationCode?.trim() ?? '',
            planCode: input.planCode.trim(),
            publicHostCode: input.publicHostCode.trim(),
            publicName: input.publicName.trim(),
            squadScope: input.squadScope ?? 'any_visible_to_user',
            strategy: input.strategy,
        });

        if (!group) {
            throw new ConflictException(
                'TopoR balancer group publicHostCode and planCode already exists',
            );
        }

        return group;
    }

    public async updateAdminGroup(
        id: string,
        input: ToporBalancerGroupUpdateInput,
    ): Promise<ToporBalancerAdminGroup> {
        this.validateGroupUpdate(input);

        const group = await this.getAdminRepository().updateGroup(id, {
            enabled: input.enabled,
            locationCode:
                input.locationCode === undefined
                    ? undefined
                    : this.normalizeOptionalString(input.locationCode),
            planCode: this.normalizeOptionalString(input.planCode),
            publicHostCode: this.normalizeOptionalString(input.publicHostCode),
            publicName: this.normalizeOptionalString(input.publicName),
            internalSquadUuid:
                input.squadScope === 'any_visible_to_user'
                    ? undefined
                    : this.normalizeOptionalString(input.internalSquadUuid),
            squadScope: input.squadScope,
            strategy: input.strategy,
        });

        if (!group) {
            throw new NotFoundException('TopoR balancer group not found');
        }

        return group;
    }

    public async deleteAdminGroup(id: string): Promise<{ deleted: true }> {
        const result = await this.getAdminRepository().deleteGroup(id);

        if (result === 'has_nodes') {
            throw new ConflictException('TopoR balancer group has nodes and cannot be deleted');
        }

        if (result === 'not_found') {
            throw new NotFoundException('TopoR balancer group not found');
        }

        return { deleted: true };
    }

    public async listAdminGroupNodes(groupId: string): Promise<ToporBalancerAdminNode[]> {
        const nodes = await this.getAdminRepository().listGroupNodes(groupId);

        if (!nodes) {
            throw new NotFoundException('TopoR balancer group not found');
        }

        return nodes;
    }

    public async createAdminGroupNode(
        groupId: string,
        input: ToporBalancerGroupNodeCreateInput,
    ): Promise<ToporBalancerAdminNode> {
        this.validateGroupNodeCreate(input);

        const node = await this.getAdminRepository().createGroupNode(groupId, {
            maxUsers: input.maxUsers ?? 300,
            priority: input.priority ?? 100,
            status: input.status ?? 'active',
            technicalHostName: input.technicalHostName.trim(),
            weight: input.weight ?? 1,
        });

        if (!node) {
            throw new ConflictException(
                'TopoR balancer group node already exists or group was not found',
            );
        }

        return node;
    }

    public async updateAdminGroupNode(
        groupId: string,
        nodeId: string,
        input: ToporBalancerNodeUpdateInput,
    ): Promise<ToporBalancerAdminNode> {
        this.validateNodeUpdate({
            maxUsers: input.maxUsers,
            priority: input.priority,
            status: input.status,
            technicalHostName: input.technicalHostName,
            weight: input.weight,
        });

        const node = await this.getAdminRepository().updateGroupNode(groupId, nodeId, input);

        if (!node) {
            throw new NotFoundException('TopoR balancer group node not found');
        }

        return node;
    }

    public async deleteAdminGroupNode(
        groupId: string,
        nodeId: string,
    ): Promise<{ deleted: true }> {
        const result = await this.getAdminRepository().deleteGroupNode(groupId, nodeId);

        if (result === 'has_assignments') {
            throw new ConflictException(
                'TopoR balancer node has assignments and cannot be deleted',
            );
        }

        if (result === 'not_found') {
            throw new NotFoundException('TopoR balancer group node not found');
        }

        return { deleted: true };
    }

    public async importAdminGroupNodes(
        groupId: string,
        input: {
            defaults: ToporBalancerGroupNodeCreateInput;
            mode?: 'skip_conflicts';
            technicalHostNames: string[];
        },
    ): Promise<ToporBalancerGroupNodeImportResult> {
        if (input.mode !== undefined && input.mode !== 'skip_conflicts') {
            throw new BadRequestException('TopoR balancer import mode must be skip_conflicts');
        }

        if (!Array.isArray(input.technicalHostNames) || input.technicalHostNames.length === 0) {
            throw new BadRequestException('TopoR balancer technicalHostNames must be a non-empty array');
        }

        this.validateGroupNodeCreate({
            maxUsers: input.defaults.maxUsers,
            priority: input.defaults.priority ?? 100,
            status: input.defaults.status,
            technicalHostName: 'validation-placeholder',
            weight: input.defaults.weight,
        });

        const group = await this.getAdminGroup(groupId);
        const existingNodes = await this.getAdminRepository().listNodes();
        const created: ToporBalancerAdminNode[] = [];
        const alreadyInGroup: ToporBalancerGroupNodeImportResult['alreadyInGroup'] = [];
        const inOtherGroup: ToporBalancerGroupNodeImportResult['inOtherGroup'] = [];
        const errors: ToporBalancerGroupNodeImportResult['errors'] = [];
        const uniqueTechnicalHostNames = Array.from(
            new Set(
                input.technicalHostNames.map((technicalHostName) => {
                    this.validateNonEmptyString(technicalHostName, 'technicalHostName');

                    return this.normalizeTechnicalHostName(technicalHostName);
                }),
            ),
        );

        for (const technicalHostName of uniqueTechnicalHostNames) {
            const matchingNodes = existingNodes.filter(
                (node) => this.normalizeTechnicalHostName(node.technicalHostName) === technicalHostName,
            );
            const nodeInThisGroup = matchingNodes.find((node) => node.groupId === group.id);
            const nodeInOtherGroup = matchingNodes.find((node) => node.groupId !== group.id);

            if (nodeInThisGroup) {
                alreadyInGroup.push({
                    nodeId: nodeInThisGroup.id,
                    technicalHostName,
                });
                continue;
            }

            if (nodeInOtherGroup) {
                inOtherGroup.push({
                    currentGroupId: nodeInOtherGroup.groupId,
                    currentGroupName: nodeInOtherGroup.publicName,
                    technicalHostName,
                });
                continue;
            }

            const createdNode = await this.getAdminRepository().createGroupNode(group.id, {
                maxUsers: input.defaults.maxUsers,
                priority: input.defaults.priority ?? 100,
                status: input.defaults.status,
                technicalHostName,
                weight: input.defaults.weight,
            });

            if (createdNode) {
                created.push(createdNode);
                existingNodes.push(createdNode);
            } else {
                errors.push({
                    reason: 'Technical node could not be imported',
                    technicalHostName,
                });
            }
        }

        return {
            alreadyInGroup,
            created,
            errors,
            inOtherGroup,
        };
    }

    public async listAdminNodes(): Promise<ToporBalancerAdminNode[]> {
        return this.getAdminRepository().listNodes();
    }

    public async createAdminNode(
        input: ToporBalancerNodeCreateInput,
    ): Promise<ToporBalancerAdminNode> {
        this.validateNodeCreate(input);

        const node = await this.getAdminRepository().createNode({
            ...input,
            technicalHostName: input.technicalHostName.trim(),
            publicHostCode: input.publicHostCode.trim(),
            publicName: input.publicName.trim(),
            locationCode: this.normalizeOptionalString(input.locationCode),
            planCode: input.planCode.trim(),
        });

        if (!node) {
            throw new ConflictException('TopoR balancer node technicalHostName already exists');
        }

        return node;
    }

    public async updateAdminNode(
        id: string,
        input: ToporBalancerNodeUpdateInput,
    ): Promise<ToporBalancerAdminNode> {
        this.validateNodeUpdate(input);

        const node = await this.getAdminRepository().updateNode(id, {
            ...input,
            technicalHostName: this.normalizeOptionalString(input.technicalHostName),
            publicHostCode: this.normalizeOptionalString(input.publicHostCode),
            publicName: this.normalizeOptionalString(input.publicName),
            locationCode:
                input.locationCode === undefined
                    ? undefined
                    : this.normalizeOptionalString(input.locationCode),
            planCode: this.normalizeOptionalString(input.planCode),
        });

        if (!node) {
            throw new NotFoundException('TopoR balancer node not found');
        }

        return node;
    }

    public async deleteAdminNode(id: string): Promise<{ deleted: true }> {
        const result = await this.getAdminRepository().deleteNode(id);

        if (result === 'has_assignments') {
            throw new ConflictException(
                'TopoR balancer node has assignments and cannot be deleted',
            );
        }

        if (result === 'not_found') {
            throw new NotFoundException('TopoR balancer node not found');
        }

        return { deleted: true };
    }

    public async listAdminAssignments(
        filters: ToporBalancerAssignmentFilters,
    ): Promise<ToporBalancerDbAssignment[]> {
        return this.getAdminRepository().listAssignments(filters);
    }

    public async reassignAdminAssignment(
        input: ToporBalancerManualReassignInput,
    ): Promise<ToporBalancerDbAssignment> {
        await this.validateManualReassign(input);

        const assignment = await this.getAdminRepository().reassign(input);

        if (!assignment) {
            throw new NotFoundException('TopoR balancer node not found for reassignment');
        }

        return assignment;
    }

    public async listAdminRequests(
        filters: ToporBalancerRequestFilters,
    ): Promise<ToporBalancerAdminRequest[]> {
        return this.getAdminRepository().listRequests(filters);
    }

    public async replaceRemnawaveTopologyCache(
        input: ToporRemnawaveTopologySnapshot,
    ): Promise<void> {
        const repository = this.getAdminRepository();

        await repository.initializeSchema();
        await repository.replaceRemnawaveTopologyCache(input);
    }

    public async getRemnawaveTopologyCache(): Promise<ToporRemnawaveTopologySnapshot> {
        const repository = this.getAdminRepository();

        await repository.initializeSchema();

        return repository.getRemnawaveTopologyCache();
    }

    public async setAdminNodeStatus(
        id: string,
        status: ToporBalancerNodeStatus,
    ): Promise<ToporBalancerAdminNode> {
        return this.updateAdminNode(id, { status });
    }

    public async importDiscoveredNodes(
        input: ToporBalancerDiscoveryImportInput,
    ): Promise<ToporBalancerDiscoveryImportResult> {
        this.validateDiscoveryImport(input);

        const repository = this.getAdminRepository();
        const targetGroup = await this.resolveDiscoveryImportGroup(input);
        const existingNodes = await repository.listNodes();
        const created: ToporBalancerAdminNode[] = [];
        const skipped: ToporBalancerDiscoveryImportResult['skipped'] = [];
        const errors: ToporBalancerDiscoveryImportResult['errors'] = [];
        const conflicts: ToporBalancerDiscoveryImportResult['conflicts'] = [];
        const normalizedNodes = input.nodes.map((node) => ({
            technicalHostName: node.technicalHostName.trim(),
            weight: node.weight,
            maxUsers: node.maxUsers,
            priority: node.priority ?? 100,
            status: node.status,
        }));

        for (const node of normalizedNodes) {
            const existingNode = existingNodes.find(
                (item) => item.technicalHostName === node.technicalHostName,
            );

            if (existingNode?.groupId === targetGroup.id) {
                skipped.push({
                    technicalHostName: node.technicalHostName,
                    reason: 'Technical node already exists in target group',
                });
                continue;
            }

            if (existingNode) {
                conflicts.push({
                    technicalHostName: node.technicalHostName,
                    reason: 'Technical node already exists in another group',
                    existingGroupId: existingNode.groupId,
                    existingPublicHostCode: existingNode.publicHostCode,
                    existingPlanCode: existingNode.planCode,
                    existingPublicName: existingNode.publicName,
                });
                continue;
            }

            const createdNode = await repository.createGroupNode(targetGroup.id, node);

            if (createdNode) {
                created.push(createdNode);
                existingNodes.push(createdNode);
            } else {
                errors.push({
                    technicalHostName: node.technicalHostName,
                    reason: 'Technical node could not be imported',
                });
            }
        }

        return {
            created,
            updated: [],
            skipped,
            errors,
            conflicts,
        };
    }

    public async debugProcessSubscription(
        shortUuid: string,
    ): Promise<ToporBalancerDebugProcessSubscriptionResult> {
        this.validateNonEmptyString(shortUuid, 'shortUuid');

        if (!this.axiosService) {
            throw new ServiceUnavailableException('Remnawave API service is not available');
        }

        const subscriptionDataResponse = await this.axiosService.getSubscription(
            '127.0.0.1',
            shortUuid.trim(),
            {
                'user-agent': 'v2rayNG/1.9.0 TopoR-Debug/1.0',
            },
        );

        if (!subscriptionDataResponse) {
            throw new NotFoundException('Subscription was not found in Remnawave');
        }

        const inputBody = this.stringifySupportedBody(subscriptionDataResponse.response);

        if (inputBody === null) {
            return {
                inputLinksCount: 0,
                outputLinksCount: 0,
                selectedNodes: {},
                warnings: ['Subscription body is not a string or Buffer.'],
                maskedDiff: [],
            };
        }

        const contentType = this.extractHeader(subscriptionDataResponse.headers, 'content-type');
        const warnings: string[] = [];
        let result: ToporBalancerProcessResult;

        try {
            result =
                this.getAssignmentMode() === 'database'
                    ? ((await this.processWithDatabase(
                          {
                              shortUuid: shortUuid.trim(),
                              body: inputBody,
                              contentType,
                              requestPath: `/api/topor-balancer/debug/process-subscription`,
                              userAgent: 'v2rayNG/1.9.0 TopoR-Debug/1.0',
                          },
                          inputBody,
                      )) as ToporBalancerProcessResult)
                    : processSubscriptionWithHashBalancer({
                          shortUuid: shortUuid.trim(),
                          body: inputBody,
                          contentType,
                          requestPath: `/api/topor-balancer/debug/process-subscription`,
                          userAgent: 'v2rayNG/1.9.0 TopoR-Debug/1.0',
                          config: await this.loadConfig(),
                          debug: this.configService.getOrThrow<boolean>('TOPOR_BALANCER_DEBUG'),
                          logger: (message) => this.logger.log(message),
                      });
        } catch (error) {
            this.logger.error(
                'TopoR balancer debug processing failed; comparing original response',
                error,
            );
            warnings.push('Processing failed; original subscription was used for diagnostics.');
            result = {
                body: inputBody,
                debugInfo: {
                    shortUuid: shortUuid.trim(),
                    detectedFormat: detectSubscriptionFormat(inputBody, contentType),
                    totalVlessLinks: extractVlessLinks(
                        decodeSubscriptionBody(
                            inputBody,
                            detectSubscriptionFormat(inputBody, contentType),
                        ),
                    ).length,
                    matchedTechnicalLinks: 0,
                    selectedNodes: {},
                    outputLinkCount: 0,
                },
            };
        }

        const outputBody = result.body;
        const inputFormat = detectSubscriptionFormat(inputBody, contentType);
        const outputFormat = detectSubscriptionFormat(outputBody, contentType);
        const inputPlainBody = decodeSubscriptionBody(inputBody, inputFormat);
        const outputPlainBody = decodeSubscriptionBody(outputBody, outputFormat);
        const inputLinksCount = extractVlessLinks(inputPlainBody).length;
        const outputLinksCount = extractVlessLinks(outputPlainBody).length;
        warnings.push(...(result.debugInfo.warnings ?? []));

        if (inputFormat !== outputFormat) {
            warnings.push(`Subscription format changed from ${inputFormat} to ${outputFormat}.`);
        }

        if (inputLinksCount > 0 && outputLinksCount === 0) {
            warnings.push('Processed subscription contains no valid VLESS links.');
        }

        return {
            inputLinksCount,
            outputLinksCount,
            selectedNodes: result.debugInfo.selectedNodes,
            warnings,
            maskedDiff: buildMaskedVlessDiff(inputPlainBody, outputPlainBody),
        };
    }

    public async diagnoseSubscription(input: {
        shortUuid: string;
        userAgent?: string;
    }): Promise<ToporBalancerSubscriptionDiagnosticsResult> {
        this.validateNonEmptyString(input.shortUuid, 'shortUuid');

        if (!this.axiosService) {
            throw new ServiceUnavailableException('Remnawave API service is not available');
        }

        const normalizedShortUuid = input.shortUuid.trim();
        const userAgent = input.userAgent?.trim() || 'v2rayNG/1.9.0 TopoR-Diagnostics/1.0';
        const subscriptionDataResponse = await this.axiosService.getSubscription(
            '127.0.0.1',
            normalizedShortUuid,
            {
                'user-agent': userAgent,
            },
        );

        if (!subscriptionDataResponse) {
            throw new NotFoundException('Subscription was not found in Remnawave');
        }

        const inputBody = this.stringifySupportedBody(subscriptionDataResponse.response);

        if (inputBody === null) {
            return {
                ok: false,
                status: 'failed_open',
                format: 'unknown',
                totalVlessLinks: 0,
                matchedTechnicalLinks: 0,
                userSquads: [],
                accessibleNodesCount: 0,
                unmatchedRemarks: [],
                matchedGroups: [],
                selectedNodes: {},
                rewrittenLinksCount: 0,
                unchangedLinksCount: 0,
                unchangedReasons: [
                    {
                        reason: 'format_unsupported',
                        message: 'Subscription body is not a string or Buffer.',
                    },
                ],
                inputLinksCount: 0,
                outputLinksCount: 0,
                groups: [],
                vlessValidation: [],
                warnings: [],
                errors: ['Тело подписки не является строкой или Buffer.'],
            };
        }

        const contentType = this.extractHeader(subscriptionDataResponse.headers, 'content-type');
        const warnings: string[] = [];
        const errors: string[] = [];
        let result: ToporBalancerProcessResult;
        let config: ToporBalancerConfig;
        let diagnosticsGroupSources: ToporBalancerDiagnosticsGroupSource[] = [];
        let processingFailed = false;

        try {
            const diagnosticsConfig = await this.loadSubscriptionDiagnosticsConfig();
            config = diagnosticsConfig.processingConfig;
            diagnosticsGroupSources = diagnosticsConfig.groups;

            result =
                this.getAssignmentMode() === 'database'
                    ? ((await this.processWithDatabase(
                          {
                              shortUuid: normalizedShortUuid,
                              body: inputBody,
                              contentType,
                              requestPath: '/api/topor-balancer/diagnostics/subscription',
                              userAgent,
                          },
                          inputBody,
                      )) as ToporBalancerProcessResult)
                    : processSubscriptionWithHashBalancer({
                          shortUuid: normalizedShortUuid,
                          body: inputBody,
                          contentType,
                          requestPath: '/api/topor-balancer/diagnostics/subscription',
                          userAgent,
                          config,
                          debug: this.configService.getOrThrow<boolean>('TOPOR_BALANCER_DEBUG'),
                          logger: (message) => this.logger.log(message),
                      });
        } catch (error) {
            processingFailed = true;
            this.logger.error('TopoR balancer subscription diagnostics failed', error);
            try {
                const diagnosticsConfig = await this.loadSubscriptionDiagnosticsConfig();

                config = diagnosticsConfig.processingConfig;
                diagnosticsGroupSources = diagnosticsConfig.groups;
            } catch {
                config = {
                    enabled: true,
                    locations: [],
                };
                diagnosticsGroupSources = [];
            }
            result = {
                body: inputBody,
                debugInfo: {
                    shortUuid: normalizedShortUuid,
                    detectedFormat: detectSubscriptionFormat(inputBody, contentType),
                    totalVlessLinks: 0,
                    matchedTechnicalLinks: 0,
                    selectedNodes: {},
                    outputLinkCount: 0,
                    warnings: [
                        'Обработка не удалась; для диагностики использована исходная подписка.',
                    ],
                },
            };
            warnings.push('Обработка не удалась; для диагностики использована исходная подписка.');
        }

        const inputFormat = detectSubscriptionFormat(inputBody, contentType);
        const outputFormat = detectSubscriptionFormat(result.body, contentType);
        const inputPlainBody = decodeSubscriptionBody(inputBody, inputFormat);
        const outputPlainBody = decodeSubscriptionBody(result.body, outputFormat);
        const inputLinks = extractVlessLinks(inputPlainBody);
        const outputLinks = extractVlessLinks(outputPlainBody);
        const inputLinksCount = inputLinks.length;
        const outputLinksCount = outputLinks.length;
        const vlessValidation = this.validateGeneratedVlessLinks(outputPlainBody);
        const maskedDiff = buildMaskedVlessDiff(inputPlainBody, outputPlainBody);
        const processingProof = this.buildSubscriptionProcessingProof({
            groups: diagnosticsGroupSources,
            groupCandidateDiagnostics: result.debugInfo.groupCandidateDiagnostics ?? [],
            inputFormat,
            inputLinks,
            outputLinks,
            processingFailed,
            selectedNodes: result.debugInfo.selectedNodes,
        });

        warnings.push(...(result.debugInfo.warnings ?? []));
        warnings.push(...processingProof.warnings);

        if (inputFormat === 'base64_links' && outputFormat !== 'base64_links') {
            errors.push('Base64-ответ подписки не удалось корректно декодировать.');
        }

        if (inputLinksCount > 0 && outputLinksCount === 0) {
            errors.push('В обработанной подписке нет валидных VLESS-ссылок.');
        }

        for (const validation of vlessValidation) {
            if (!validation.valid) {
                errors.push(`Некорректная VLESS-ссылка: ${validation.remark ?? 'без названия'}`);
            }
        }

        if (maskedDiff.some((diff) => diff.changedFields.includes('queryParamKeys'))) {
            errors.push('Набор query-параметров VLESS изменился после сериализации.');
        }

        return {
            ok: errors.length === 0 && processingProof.status === 'processed',
            status: processingProof.status,
            format: this.mapDiagnosticsFormat(outputFormat),
            totalVlessLinks: inputLinksCount,
            matchedTechnicalLinks: processingProof.matchedTechnicalLinks,
            unmatchedRemarks: processingProof.unmatchedRemarks,
            matchedGroups: processingProof.matchedGroups,
            selectedNodes: result.debugInfo.selectedNodes,
            userSquads: result.debugInfo.userSquads ?? [],
            accessibleNodesCount: result.debugInfo.accessibleNodesCount ?? 0,
            rewrittenLinksCount: processingProof.rewrittenLinksCount,
            unchangedLinksCount: processingProof.unchangedLinksCount,
            unchangedReasons: processingProof.unchangedReasons,
            inputLinksCount,
            outputLinksCount,
            groups: this.buildDiagnosticsGroups(
                config,
                result.debugInfo.selectedNodes,
                inputPlainBody,
                processingProof.matchedGroups,
            ),
            vlessValidation,
            warnings: Array.from(new Set(warnings.map((warning) => this.translateDiagnosticsMessage(warning)))),
            errors: Array.from(new Set(errors)),
        };
    }

    private mapDiagnosticsFormat(
        format: ReturnType<typeof detectSubscriptionFormat>,
    ): ToporBalancerSubscriptionDiagnosticsFormat {
        if (format === 'base64_links') {
            return 'base64';
        }

        if (format === 'plain_links') {
            return 'plain';
        }

        return 'unknown';
    }

    private async loadSubscriptionDiagnosticsConfig(): Promise<{
        groups: ToporBalancerDiagnosticsGroupSource[];
        processingConfig: ToporBalancerConfig;
    }> {
        if (this.getAssignmentMode() !== 'database') {
            const processingConfig = await this.loadConfig();

            return {
                groups: this.buildDiagnosticsGroupSourcesFromConfig(processingConfig),
                processingConfig,
            };
        }

        const repository = this.getOrCreateRepository();

        await repository.initializeSchema();

        const groups = await repository.listGroups();
        const diagnosticsGroups: ToporBalancerDiagnosticsGroupSource[] = [];

        for (const group of groups) {
            const nodes = (await repository.listGroupNodes(group.id)) ?? [];

            diagnosticsGroups.push({
                enabled: group.enabled,
                locationCode: group.locationCode,
                nodes: nodes.map((node) => ({
                    status: node.status,
                    technicalHostName: node.technicalHostName,
                })),
                planCode: group.planCode,
                publicHostCode: group.publicHostCode,
                publicName: group.publicName,
                squadScope: group.squadScope,
                internalSquadUuid: group.internalSquadUuid,
            });
        }

        return {
            groups: diagnosticsGroups,
            processingConfig: await this.getDatabaseProcessingConfig(repository),
        };
    }

    private buildDiagnosticsGroupSourcesFromConfig(
        config: ToporBalancerConfig,
    ): ToporBalancerDiagnosticsGroupSource[] {
        return config.locations.map((location) => ({
            enabled: true,
            locationCode: location.locationCode,
            nodes: location.nodes.map((node) => ({
                status: node.status,
                technicalHostName: node.technicalHostName,
            })),
            planCode: location.planCode,
            publicHostCode: location.publicHostCode,
            publicName: location.publicName,
            squadScope: location.squadScope,
            internalSquadUuid: location.internalSquadUuid,
        }));
    }

    private buildSubscriptionProcessingProof(input: {
        groups: ToporBalancerDiagnosticsGroupSource[];
        groupCandidateDiagnostics: NonNullable<ToporBalancerDebugInfo['groupCandidateDiagnostics']>;
        inputFormat: ReturnType<typeof detectSubscriptionFormat>;
        inputLinks: ReturnType<typeof extractVlessLinks>;
        outputLinks: ReturnType<typeof extractVlessLinks>;
        processingFailed: boolean;
        selectedNodes: Record<string, string>;
    }): {
        matchedGroups: ToporBalancerSubscriptionDiagnosticsResult['matchedGroups'];
        matchedTechnicalLinks: number;
        status: ToporBalancerSubscriptionDiagnosticsStatus;
        unchangedLinksCount: number;
        unchangedReasons: ToporBalancerDiagnosticsUnchangedReasonDetail[];
        unmatchedRemarks: string[];
        warnings: string[];
        rewrittenLinksCount: number;
    } {
        const outputByStableKey = new Map(
            input.outputLinks.map((link) => [this.buildDiagnosticsStableLinkKey(link), link]),
        );
        const technicalGroupByName = new Map<string, ToporBalancerDiagnosticsGroupSource>();
        const unchangedReasons: ToporBalancerDiagnosticsUnchangedReasonDetail[] = [];

        for (const group of input.groups) {
            for (const node of group.nodes) {
                technicalGroupByName.set(node.technicalHostName, group);
            }
        }

        let rewrittenLinksCount = 0;
        let unchangedLinksCount = 0;
        let matchedTechnicalLinks = 0;

        const unmatchedRemarks = new Set<string>();

        for (const inputLink of input.inputLinks) {
            const outputLink = outputByStableKey.get(this.buildDiagnosticsStableLinkKey(inputLink));
            const remark = inputLink.remark;
            const matchingGroup = remark ? technicalGroupByName.get(remark) : undefined;

            if (outputLink?.remark === inputLink.remark) {
                unchangedLinksCount += 1;
            } else if (outputLink) {
                rewrittenLinksCount += 1;
            }

            if (matchingGroup) {
                matchedTechnicalLinks += 1;
                continue;
            }

            if (remark) {
                unmatchedRemarks.add(remark);
                unchangedReasons.push({
                    reason: 'technicalHostName_mismatch',
                    remark,
                    message: `VLESS remark "${remark}" does not match any Balancer technicalHostName.`,
                });
            }
        }

        if (input.inputFormat !== 'plain_links' && input.inputFormat !== 'base64_links') {
            unchangedReasons.push({
                reason: 'format_unsupported',
                message: `Subscription format ${input.inputFormat} is not supported for VLESS rewriting.`,
            });
        }

        const matchedGroups = input.groups
            .map((group) => {
                const technicalHostNames = group.nodes.map((node) => node.technicalHostName);
                const matchedInputLinks = input.inputLinks.filter(
                    (link) => link.remark !== undefined && technicalHostNames.includes(link.remark),
                );

                if (matchedInputLinks.length === 0) {
                    return null;
                }

                const outputLinks = matchedInputLinks
                    .map((link) => outputByStableKey.get(this.buildDiagnosticsStableLinkKey(link)))
                    .filter((link): link is (typeof input.outputLinks)[number] => Boolean(link));
                const groupRewrittenLinksCount = matchedInputLinks.filter((link) => {
                    const outputLink = outputByStableKey.get(this.buildDiagnosticsStableLinkKey(link));

                    return outputLink !== undefined && outputLink.remark !== link.remark;
                }).length;
                const groupUnchangedLinksCount = matchedInputLinks.filter((link) => {
                    const outputLink = outputByStableKey.get(this.buildDiagnosticsStableLinkKey(link));

                    return outputLink?.remark === link.remark;
                }).length;
                const selectedTechnicalHostName =
                    input.selectedNodes[`${group.publicHostCode}:${group.planCode}`];
                const groupCandidateDiagnostic = input.groupCandidateDiagnostics.find(
                    (diagnostic) =>
                        diagnostic.publicHostCode === group.publicHostCode &&
                        diagnostic.planCode === group.planCode,
                );
                const groupReasons = this.buildGroupUnchangedReasons({
                    group,
                    groupCandidateDiagnostic,
                    matchedInputLinks,
                    selectedTechnicalHostName,
                });

                unchangedReasons.push(
                    ...groupReasons.map((reason) => ({
                        ...reason,
                        publicHostCode: group.publicHostCode,
                        planCode: group.planCode,
                    })),
                );

                return {
                    publicHostCode: group.publicHostCode,
                    planCode: group.planCode,
                    publicName: group.publicName,
                    technicalHostNames,
                    matchedRemarks: Array.from(
                        new Set(
                            matchedInputLinks
                                .map((link) => link.remark)
                                .filter((remark): remark is string => Boolean(remark)),
                        ),
                    ),
                    ...(selectedTechnicalHostName ? { selectedTechnicalHostName } : {}),
                    userSquads: groupCandidateDiagnostic?.userSquads ?? [],
                    accessibleNodesCount: groupCandidateDiagnostic?.accessibleNodesCount ?? 0,
                    groupNodesCount: groupCandidateDiagnostic?.groupNodesCount ?? group.nodes.length,
                    effectiveCandidateNodes: groupCandidateDiagnostic?.effectiveCandidateNodes ?? [],
                    outputRemarks: Array.from(
                        new Set(
                            outputLinks
                                .map((link) => link.remark)
                                .filter((remark): remark is string => Boolean(remark)),
                        ),
                    ),
                    outputContainsPublicName: outputLinks.some(
                        (link) => link.remark === group.publicName,
                    ),
                    rewrittenLinksCount: groupRewrittenLinksCount,
                    unchangedLinksCount: groupUnchangedLinksCount,
                    unchangedReasons: groupReasons,
                };
            })
            .filter(
                (
                    group,
                ): group is ToporBalancerSubscriptionDiagnosticsResult['matchedGroups'][number] =>
                    group !== null,
            );

        const uniqueUnchangedReasons = this.dedupeUnchangedReasons(unchangedReasons);
        const warnings: string[] = [];

        if (input.inputLinks.length > 0 && matchedTechnicalLinks === 0) {
            const suggestedRemarks = Array.from(unmatchedRemarks);

            warnings.push(
                suggestedRemarks.length > 0
                    ? `No VLESS remarks matched Balancer technicalHostName. Add these remarks as technicalHostName: ${suggestedRemarks.join(', ')}.`
                    : 'No VLESS remarks matched Balancer technicalHostName.',
            );
        }

        return {
            matchedGroups,
            matchedTechnicalLinks,
            status: this.resolveDiagnosticsStatus({
                matchedGroups,
                processingFailed: input.processingFailed,
                rewrittenLinksCount,
                unchangedReasons: uniqueUnchangedReasons,
            }),
            unchangedLinksCount,
            unchangedReasons: uniqueUnchangedReasons,
            unmatchedRemarks: Array.from(unmatchedRemarks),
            warnings,
            rewrittenLinksCount,
        };
    }

    private buildGroupUnchangedReasons(input: {
        group: ToporBalancerDiagnosticsGroupSource;
        groupCandidateDiagnostic?: NonNullable<ToporBalancerDebugInfo['groupCandidateDiagnostics']>[number];
        matchedInputLinks: ReturnType<typeof extractVlessLinks>;
        selectedTechnicalHostName?: string;
    }): ToporBalancerSubscriptionDiagnosticsResult['matchedGroups'][number]['unchangedReasons'] {
        if (!input.group.enabled) {
            return input.matchedInputLinks.map((link) => ({
                reason: 'group_disabled',
                remark: link.remark,
                technicalHostName: link.remark,
                message: `Group ${input.group.publicHostCode}:${input.group.planCode} is disabled.`,
            }));
        }

        const nodeByTechnicalHostName = new Map(
            input.group.nodes.map((node) => [node.technicalHostName, node]),
        );
        const matchedActiveLinks = input.matchedInputLinks.filter((link) => {
            const node = link.remark ? nodeByTechnicalHostName.get(link.remark) : undefined;

            return node?.status === 'active';
        });

        if (matchedActiveLinks.length === 0) {
            return input.matchedInputLinks.map((link) => ({
                reason: 'no_active_node',
                remark: link.remark,
                technicalHostName: link.remark,
                message: `No active node was available for ${input.group.publicHostCode}:${input.group.planCode}.`,
            }));
        }

        if (input.groupCandidateDiagnostic?.effectiveCandidateNodes.length === 0) {
            return input.matchedInputLinks.map((link) => ({
                reason: 'no_accessible_candidates',
                remark: link.remark,
                technicalHostName: link.remark,
                message: `No candidate nodes are accessible to this user for ${input.group.publicHostCode}:${input.group.planCode}.`,
            }));
        }

        if (!input.selectedTechnicalHostName) {
            return matchedActiveLinks.map((link) => ({
                reason: 'no_selected_node',
                remark: link.remark,
                technicalHostName: link.remark,
                message: `Balancer matched ${input.group.publicHostCode}:${input.group.planCode}, but did not select a node.`,
            }));
        }

        return [];
    }

    private resolveDiagnosticsStatus(input: {
        matchedGroups: ToporBalancerSubscriptionDiagnosticsResult['matchedGroups'];
        processingFailed: boolean;
        rewrittenLinksCount: number;
        unchangedReasons: ToporBalancerDiagnosticsUnchangedReasonDetail[];
    }): ToporBalancerSubscriptionDiagnosticsStatus {
        if (input.processingFailed) {
            return 'failed_open';
        }

        if (input.rewrittenLinksCount === 0) {
            return 'passed_through';
        }

        if (
            input.matchedGroups.some((group) => group.rewrittenLinksCount === 0) ||
            input.unchangedReasons.length > 0
        ) {
            return 'partially_processed';
        }

        return 'processed';
    }

    private dedupeUnchangedReasons(
        reasons: ToporBalancerDiagnosticsUnchangedReasonDetail[],
    ): ToporBalancerDiagnosticsUnchangedReasonDetail[] {
        return Array.from(
            new Map(
                reasons.map((reason) => [
                    [
                        reason.reason,
                        reason.publicHostCode ?? '',
                        reason.planCode ?? '',
                        reason.remark ?? '',
                        reason.technicalHostName ?? '',
                    ].join('|'),
                    reason,
                ]),
            ).values(),
        );
    }

    private buildDiagnosticsStableLinkKey(link: ReturnType<typeof extractVlessLinks>[number]): string {
        return [
            link.protocol,
            link.uuid,
            link.host,
            link.port ?? '',
            link.rawQuery,
        ].join('|');
    }

    private buildDiagnosticsGroups(
        config: ToporBalancerConfig,
        selectedNodes: Record<string, string>,
        inputPlainBody: string,
        matchedGroups: ToporBalancerSubscriptionDiagnosticsResult['matchedGroups'] = [],
    ): ToporBalancerSubscriptionDiagnosticsResult['groups'] {
        const inputRemarks = new Set(
            extractVlessLinks(inputPlainBody)
                .map((link) => link.remark)
                .filter((remark): remark is string => Boolean(remark)),
        );
        const matchedGroupByKey = new Map(
            matchedGroups.map((group) => [`${group.publicHostCode}:${group.planCode}`, group]),
        );

        return config.locations.map((location) => {
            const groupKey = `${location.publicHostCode}:${location.planCode}`;
            const selectedTechnicalHostName = selectedNodes[groupKey];
            const hasMatchingInputNode = location.nodes.some((node) =>
                inputRemarks.has(node.technicalHostName),
            );
            const hasActiveNode = location.nodes.some((node) => node.status === 'active');
            const matchedGroup = matchedGroupByKey.get(groupKey);
            const wasRewritten = (matchedGroup?.rewrittenLinksCount ?? 0) > 0;

            return {
                publicHostCode: location.publicHostCode,
                planCode: location.planCode,
                publicName: location.publicName,
                ...(selectedTechnicalHostName ? { selectedTechnicalHostName } : {}),
                status: wasRewritten
                    ? matchedGroup?.unchangedReasons.length
                        ? 'partial'
                        : 'ok'
                    : !hasMatchingInputNode
                      ? 'passed-through'
                      : !hasActiveNode
                        ? 'no-active-node'
                        : 'fail-open',
            };
        });
    }

    private validateGeneratedVlessLinks(
        outputPlainBody: string,
    ): ToporBalancerSubscriptionDiagnosticsResult['vlessValidation'] {
        return outputPlainBody
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.startsWith('vless://'))
            .map((line) => {
                const parsedLink = parseVlessLink(line);

                if (!parsedLink) {
                    return {
                        valid: false,
                        warnings: ['VLESS URL не удалось разобрать.'],
                        queryParamKeys: [],
                    };
                }

                const warnings: string[] = [];

                if (!parsedLink.uuid) {
                    warnings.push('UUID отсутствует.');
                }

                if (!parsedLink.host) {
                    warnings.push('Хост отсутствует.');
                }

                if (!parsedLink.port) {
                    warnings.push('Порт отсутствует.');
                }

                if (parsedLink.security === 'reality') {
                    for (const requiredParam of ['sni', 'fp', 'pbk', 'sid']) {
                        if (!parsedLink.queryParams[requiredParam]) {
                            warnings.push(`Параметр Reality ${requiredParam} отсутствует.`);
                        }
                    }
                }

                return {
                    remark: parsedLink.remark,
                    valid: warnings.length === 0,
                    warnings,
                    queryParamKeys: Object.keys(parsedLink.queryParams).sort(),
                };
            });
    }

    private translateDiagnosticsMessage(message: string): string {
        const noActiveNodeMatch = message.match(
            /^No active TopoR balancer node for (.+); preserving original links\.$/,
        );

        if (noActiveNodeMatch) {
            return `Нет активной ноды TopoR Balancer для ${noActiveNodeMatch[1]}; исходные ссылки сохранены.`;
        }

        if (message === 'Processing failed; original subscription was used for diagnostics.') {
            return 'Обработка не удалась; для диагностики использована исходная подписка.';
        }

        return message;
    }

    private async processWithDatabase(
        input: ToporBalancerProcessInput,
        bodyText: string,
    ): Promise<{ body: string }> {
        try {
            const databaseUrl = this.configService.get<string | undefined>(
                'TOPOR_BALANCER_DATABASE_URL',
            );

            if (!databaseUrl) {
                throw new Error('TOPOR_BALANCER_DATABASE_URL is not configured');
            }

            const repository = this.getOrCreateRepository();

            await repository.initializeSchema();
            const [config, topology] = await Promise.all([
                this.getDatabaseProcessingConfig(repository),
                repository.getRemnawaveTopologyCache(),
            ]);
            const userAccess = await this.resolveRuntimeUserAccess(
                input.shortUuid,
                topology,
                bodyText,
                input.contentType,
            );

            return await processSubscriptionWithDatabaseBalancer({
                shortUuid: input.shortUuid,
                body: bodyText,
                contentType: input.contentType,
                requestPath: input.requestPath,
                userAgent: input.userAgent,
                config,
                repository,
                topology,
                userAccess,
                debug: this.configService.getOrThrow<boolean>('TOPOR_BALANCER_DEBUG'),
                logger: (message) => this.logger.log(message),
            });
        } catch (error) {
            this.logger.error('TopoR database balancer failed', error);

            if (!this.shouldFallbackToHash()) {
                throw error;
            }

            this.logger.warn('Falling back to TopoR hash balancer.');

            return processSubscriptionWithHashBalancer({
                shortUuid: input.shortUuid,
                body: bodyText,
                contentType: input.contentType,
                requestPath: input.requestPath,
                userAgent: input.userAgent,
                config: await this.loadConfig(),
                debug: this.configService.getOrThrow<boolean>('TOPOR_BALANCER_DEBUG'),
                logger: (message) => this.logger.log(message),
            });
        }
    }

    private async resolveRuntimeUserAccess(
        shortUuid: string,
        topology: ToporRemnawaveTopologySnapshot,
        bodyText: string,
        contentType?: string,
    ): Promise<ToporBalancerRuntimeUserAccess> {
        const apiAccess = await this.fetchRuntimeUserAccessFromRemnawave(shortUuid);

        if (apiAccess.squads.length > 0 || apiAccess.accessibleNodeUuids.length > 0) {
            return apiAccess;
        }

        return this.inferRuntimeUserAccessFromSubscription(topology, bodyText, contentType);
    }

    private async fetchRuntimeUserAccessFromRemnawave(
        shortUuid: string,
    ): Promise<ToporBalancerRuntimeUserAccess> {
        if (
            !this.axiosService ||
            typeof this.axiosService.getRemnawaveRawEndpoint !== 'function'
        ) {
            return {
                squads: [],
                accessibleNodeUuids: [],
            };
        }

        const userResponse = await this.axiosService.getRemnawaveRawEndpoint(
            `/api/users/by-short-uuid/${encodeURIComponent(shortUuid)}`,
        );

        if (!userResponse.isOk) {
            return {
                squads: [],
                accessibleNodeUuids: [],
            };
        }

        const user = this.unwrapRemnawaveObject(userResponse.response);
        const userUuid = this.readRuntimeString(user, ['uuid', 'id']);
        const squads = this.extractRuntimeSquads(user);

        if (!userUuid) {
            return {
                squads,
                accessibleNodeUuids: [],
            };
        }

        const accessibleNodesResponse = await this.axiosService.getRemnawaveRawEndpoint(
            `/api/users/${encodeURIComponent(userUuid)}/accessible-nodes`,
        );
        const accessibleNodeUuids = accessibleNodesResponse.isOk
            ? this.extractRuntimeArray(accessibleNodesResponse.response)
                  .map((item) => this.readRuntimeString(item, ['uuid', 'id', 'nodeUuid']))
                  .filter((uuid): uuid is string => Boolean(uuid))
            : [];

        return {
            squads,
            accessibleNodeUuids: Array.from(new Set(accessibleNodeUuids)),
        };
    }

    private inferRuntimeUserAccessFromSubscription(
        topology: ToporRemnawaveTopologySnapshot,
        bodyText: string,
        contentType?: string,
    ): ToporBalancerRuntimeUserAccess {
        const format = detectSubscriptionFormat(bodyText, contentType);
        const plainBody = decodeSubscriptionBody(bodyText, format);
        const hostsByRemark = new Map(topology.hosts.map((host) => [host.remark, host]));
        const squads = new Map<string, { name: string; uuid: string }>();
        const accessibleNodeUuids = new Set<string>();

        for (const link of extractVlessLinks(plainBody)) {
            if (!link.remark) {
                continue;
            }

            const host = hostsByRemark.get(link.remark);

            if (!host) {
                continue;
            }

            for (const squad of host.accessibleSquads) {
                squads.set(squad.uuid, squad);
            }

            if (host.nodeUuid) {
                accessibleNodeUuids.add(host.nodeUuid);
            }
        }

        return {
            squads: Array.from(squads.values()),
            accessibleNodeUuids: Array.from(accessibleNodeUuids),
        };
    }

    private unwrapRemnawaveObject(body: unknown): unknown {
        if (!body || typeof body !== 'object') {
            return body;
        }

        const record = body as Record<string, unknown>;

        for (const key of ['response', 'data', 'user']) {
            const value = record[key];

            if (value && typeof value === 'object' && !Array.isArray(value)) {
                return value;
            }
        }

        return body;
    }

    private extractRuntimeSquads(input: unknown): Array<{ name: string; uuid: string }> {
        const squads = this.extractRuntimeArrayFromKeys(input, [
            'internalSquads',
            'internal_squads',
            'squads',
        ]);
        const directSquadUuid = this.readRuntimeString(input, [
            'internalSquadUuid',
            'internal_squad_uuid',
            'squadUuid',
        ]);
        const directSquadName =
            this.readRuntimeString(input, ['internalSquadName', 'internal_squad_name', 'squadName']) ??
            directSquadUuid;
        const directSquad =
            directSquadUuid && directSquadName
                ? [{ uuid: directSquadUuid, name: directSquadName }]
                : [];

        return [...directSquad, ...squads]
            .map((item) => {
                const uuid = this.readRuntimeString(item, ['uuid', 'id']);
                const name = this.readRuntimeString(item, ['name', 'title']) ?? uuid;

                return uuid && name ? { uuid, name } : null;
            })
            .filter((squad): squad is { name: string; uuid: string } => Boolean(squad));
    }

    private extractRuntimeArrayFromKeys(input: unknown, keys: string[]): unknown[] {
        if (!input || typeof input !== 'object') {
            return [];
        }

        const record = input as Record<string, unknown>;

        for (const key of keys) {
            const value = record[key];

            if (Array.isArray(value)) {
                return value;
            }
        }

        return [];
    }

    private extractRuntimeArray(body: unknown): unknown[] {
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

                for (const nestedKey of ['items', 'nodes', 'accessibleNodes']) {
                    if (Array.isArray(nested[nestedKey])) {
                        return nested[nestedKey] as unknown[];
                    }
                }
            }
        }

        return [];
    }

    private readRuntimeString(item: unknown, keys: string[]): string | undefined {
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

    private stringifySupportedBody(body: unknown): string | null {
        if (typeof body === 'string') {
            return body;
        }

        if (Buffer.isBuffer(body)) {
            return body.toString('utf8');
        }

        return null;
    }

    private extractHeader(headers: unknown, headerName: string): string | undefined {
        if (!headers || typeof headers !== 'object') {
            return undefined;
        }

        const normalizedHeaderName = headerName.toLowerCase();
        const headerValue = Object.entries(headers as Record<string, unknown>).find(
            ([key]) => key.toLowerCase() === normalizedHeaderName,
        )?.[1];

        if (Array.isArray(headerValue)) {
            return headerValue.join(', ');
        }

        return typeof headerValue === 'string' ? headerValue : undefined;
    }

    private getOrCreateRepository(): ToporBalancerAssignmentRepository {
        if (this.repository) {
            return this.repository;
        }

        const databaseUrl = this.configService.get<string | undefined>(
            'TOPOR_BALANCER_DATABASE_URL',
        );

        if (!databaseUrl) {
            throw new Error('TOPOR_BALANCER_DATABASE_URL is not configured');
        }

        this.repository = new ToporBalancerPostgresRepository(databaseUrl);

        return this.repository;
    }

    private getAdminRepository(): ToporBalancerAssignmentRepository {
        try {
            return this.getOrCreateRepository();
        } catch (error) {
            throw new ServiceUnavailableException(
                `TopoR balancer database is not available: ${error}`,
            );
        }
    }

    private async getBootstrapNodes(): Promise<ToporBalancerAdminNode[]> {
        try {
            if (this.configService.get<string | undefined>('TOPOR_BALANCER_DATABASE_URL')) {
                const repository = this.getOrCreateRepository();
                await repository.initializeSchema();
                return await repository.listNodes();
            }
        } catch (error) {
            this.logger.warn(`[ToporBalancerConfig] database bootstrap source failed: ${error}`);
        }

        try {
            const config = await this.loadOptionalConfig();
            if (!config) {
                return [];
            }

            return config.locations.flatMap((location) =>
                location.nodes.map((node, index) => ({
                    id: `${location.publicHostCode}:${location.planCode}:${node.technicalHostName}:${index}`,
                    assignedUsers: 0,
                    createdAt: undefined,
                    locationCode: location.locationCode,
                    maxUsers: node.maxUsers,
                    planCode: location.planCode,
                    priority: node.priority ?? 100,
                    publicHostCode: location.publicHostCode,
                    publicName: location.publicName,
                    status: node.status,
                    technicalHostName: node.technicalHostName,
                    updatedAt: undefined,
                    weight: node.weight,
                })),
            );
        } catch (error) {
            this.logger.error('[ToporBalancerConfig] file bootstrap source failed', error);
            return [];
        }
    }

    private getBootstrapHosts(
        nodes: ToporBalancerAdminNode[],
    ): ToporBalancerBootstrap['hosts'] {
        const hosts = new Map<string, ToporBalancerBootstrap['hosts'][number]>();

        for (const node of nodes) {
            const key = `${node.publicHostCode}:${node.planCode}`;
            hosts.set(key, {
                publicHostCode: node.publicHostCode,
                publicName: node.publicName,
                locationCode: node.locationCode,
                planCode: node.planCode,
            });
        }

        return Array.from(hosts.values());
    }

    private validateGroupCreate(input: ToporBalancerGroupCreateInput): void {
        this.validateNonEmptyString(input.publicHostCode, 'publicHostCode');
        this.validateNonEmptyString(input.publicName, 'publicName');
        this.validateNonEmptyString(input.locationCode, 'locationCode');
        this.validateNonEmptyString(input.planCode, 'planCode');
        this.validateGroupUpdate({
            enabled: input.enabled,
        });

        if (!ADMIN_GROUP_STRATEGIES.has(input.strategy)) {
            throw new BadRequestException('Invalid TopoR balancer group strategy');
        }

        this.validateGroupSquadScope(input);
    }

    private validateGroupUpdate(input: ToporBalancerGroupUpdateInput): void {
        this.validateOptionalNonEmptyString(input.publicHostCode, 'publicHostCode');
        this.validateOptionalNonEmptyString(input.publicName, 'publicName');
        this.validateOptionalNonEmptyString(input.locationCode, 'locationCode');
        this.validateOptionalNonEmptyString(input.planCode, 'planCode');

        if (input.strategy !== undefined && !ADMIN_GROUP_STRATEGIES.has(input.strategy)) {
            throw new BadRequestException('Invalid TopoR balancer group strategy');
        }

        if (input.enabled !== undefined && typeof input.enabled !== 'boolean') {
            throw new BadRequestException('TopoR balancer group enabled must be a boolean');
        }

        this.validateGroupSquadScope(input);
    }

    private validateGroupSquadScope(input: {
        internalSquadUuid?: string;
        squadScope?: string;
    }): void {
        if (
            input.squadScope !== undefined &&
            !ADMIN_GROUP_SQUAD_SCOPES.has(input.squadScope)
        ) {
            throw new BadRequestException('Invalid TopoR balancer group squad scope');
        }

        if (input.squadScope === 'specific_internal_squad') {
            this.validateNonEmptyString(input.internalSquadUuid, 'internalSquadUuid');
        }
    }

    private validateGroupNodeCreate(input: ToporBalancerGroupNodeCreateInput): void {
        this.validateNonEmptyString(input.technicalHostName, 'technicalHostName');
        this.validateNodeUpdate({
            maxUsers: input.maxUsers ?? 300,
            status: input.status ?? 'active',
            weight: input.weight ?? 1,
        });
    }

    private validateNodeUpdate(input: ToporBalancerNodeUpdateInput): void {
        this.validateOptionalNonEmptyString(input.technicalHostName, 'technicalHostName');
        this.validateOptionalNonEmptyString(input.publicHostCode, 'publicHostCode');
        this.validateOptionalNonEmptyString(input.publicName, 'publicName');
        this.validateOptionalNonEmptyString(input.planCode, 'planCode');

        if (input.status !== undefined && !ADMIN_NODE_STATUSES.has(input.status)) {
            throw new BadRequestException('Invalid TopoR balancer node status');
        }

        if (
            input.weight !== undefined &&
            (typeof input.weight !== 'number' ||
                !Number.isFinite(input.weight) ||
                input.weight < 1)
        ) {
            throw new BadRequestException('TopoR balancer node weight must be a finite number >= 1');
        }

        if (
            input.maxUsers !== undefined &&
            (!Number.isInteger(input.maxUsers) || input.maxUsers < 1)
        ) {
            throw new BadRequestException('TopoR balancer node maxUsers must be an integer >= 1');
        }

        if (
            input.priority !== undefined &&
            (!Number.isInteger(input.priority) || input.priority < 0)
        ) {
            throw new BadRequestException('TopoR balancer node priority must be an integer >= 0');
        }

    }

    private shouldFallbackToHash(): boolean {
        return this.configService.getOrThrow<boolean>('TOPOR_BALANCER_DB_FALLBACK_TO_HASH');
    }

    private shouldImportConfigOnStart(): boolean {
        return this.configService.get<boolean>('TOPOR_BALANCER_IMPORT_CONFIG_ON_START') === true;
    }

    private async getDatabaseProcessingConfig(
        repository: ToporBalancerAssignmentRepository,
    ): Promise<ToporBalancerConfig> {
        if (this.startupConfig) {
            return this.startupConfig;
        }

        const groups = await repository.listGroups();
        const locations: ToporBalancerConfig['locations'] = [];

        for (const group of groups.filter((item) => item.enabled)) {
            const nodes = (await repository.listGroupNodes(group.id)) ?? [];

            locations.push({
                locationCode: group.locationCode,
                nodes: nodes.map((node) => ({
                    maxUsers: node.maxUsers,
                    priority: node.priority,
                    status: node.status,
                    technicalHostName: node.technicalHostName,
                    weight: node.weight,
                })),
                planCode: group.planCode,
                publicHostCode: group.publicHostCode,
                publicName: group.publicName,
                strategy: group.strategy,
                squadScope: group.squadScope,
                internalSquadUuid: group.internalSquadUuid,
            });
        }

        return {
            enabled: true,
            locations,
        };
    }

    private buildConfigFromAdminNodes(nodes: ToporBalancerAdminNode[]): ToporBalancerConfig {
        const locations = new Map<string, ToporBalancerConfig['locations'][number]>();

        for (const node of nodes) {
            const key = `${node.publicHostCode}:${node.planCode}`;
            const location =
                locations.get(key) ??
                {
                    publicHostCode: node.publicHostCode,
                    publicName: node.publicName,
                    locationCode: node.locationCode,
                    planCode: node.planCode,
                    squadScope: 'any_visible_to_user',
                    nodes: [],
                };

            location.nodes.push({
                technicalHostName: node.technicalHostName,
                weight: node.weight,
                maxUsers: node.maxUsers,
                status: node.status,
                priority: node.priority,
            });
            locations.set(key, location);
        }

        return {
            enabled: true,
            locations: Array.from(locations.values()),
        };
    }

    private validateNodeCreate(input: ToporBalancerNodeCreateInput): void {
        this.validateNonEmptyString(input.technicalHostName, 'technicalHostName');
        this.validateNonEmptyString(input.publicHostCode, 'publicHostCode');
        this.validateNonEmptyString(input.publicName, 'publicName');
        this.validateNonEmptyString(input.locationCode, 'locationCode');
        this.validateNonEmptyString(input.planCode, 'planCode');
        this.validateNodeUpdate({
            maxUsers: input.maxUsers,
            status: input.status,
            weight: input.weight,
        });
    }

    private async resolveDiscoveryImportGroup(
        input: ToporBalancerDiscoveryImportInput,
    ): Promise<ToporBalancerAdminGroup> {
        const repository = this.getAdminRepository();
        const normalizedGroupId = this.normalizeOptionalString(input.groupId);

        if (normalizedGroupId) {
            const group = (await repository.listGroups()).find((item) => item.id === normalizedGroupId);

            if (!group) {
                throw new NotFoundException('TopoR balancer import target group not found');
            }

            return group;
        }

        if (input.group) {
            return this.createAdminGroup({
                enabled: true,
                locationCode: this.normalizeOptionalString(input.group.locationCode),
                planCode: input.group.planCode,
                publicHostCode: input.group.publicHostCode,
                publicName: input.group.publicName,
                internalSquadUuid: input.group.internalSquadUuid,
                squadScope: input.group.squadScope,
                strategy: 'least_loaded',
            });
        }

        const legacyGroup = this.getLegacyDiscoveryImportGroup(input);
        const existingGroup = (await repository.listGroups()).find(
            (group) =>
                group.publicHostCode === legacyGroup.publicHostCode &&
                group.planCode === legacyGroup.planCode,
        );

        if (existingGroup) {
            return existingGroup;
        }

        return this.createAdminGroup({
            enabled: true,
            locationCode: this.normalizeOptionalString(legacyGroup.locationCode),
            planCode: legacyGroup.planCode,
            publicHostCode: legacyGroup.publicHostCode,
            publicName: legacyGroup.publicName,
            internalSquadUuid: input.internalSquadUuid,
            squadScope: input.squadScope,
            strategy: 'least_loaded',
        });
    }

    private getLegacyDiscoveryImportGroup(input: ToporBalancerDiscoveryImportInput): {
        publicHostCode: string;
        publicName: string;
        locationCode?: string;
        planCode: string;
    } {
        return {
            locationCode: input.locationCode,
            planCode: input.planCode ?? '',
            publicHostCode: input.publicHostCode ?? '',
            publicName: input.publicName ?? '',
        };
    }

    private validateDiscoveryImport(input: ToporBalancerDiscoveryImportInput): void {
        const normalizedGroupId = this.normalizeOptionalString(input.groupId);

        if (normalizedGroupId && input.group) {
            throw new BadRequestException(
                'TopoR balancer import must target either groupId or group, not both',
            );
        }

        if (normalizedGroupId) {
            this.validateNonEmptyString(normalizedGroupId, 'groupId');
        } else if (input.group) {
            this.validateNonEmptyString(input.group.publicHostCode, 'publicHostCode');
            this.validateNonEmptyString(input.group.publicName, 'publicName');
            this.validateNonEmptyString(input.group.locationCode, 'locationCode');
            this.validateNonEmptyString(input.group.planCode, 'planCode');
        } else {
            const legacyGroup = this.getLegacyDiscoveryImportGroup(input);

            this.validateNonEmptyString(legacyGroup.publicHostCode, 'publicHostCode');
            this.validateNonEmptyString(legacyGroup.publicName, 'publicName');
            this.validateNonEmptyString(legacyGroup.locationCode, 'locationCode');
            this.validateNonEmptyString(legacyGroup.planCode, 'planCode');
        }

        if (!Array.isArray(input.nodes) || input.nodes.length === 0) {
            throw new BadRequestException('TopoR balancer import nodes must be a non-empty array');
        }

        const seenTechnicalHostNames = new Set<string>();

        for (const node of input.nodes) {
            this.validateNonEmptyString(node.technicalHostName, 'technicalHostName');
            this.validateNodeUpdate({
                maxUsers: node.maxUsers,
                priority: node.priority,
                status: node.status,
                weight: node.weight,
            });

            const normalizedTechnicalHostName = node.technicalHostName.trim();

            if (seenTechnicalHostNames.has(normalizedTechnicalHostName)) {
                throw new BadRequestException(
                    `TopoR balancer import duplicates technicalHostName: ${normalizedTechnicalHostName}`,
                );
            }

            seenTechnicalHostNames.add(normalizedTechnicalHostName);
        }
    }

    private async validateManualReassign(input: ToporBalancerManualReassignInput): Promise<void> {
        this.validateNonEmptyString(input.shortUuid, 'shortUuid');
        this.validateNonEmptyString(input.publicHostCode, 'publicHostCode');
        this.validateNonEmptyString(input.planCode, 'planCode');
        this.validateNonEmptyString(input.technicalHostName, 'technicalHostName');

        const adminNodes = await this.getAdminRepository().listNodes();
        const targetNode = adminNodes.find(
            (node) =>
                node.technicalHostName === input.technicalHostName &&
                node.publicHostCode === input.publicHostCode &&
                node.planCode === input.planCode,
        );
        const mismatchedTargetNode = adminNodes.find(
            (node) => node.technicalHostName === input.technicalHostName,
        );

        if (!targetNode) {
            if (mismatchedTargetNode) {
                throw new BadRequestException(
                    'TopoR balancer reassignment target does not match publicHostCode and planCode',
                );
            }

            throw new NotFoundException('TopoR balancer node not found for reassignment');
        }

        if (targetNode.status !== 'active') {
            throw new BadRequestException('TopoR balancer reassignment target must be active');
        }
    }

    private validateNonEmptyString(value: unknown, fieldName: string): void {
        if (typeof value !== 'string' || value.trim().length === 0) {
            throw new BadRequestException(`TopoR balancer ${fieldName} must be a non-empty string`);
        }
    }

    private validateOptionalNonEmptyString(value: unknown, fieldName: string): void {
        if (value === undefined || value === null) {
            return;
        }

        this.validateNonEmptyString(value, fieldName);
    }

    private normalizeOptionalString(value: string | undefined): string | undefined {
        if (value === undefined) {
            return undefined;
        }

        const trimmed = value.trim();

        return trimmed.length > 0 ? trimmed : undefined;
    }

    private normalizeTechnicalHostName(value: string): string {
        return value.trim();
    }

    private getErrorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }

    private isMissingFileError(error: unknown): boolean {
        return (
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            (error as { code?: string }).code === 'ENOENT'
        );
    }
}
