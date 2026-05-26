import type {
    ToporBalancerConfig,
    ToporBalancerGroupStrategy,
    ToporBalancerLocation,
    ToporBalancerNode,
    ToporBalancerNodeStatus,
    ToporBalancerUnavailablePolicy,
} from './types';
import { normalizeTechnicalHostName } from './topor-balancer-technical-host-name';

const DEFAULT_NODE_WEIGHT = 1;
const DEFAULT_NODE_MAX_USERS = 300;
const DEFAULT_NODE_STATUS: ToporBalancerNodeStatus = 'active';
const DEFAULT_NODE_PRIORITY = 100;

const NODE_STATUSES = new Set<ToporBalancerNodeStatus>(['active', 'dead', 'disabled', 'draining']);
const UNAVAILABLE_POLICIES = new Set<ToporBalancerUnavailablePolicy>([
    'hide_group',
    'pass_through_original',
]);
const GROUP_STRATEGIES = new Set<ToporBalancerGroupStrategy>([
    'least_loaded',
    'manual',
    'priority_failover',
    'sticky_hash',
    'weighted',
]);

export class ToporBalancerConfigValidationError extends Error {
    constructor(public readonly issues: string[]) {
        super(`Invalid TopoR balancer config: ${issues.join('; ')}`);
        this.name = ToporBalancerConfigValidationError.name;
    }
}

export function validateToporBalancerConfig(config: unknown): ToporBalancerConfig {
    const issues: string[] = [];

    if (!isRecord(config)) {
        throw new ToporBalancerConfigValidationError(['config must be an object']);
    }

    const locationsInput = Array.isArray(config.locations) ? config.locations : [];

    if (config.locations !== undefined && !Array.isArray(config.locations)) {
        issues.push('locations must be an array');
    }

    const locations = locationsInput.map((location, index) =>
        normalizeLocation(location, index, issues),
    );

    validateUniqueLocations(locations, issues);
    validateUniqueTechnicalHostNames(locations, issues);

    if (issues.length > 0) {
        throw new ToporBalancerConfigValidationError(issues);
    }

    return {
        enabled: typeof config.enabled === 'boolean' ? config.enabled : false,
        locations,
    };
}

function normalizeLocation(
    location: unknown,
    locationIndex: number,
    issues: string[],
): ToporBalancerLocation {
    const path = `locations[${locationIndex}]`;

    if (!isRecord(location)) {
        issues.push(`${path} must be an object`);

        return {
            publicHostCode: '',
            publicName: '',
            planCode: '',
            nodes: [],
        };
    }

    const publicHostCode = readRequiredString(location, 'publicHostCode', path, issues);
    const publicName = readRequiredString(location, 'publicName', path, issues);
    const locationCode = readRequiredString(location, 'locationCode', path, issues);
    const planCode = readRequiredString(location, 'planCode', path, issues);
    const strategy = readOptionalGroupStrategy(location.strategy, `${path}.strategy`, issues);
    const unavailablePolicy = readOptionalUnavailablePolicy(
        location.unavailablePolicy,
        `${path}.unavailablePolicy`,
        issues,
    );
    const nodesInput = Array.isArray(location.nodes) ? location.nodes : [];

    if (location.nodes !== undefined && !Array.isArray(location.nodes)) {
        issues.push(`${path}.nodes must be an array`);
    }

    return {
        enabled: typeof location.enabled === 'boolean' ? location.enabled : true,
        publicHostCode,
        publicName,
        locationCode,
        planCode,
        strategy,
        unavailablePolicy,
        nodes: nodesInput.map((node, index) => normalizeNode(node, locationIndex, index, issues)),
    };
}

function normalizeNode(
    node: unknown,
    locationIndex: number,
    nodeIndex: number,
    issues: string[],
): ToporBalancerNode {
    const path = `locations[${locationIndex}].nodes[${nodeIndex}]`;

    if (!isRecord(node)) {
        issues.push(`${path} must be an object`);

        return {
            technicalHostName: '',
            weight: DEFAULT_NODE_WEIGHT,
            maxUsers: DEFAULT_NODE_MAX_USERS,
            status: DEFAULT_NODE_STATUS,
            priority: DEFAULT_NODE_PRIORITY,
        };
    }

    return {
        technicalHostName: normalizeTechnicalHostName(
            readRequiredString(node, 'technicalHostName', path, issues),
        ),
        weight: readOptionalPositiveInteger(
            node.weight,
            DEFAULT_NODE_WEIGHT,
            `${path}.weight`,
            issues,
        ),
        maxUsers: readOptionalPositiveInteger(
            node.maxUsers,
            DEFAULT_NODE_MAX_USERS,
            `${path}.maxUsers`,
            issues,
        ),
        status: readOptionalNodeStatus(node.status, `${path}.status`, issues),
        priority: readOptionalNonNegativeInteger(
            node.priority,
            DEFAULT_NODE_PRIORITY,
            `${path}.priority`,
            issues,
        ),
    };
}

