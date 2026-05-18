import {
    BadRequestException,
    Injectable,
    Logger,
    NotFoundException,
    OnModuleDestroy,
    OnModuleInit,
    ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
    ToporBalancerAssignmentFilters,
    ToporBalancerAssignmentRepository,
    ToporBalancerManualReassignInput,
    ToporBalancerNodeUpdateInput,
    ToporBalancerRequestFilters,
} from './topor-balancer-database.repository';
import type {
    ToporBalancerAdminHealth,
    ToporBalancerAdminNode,
    ToporBalancerAdminRequest,
    ToporBalancerAssignmentMode,
    ToporBalancerConfig,
    ToporBalancerDbAssignment,
    ToporBalancerNodeStatus,
} from './types';

import { processSubscriptionWithDatabaseBalancer } from './topor-balancer-database.processor';
import { ToporBalancerPostgresRepository } from './topor-balancer-database.repository';
import { processSubscriptionWithHashBalancer } from './topor-balancer-hash.processor';
import { loadToporBalancerConfigFromFile } from './topor-balancer-config.loader';

interface ToporBalancerProcessInput {
    shortUuid: string;
    body: unknown;
    contentType?: string;
    requestPath?: string;
    userAgent?: string;
}

const ADMIN_NODE_STATUSES = new Set<ToporBalancerNodeStatus>([
    'active',
    'dead',
    'disabled',
    'draining',
]);

@Injectable()
export class ToporBalancerService implements OnModuleDestroy, OnModuleInit {
    private readonly logger = new Logger(ToporBalancerService.name);
    private repository: ToporBalancerAssignmentRepository | null = null;
    private startupConfig: ToporBalancerConfig | null = null;

    constructor(private readonly configService: ConfigService) {}

    public async onModuleInit(): Promise<void> {
        if (!this.isEnabled() || this.getAssignmentMode() !== 'database') {
            return;
        }

        try {
            const repository = this.getOrCreateRepository();
            const config = await this.loadConfig();

            await repository.initializeSchema();
            await repository.upsertConfiguredNodes(config);
            this.startupConfig = config;
            this.logger.log('TopoR balancer database schema initialized and nodes upserted.');
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
            await this.loadConfig();
            configLoaded = true;
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

    public async listAdminNodes(): Promise<ToporBalancerAdminNode[]> {
        return this.getAdminRepository().listNodes();
    }

    public async updateAdminNode(
        id: string,
        input: ToporBalancerNodeUpdateInput,
    ): Promise<ToporBalancerAdminNode> {
        this.validateNodeUpdate(input);

        const node = await this.getAdminRepository().updateNode(id, input);

        if (!node) {
            throw new NotFoundException('TopoR balancer node not found');
        }

        return node;
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

    public async setAdminNodeStatus(
        id: string,
        status: ToporBalancerNodeStatus,
    ): Promise<ToporBalancerAdminNode> {
        return this.updateAdminNode(id, { status });
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

            const config = this.startupConfig ?? (await this.loadConfig());
            const repository = this.getOrCreateRepository();

            await repository.initializeSchema();
            await repository.upsertConfiguredNodes(config);

            return await processSubscriptionWithDatabaseBalancer({
                shortUuid: input.shortUuid,
                body: bodyText,
                contentType: input.contentType,
                requestPath: input.requestPath,
                userAgent: input.userAgent,
                config,
                repository,
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

    private stringifySupportedBody(body: unknown): string | null {
        if (typeof body === 'string') {
            return body;
        }

        if (Buffer.isBuffer(body)) {
            return body.toString('utf8');
        }

        return null;
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

    private validateNodeUpdate(input: ToporBalancerNodeUpdateInput): void {
        if (input.status !== undefined && !ADMIN_NODE_STATUSES.has(input.status)) {
            throw new BadRequestException('Invalid TopoR balancer node status');
        }

        if (
            input.weight !== undefined &&
            (typeof input.weight !== 'number' ||
                !Number.isFinite(input.weight) ||
                input.weight <= 0)
        ) {
            throw new BadRequestException('TopoR balancer node weight must be a finite number > 0');
        }

        if (
            input.maxUsers !== undefined &&
            (!Number.isInteger(input.maxUsers) || input.maxUsers < 1)
        ) {
            throw new BadRequestException('TopoR balancer node maxUsers must be an integer >= 1');
        }

        if (
            input.publicName !== undefined &&
            (typeof input.publicName !== 'string' || input.publicName.trim().length === 0)
        ) {
            throw new BadRequestException('TopoR balancer node publicName must be non-empty');
        }
    }

    private shouldFallbackToHash(): boolean {
        return this.configService.getOrThrow<boolean>('TOPOR_BALANCER_DB_FALLBACK_TO_HASH');
    }

    private async validateManualReassign(input: ToporBalancerManualReassignInput): Promise<void> {
        this.validateNonEmptyString(input.shortUuid, 'shortUuid');
        this.validateNonEmptyString(input.publicHostCode, 'publicHostCode');
        this.validateNonEmptyString(input.planCode, 'planCode');
        this.validateNonEmptyString(input.technicalHostName, 'technicalHostName');

        const targetNode = (await this.getAdminRepository().listNodes()).find(
            (node) => node.technicalHostName === input.technicalHostName,
        );

        if (!targetNode) {
            throw new NotFoundException('TopoR balancer node not found for reassignment');
        }

        if (
            targetNode.publicHostCode !== input.publicHostCode ||
            targetNode.planCode !== input.planCode
        ) {
            throw new BadRequestException(
                'TopoR balancer reassignment target does not match publicHostCode and planCode',
            );
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

    private getErrorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
