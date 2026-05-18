import type {
    ToporBalancerConfig,
    ToporBalancerLocation,
    ToporBalancerNode,
    ToporBalancerNodeStatus,
} from './types';

const DEFAULT_NODE_WEIGHT = 1;
const DEFAULT_NODE_MAX_USERS = 300;
const DEFAULT_NODE_STATUS: ToporBalancerNodeStatus = 'active';

const NODE_STATUSES = new Set<ToporBalancerNodeStatus>(['active', 'dead', 'disabled', 'draining']);

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
    const planCode = readRequiredString(location, 'planCode', path, issues);
    const nodesInput = Array.isArray(location.nodes) ? location.nodes : [];

    if (location.nodes !== undefined && !Array.isArray(location.nodes)) {
        issues.push(`${path}.nodes must be an array`);
    }

    return {
        publicHostCode,
        publicName,
        locationCode: readOptionalString(location.locationCode),
        planCode,
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
        };
    }

    return {
        technicalHostName: readRequiredString(node, 'technicalHostName', path, issues),
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

function readOptionalString(value: unknown): string | undefined {
    if (typeof value !== 'string' || value.trim().length === 0) {
        return undefined;
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

            const previousPath = seenTechnicalHostNames.get(node.technicalHostName);
            const currentPath = `locations[${locationIndex}].nodes[${nodeIndex}].technicalHostName`;

            if (previousPath) {
                issues.push(`${currentPath} duplicates ${previousPath}`);
                return;
            }

            seenTechnicalHostNames.set(node.technicalHostName, currentPath);
        });
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