function readRequiredString(
    record: Record<string, unknown>,
    key: string,
    path: string,
    issues: string[],
): string {
    const value = record[key];

    if (typeof value !== 'string' || value.trim().length === 0) {
        issues.push(`${path}.${key} is required`);

        return '';
    }

    return value;
}

function readOptionalPositiveInteger(
    value: unknown,
    defaultValue: number,
    path: string,
    issues: string[],
): number {
    if (value === undefined) {
        return defaultValue;
    }

    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
        issues.push(`${path} must be a positive integer`);

        return defaultValue;
    }

    return value;
}

function readOptionalNonNegativeInteger(
    value: unknown,
    defaultValue: number,
    path: string,
    issues: string[],
): number {
    if (value === undefined) {
        return defaultValue;
    }

    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        issues.push(`${path} must be a non-negative integer`);

        return defaultValue;
    }

    return value;
}

function readOptionalNodeStatus(
    value: unknown,
    path: string,
    issues: string[],
): ToporBalancerNodeStatus {
    if (value === undefined) {
        return DEFAULT_NODE_STATUS;
    }

    if (typeof value !== 'string' || !NODE_STATUSES.has(value as ToporBalancerNodeStatus)) {
        issues.push(`${path} must be one of: ${Array.from(NODE_STATUSES).join(', ')}`);

        return DEFAULT_NODE_STATUS;
    }

    return value as ToporBalancerNodeStatus;
}

function readOptionalGroupStrategy(
    value: unknown,
    path: string,
    issues: string[],
): ToporBalancerGroupStrategy {
    if (value === undefined) {
        return 'least_loaded';
    }

    if (typeof value !== 'string' || !GROUP_STRATEGIES.has(value as ToporBalancerGroupStrategy)) {
        issues.push(`${path} must be one of: ${Array.from(GROUP_STRATEGIES).join(', ')}`);

        return 'least_loaded';
    }

    return value as ToporBalancerGroupStrategy;
}

function readOptionalUnavailablePolicy(
    value: unknown,
    path: string,
    issues: string[],
): ToporBalancerUnavailablePolicy {
    if (value === undefined) {
        return 'hide_group';
    }

    if (
        typeof value !== 'string' ||
        !UNAVAILABLE_POLICIES.has(value as ToporBalancerUnavailablePolicy)
    ) {
        issues.push(`${path} must be one of: ${Array.from(UNAVAILABLE_POLICIES).join(', ')}`);

        return 'hide_group';
    }

    return value as ToporBalancerUnavailablePolicy;
}

function validateUniqueLocations(locations: ToporBalancerLocation[], issues: string[]): void {
    const seenLocationKeys = new Map<string, number>();

    locations.forEach((location, index) => {
        if (!location.publicHostCode || !location.planCode) {
            return;
        }

        const key = `${location.publicHostCode}:${location.planCode}`;
        const previousIndex = seenLocationKeys.get(key);

        if (previousIndex !== undefined) {
            issues.push(
                `locations[${index}] duplicates publicHostCode + planCode from locations[${previousIndex}]`,
            );
            return;
        }

        seenLocationKeys.set(key, index);
    });
}

function validateUniqueTechnicalHostNames(
    locations: ToporBalancerLocation[],
    issues: string[],
): void {
    const seenTechnicalHostNames = new Map<string, string>();

    locations.forEach((location, locationIndex) => {
        location.nodes.forEach((node, nodeIndex) => {
            if (!node.technicalHostName) {
                return;
            }

            const normalizedTechnicalHostName = normalizeTechnicalHostName(node.technicalHostName);
            const previousPath = seenTechnicalHostNames.get(normalizedTechnicalHostName);
            const currentPath = `locations[${locationIndex}].nodes[${nodeIndex}].technicalHostName`;

            if (previousPath) {
                issues.push(`${currentPath} duplicates ${previousPath}`);
                return;
            }

            seenTechnicalHostNames.set(normalizedTechnicalHostName, currentPath);
        });
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
